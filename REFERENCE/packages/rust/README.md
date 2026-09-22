---
type: Developer Guide
title: Rust 微内核开发入口
description: 五个 Rust crate 的职责、统一公开导出、最短开发流程、宿主接入与验证门禁。
status: stable
tags: [rust, kernel, daemon, napi, ffi, analysis, quick-start, public-api]
---

# Rust 微内核开发入口 (`packages/rust`)

本页是 Rust 核心开发的起点。读完即可选对 crate、从稳定入口调用、编写最小测试并完成验证；子目录 README 用于查询成员与算法细节，不是开始开发的前置阅读。

## 1. 五个 crate 与唯一职责

| crate | 负责 | 不负责 | 公开入口 |
| :--- | :--- | :--- | :--- |
| `graphframework-kernel` | entity/generation、mailbox、single-flight、submission、drop ledger | JSON State、业务 handler、I/O、进程管理 | `kernel/src/lib.rs` 的重导出 |
| `graphframework-analysis` | 便携事实校验、索引、路径、视图、健康度、中心性、社区 | 扫描源码、启动 runtime、保存业务配置 | `analysis/src/lib.rs` |
| `graphframework-kernel-node` | 将 Kernel 与 analysis 暴露为 N-API | 持有业务 State、执行 Node change | N-API `RuleSpace` 与 `analyze_json` |
| `graphframework-kernel-ffi` | C ABI 句柄、DTO 与内存释放函数 | Python/Go/C++ 的业务封装 | `extern "C"` 的 `gv_*` 函数 |
| `graphframework-kernel-daemon` | TCP JSON Lines、JSON State、worker/effect 租约、Agent 控制面 | 解释业务字段、发现目录、拉起进程 | library 的 `Space/Session/PendingAnalysis/PUBLIC_OPERATIONS` 与 binary |

生产调度只有 `graphframework-kernel`。TypeScript `KernelRuntime` 只是测试 Oracle，不是第二套生产内核。

## 2. 从哪里导入

Rust 消费者只从 crate 根导入，不引用私有文件：

```rust
use graphframework_kernel::{
    BeginError, ChangeOutcome, DeliveryFeedback, Kernel, KernelError, SubmissionState,
};
use graphframework_analysis::{analyze_json, validate_snapshot};
```

统一导出规则：

- `kernel` 的内部 `error/registry/scheduler` 保持私有，由 `lib.rs` 重导出稳定类型。
- `analysis` 的语言无关入口直接由 `lib.rs` 导出；算法子模块不成为跨语言协议。
- `kernel-daemon` 的公开操作名由 `PUBLIC_OPERATIONS` 导出，并与 `packages/contract/operations.json` 单测对齐。
- `kernel-node` 只暴露 N-API DTO/方法；JavaScript 应通过 `@graphframework/sdk/node`，不直接依赖 `.node` 内部路径。
- `kernel-ffi` 的函数名与所有权就是 ABI；新增或变更必须同步 ABI 测试与文档。

## 3. 最短开发流程

1. 先读 [`../../architecture/mental-model.md`](../../architecture/mental-model.md)，确认改动不引入业务语义、I/O 或宿主能力。
2. 在上表选择唯一拥有语义的 crate；跨进程字段先改 `packages/contract`。
3. 先在目标 crate 的 `tests/` 或 `#[cfg(test)]` 写最小复现。
4. 从 crate 根公开新 API，并同步对应 binding/client；禁止让调用方导入私有模块。
5. 运行目标 crate 测试，再运行 workspace 与两套 TypeScript 门禁。

```bash
# 针对性
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-daemon

# Rust 全量
cargo test --manifest-path packages/rust/Cargo.toml

# 强制跨层门禁
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
```

## 4. TypeScript 生产装配

业务 Node 不直接调用 N-API。通过 SDK 将 Node 描述为初始 State、handler、Effect 权限与便携事实，再挂到原生规则空间：

```ts
import {
  NativeRuleSpace,
  mountDomainNode,
  type Node,
} from '@graphframework/sdk/node';

const space = new NativeRuleSpace();
mountDomainNode(space, myWorkerNode as Node<Record<string, unknown>>);

const submissionId = space.injectRoot(
  'downloader',
  { type: 'StartDownload', url: 'https://example.invalid/file.zip' },
  'sub-001',
);
await space.waitForSubmission(submissionId);
await space.dispose();
```

`mountDomainNode` 是模块函数，不是 `space` 方法；原生入口叫 `injectRoot`，不是 `injectRootInfo`。图外注入等待自己的 submission 终态，不等待全图静止。

## 5. 跨语言 daemon 接入

daemon 是 loopback TCP JSON Lines 服务，不提供 README 中手输 `action` 的 STDIO 协议。合法帧与全部 26 个 operation 见 [机器契约](../contract/README.md)。客户端使用 SDK 的 agent 能力面：

```ts
import { connectKernelDaemon } from '@graphframework/sdk/agent';
```

```python
from graphframework_sdk.agent import KernelDaemonClient
```

端口和每次启动随机 token 由当前 run 提供。不得硬编码、持久化或在 shell 中旁路启动 daemon。应用与 daemon 的唯一启动入口仍是：

```bash
bash ./run.sh start runs/<name>/run.config.json
bash ./run.sh status runs/<name>/run.config.json
bash ./run.sh stop runs/<name>/run.config.json
```

`cargo test`/`cargo build` 是开发验证，不等同于启动应用。

## 6. 改动落点与完成标准

| 需求 | 首改位置 | 还需同步 |
| :--- | :--- | :--- |
| 调度语义、generation、drop | `kernel` | N-API、FFI、daemon、三侧测试 |
| 新分析 operation/DTO | `analysis` | contract、daemon、N-API/FFI、SDK 类型 |
| 新 daemon operation | `packages/contract` | `PUBLIC_OPERATIONS`、daemon match、JS/Python client |
| 新 N-API 方法 | `kernel-node` | `NativeRuleSpace` binding interface 与测试 |
| 新 C ABI | `kernel-ffi` | ABI version/兼容性判断、释放函数、头文件式文档 |

完成标准：核心无业务语义；公开 API 只经 crate 根或稳定 ABI；所有 binding 对 generation/submission/error 语义一致；契约、README 和针对性测试与源码同批更新。

详细参考：[Kernel](kernel/README.md)、[Daemon](kernel-daemon/README.md)、[N-API](kernel-node/README.md)、[C ABI](kernel-ffi/README.md)、[Analysis](analysis/README.md)。
