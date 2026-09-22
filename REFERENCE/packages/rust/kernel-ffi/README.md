---
type: API Reference
title: graphframework-kernel-ffi C ABI
description: 唯一公开头文件、句柄/Change 所有权、返回码、分析接口与释放规则的源码对齐参考。
status: stable
tags: [rust, ffi, c-abi, header, ownership, public-api]
---

# `graphframework-kernel-ffi` C ABI

开发流程见 [Rust 开发入口](../README.md)。C/C++、ctypes、cffi、cgo 等消费者只以 [`include/graphframework_kernel.h`](../../../../packages/rust/kernel-ffi/include/graphframework_kernel.h) 为公开入口；不要手抄 README 原型或绑定 Rust 私有结构。

## 1. ABI 与句柄

```c
#include "graphframework_kernel.h"

if (gv_abi_version() != 1) {
  /* refuse an incompatible library */
}

GvKernel *kernel = gv_kernel_new();
/* ... admit / inject / poll / settle ... */
gv_kernel_shutdown(kernel);
gv_kernel_free(kernel);
```

- `GvKernel` 是不透明句柄，内部用 `Mutex<Kernel>` 同步；只能由 `gv_kernel_free` 释放一次。
- ABI version 当前为 `1`。新增符号可以保持版本；改变现有签名、布局或语义必须升级版本并保留兼容判断。
- 所有字符串输入必须是有效、NUL 结尾的 UTF-8；可选字符串用 `NULL`。
- null/无效句柄、无效 UTF-8 或内部拒绝通过 `false`、`-1`、`NULL` 等当前函数的失败哨兵返回。

## 2. 公开符号分组

头文件声明全部 26 个符号，测试会将其与 `src/lib.rs` 的 `gv_*` 导出逐项比较。

| 分组 | 符号 |
| :--- | :--- |
| 版本/生命周期 | `gv_abi_version`、`gv_kernel_new`、`gv_kernel_shutdown`、`gv_kernel_free` |
| entity/generation | `gv_admit`、`gv_evict`、`gv_replace`、`gv_generation` |
| State edit lease | `gv_begin_edit`、`gv_end_edit`、`gv_abort_edit` |
| 因果调度 | `gv_send`、`gv_inject_root`、`gv_poll_next`、`gv_settle_change`、`gv_change_free` |
| submission | `gv_cancel`、`gv_pending_total`、`gv_submission_state` |
| 便携事实 | `gv_set_analysis_facts`、`gv_analysis_facts`、`gv_analysis_snapshot`、`gv_analysis_snapshot_free` |
| 分析/字符串 | `gv_analyze`、`gv_analysis_free`、`gv_string_free` |

`gv_admit/gv_replace/gv_generation/gv_begin_edit` 成功返回非负 generation，失败返回 `-1`。

## 3. 投递反馈

`gv_send` 与 `gv_inject_root` 返回：

| code | 语义 |
| :--- | :--- |
| `0` | Enqueued |
| `1` | Dropped: UnknownTarget |
| `2` | Dropped: SealedTarget |
| `3` | Dropped: StaleGeneration |
| `4` | Dropped: Cancelled |
| `5` | Dropped: Evicted |
| `6` | Dropped: KernelShutdown |
| `-1` | FFI 参数/句柄无效 |

投递成功只表示进入目标 mailbox，不表示全图或外部 Effect 已完成。

## 4. Change 所有权

`gv_poll_next` 返回 `GvChange*` 或 `NULL`。成功返回的指针有且只有两种终结方式：

1. `gv_settle_change(kernel, change, failed_message)`：消费指针并结算；`failed_message == NULL` 表示 Completed，否则表示 Failed。
2. `gv_change_free(change)`：放弃尚未结算的 DTO 内存；它不会结算内核 change，因此只适用于宿主决定销毁整个内核的异常路径。

调用任一函数后不得再次读取或释放该 `GvChange*`。结构体内部的字符串随整个 change 一次释放，调用方不能单独释放。

## 5. 返回内存

| 来源 | 释放函数 |
| :--- | :--- |
| `gv_submission_state`、`gv_analysis_facts` | `gv_string_free` |
| `gv_analyze` | `gv_analysis_free`（与 `gv_string_free` 同所有权语义） |
| `gv_analysis_snapshot` | `gv_analysis_snapshot_free`，深度释放 entries 与字符串 |
| `gv_poll_next` | `gv_settle_change` 或 `gv_change_free` |
| `gv_kernel_new` | `gv_kernel_free` |

严禁使用系统 `free()` 释放 Rust 返回的内存。

## 6. 分析入口

`gv_analyze(request_json, facts_json)` 只做 JSON 解析和转发，算法由 `graphframework-analysis` 统一实现。`facts_json` 可为 snapshot 数组，或：

```json
{
  "snapshots": [],
  "liveStates": {},
  "frontendLinks": [],
  "frontendServiceLinks": []
}
```

成功返回确定性 JSON 字符串，失败返回 `NULL`。

## 7. 验证

```bash
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-ffi
```

该测试覆盖 ABI 行为、Golden Frame 分析与头文件符号完整性。
