---
type: API Reference
title: graphframework-kernel-ffi C ABI 跨语言导出规约
description: C ABI 原生动态库规约、GvKernel 句柄生命周期、C 头文件函数签名与内存释放守则。
status: stable
tags: [rust, ffi, c-abi, gv-kernel, ctypes]
---

# `graphframework-kernel-ffi` C ABI 跨语言导出规约

源码目录：[`packages/rust/kernel-ffi/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-ffi)  
源码入口：[`packages/rust/kernel-ffi/src/lib.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-ffi/src/lib.rs)

`graphframework-kernel-ffi` 为非 Rust、非 JavaScript 的宿主环境（如 Python ctypes/cffi、C++、Go cgo）提供标准 C ABI（`extern "C"`）动态库接口（`.so` / `.dll` / `.dylib`）。

它包装了相同的 Rust `Kernel` 实例，提供同步互斥保护（`Mutex<Kernel>`）与确定性的 C 语言内存生命周期协议。

---

## 1. 核心 C 结构体定义

```c
// 对应 GvChange：单飞任务执行上下文
typedef struct {
    uint64_t change_id;
    uint64_t info_id;
    uint64_t caused_by;
    bool has_caused_by;
    uint64_t generation;
    char *entity;
    char *info_type;
    char *sender;
    char *payload_json;     // 可能为 NULL
    char *submission;       // 可能为 NULL
} GvChange;

// 对应 GvAnalysisSnapshot：全图元数据快照
typedef struct {
    char *entity;
    char *facts_json;
} GvAnalysisEntry;

typedef struct {
    size_t len;
    GvAnalysisEntry *entries;
} GvAnalysisSnapshot;
```

---

## 2. 状态码与反馈编码规约

### 2.1 投递反馈状态码 [`feedback_code`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-ffi/src/lib.rs#L61-L71)
当调用 `gv_kernel_send` 或 `gv_kernel_inject_root` 时，返回整数状态码：
- `0`: `Enqueued`（成功进入 Mailbox）
- `1`: `Dropped(UnknownTarget)`
- `2`: `Dropped(SealedTarget)`
- `3`: `Dropped(StaleGeneration)`
- `4`: `Dropped(Cancelled)`
- `5`: `Dropped(Evicted)`
- `6`: `Dropped(KernelShutdown)`

### 2.2 根任务生命周期状态码
调用 `gv_kernel_submission_state` 返回：
- `0`: 未知任务（`Unknown`）
- `1`: 待决运行中（`Open`，通过 `out_pending` 返回未结算计数）
- `2`: 全部结算成功（`Completed`）
- `3`: 任务被取消（`Cancelled`）
- `4`: 任务失败（`Failed`，通过 `out_failure` 输出错误原因）

---

## 3. 核心导出函数清单

### 3.1 空间创建与停机
```c
GvKernel* gv_kernel_new(void);
uint32_t gv_abi_version(void); // 固定返回 1
bool gv_kernel_shutdown(GvKernel *handle);
void gv_kernel_free(GvKernel *handle);
```

### 3.2 实体生命周期
```c
int32_t gv_kernel_admit(GvKernel *handle, const char *id, uint64_t *out_generation);
bool gv_kernel_evict(GvKernel *handle, const char *id);
bool gv_kernel_seal(GvKernel *handle, const char *id);
bool gv_kernel_unseal(GvKernel *handle, const char *id);
int32_t gv_kernel_replace(GvKernel *handle, const char *id, uint64_t *out_generation);
bool gv_kernel_generation(GvKernel *handle, const char *id, uint64_t *out_generation);
```

### 3.3 投递与单飞调度
```c
int32_t gv_kernel_send(
    GvKernel *handle,
    const char *sender,
    const char *info_type,
    const char *payload_json,
    const char *target,
    bool has_caused_by,
    uint64_t caused_by,
    const char *submission
);

int32_t gv_kernel_inject_root(
    GvKernel *handle,
    const char *target,
    const char *info_type,
    const char *payload_json,
    const char *submission
);

bool gv_kernel_poll_next(GvKernel *handle, GvChange *out_change);

bool gv_kernel_settle_change(
    GvKernel *handle,
    uint64_t change_id,
    const char *entity,
    uint64_t generation,
    bool has_submission,
    const char *submission,
    bool has_failure,
    const char *failure
);

bool gv_kernel_cancel(GvKernel *handle, const char *submission);
size_t gv_kernel_pending_total(GvKernel *handle);
```

### 3.4 分析与拓扑计算
```c
bool gv_kernel_set_analysis_facts(GvKernel *handle, const char *id, uint64_t generation, const char *facts_json);
bool gv_kernel_analysis_snapshot(GvKernel *handle, GvAnalysisSnapshot *out_snapshot);
void gv_kernel_analysis_snapshot_free(GvAnalysisSnapshot *snapshot);
char* gv_analyze_json(const char *request_json, const char *facts_json);
```

---

## 4. 内存管理与所有权释放契约

凡由 `kernel-ffi` 动态分配并跨边界传递给调用方的指针，**调用方必须使用指定的释放函数归还所有权，严禁直接使用系统 `free()`**：

1. **字符串释放**：
   - 凡由 FFI 返回的 `char*`（如 `gv_analyze_json` 的返回值，或 `out_failure` 字符串），必须通过 [`gv_string_free(char *ptr)`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-ffi/src/lib.rs#L446-L451) 释放。
2. **Change 结构体释放**：
   - 由 `gv_kernel_poll_next` 填充的 `GvChange` 结构体，在使用完毕后必须调用 [`gv_change_free(GvChange *change)`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-ffi/src/lib.rs#L454-L466) 释放其内部包含的各个深拷贝字符串。
3. **分析快照释放**：
   - 由 `gv_kernel_analysis_snapshot` 填充的快照数组，必须通过 [`gv_kernel_analysis_snapshot_free`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-ffi/src/lib.rs#L425-L443) 深度释放。
