---
type: Developer Guide
title: 开发或开放内核能力
description: 遵循 Kernel 五项准入检查、确定归属层级、选择 Rust 内核与跨语言修改面，并完成测试驱动演进与事实文档同步。
status: stable
tags: [kernel, rust, admission, scheduler, daemon, abi]
---

# 开发或开放内核能力

GraphFramework 的核心微内核采用 Rust 实现（`packages/rust/kernel`），通过常驻 daemon（`packages/rust/kernel-daemon`）或 N-API 原生桥（`packages/rust/crates/kernel-node`）为宿主提供权威调度与状态管理。

修改微内核具有极高的全局影响，必须严格遵循准入检查与架构红线。

---

## 步骤 1：通过 Kernel 五项准入检查

任何计划进入微内核的功能，必须同时满足以下五项硬性指标：

| 检查项 | 准入要求 | 反面模式（禁止进入 Kernel） |
| :--- | :--- | :--- |
| **通用性** | 能够用一个完全不含 GraphFramework 业务词汇的第二个图系统应用场景说清楚需求。 | 携带特定业务的 Info/Node ID，或为特定插件定制逻辑。 |
| **正确性** | 直接服务于调度次序、因果收敛、并发隔离或事实一致性。 | 仅为了辅助上层 UI 绘制、调试便利或分析做折衷。 |
| **不可表达性** | 无法由现有的 Node、Info、State、change、EffectAdapter 或外层宿主组合表达。 | 可以在外层宿主或通过业务 Node 闭环的能力。 |
| **无能力性** | 绝不执行文件系统、网络、数据库、子进程、多媒体或窗口操作。 | 在微内核内直接发 HTTP 请求、读写本地磁盘或管理进程。 |
| **最小表面** | 对外暴露的 API 和数据结构保持最小集合，且具备完备的静态与动态测试。 | 增加无具体消费者的预留字段或通用扩展字典袋。 |

> [!CAUTION]
> 若无法同时满足上述五项检查，该能力**绝不属于 Kernel**。应将其放在业务插件、外层宿主或分析层中实现。

---

## 步骤 2：判断代码归属与选择修改面

根据修改目的，确定需要触及的代码层级：

```text
[Rust Micro-Kernel] (packages/rust/kernel)
       │  (纯因果调度、submission、权威 State 树)
       ▼
[Kernel Daemon] (packages/rust/kernel-daemon)
       │  (常驻进程、RPC 协议、租约管理、有序 commit)
       ▼
[Native Bridges]
   ├── [N-API 绑定] (packages/rust/crates/kernel-node)
   └── [C ABI] (packages/rust/crates/kernel-c-abi)
       ▼
[SDK 规约与宿主] (packages/sdk/javascript)
```

1. **纯调度与状态语义变动**：修改 `packages/rust/kernel`。
2. **跨进程协议与 worker 租约变动**：修改 `packages/rust/kernel-daemon` 与 `DOCUMENTS/protocols/kernel-daemon-protocol.md`。
3. **Node.js/Electron 原生绑定导出**：修改 `packages/rust/crates/kernel-node` 并重新 stage。
4. **跨语言外部接口变动**：修改 `packages/rust/crates/kernel-c-abi` 与 `DOCUMENTS/protocols/portable-node-protocol.md`。

---

## 步骤 3：测试驱动开发与原生构建

遵循测试先行原则，在 Rust 侧先写最小复现用例或单元测试：

### 1. 编写与运行 Cargo 测试

```bash
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-daemon
```

### 2. 重新编译与分发原生绑定

修改了 Rust 原生桥代码后，必须重新构建并同步二进制：

```bash
# 编译原生节点
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node

# 同步二进制文件到宿主目录
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs
```

### 3. 运行 TypeScript SDK 原生集成测试

```bash
npm --prefix packages/desktop test -- packages/sdk/javascript/tests/daemon-e2e.test.ts --silent
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

---

## 步骤 4：同步事实文档

任何内核行为的变化，必须同步更新以下当前事实文档（严禁保留退役过时设计）：

- [当前心智模型](../architecture/mental-model.md)：同步更新运行本体、微内核调度与不可破坏公理；
- [开发准入约束与架构红线](../architecture/development-constraints.md)：更新准入与边界规则；
- [Kernel 与 Node SDK](../guides/kernel-sdk-guide.md)：更新公开 API 与使用说明。

---

## 下一步

- 查阅完整开发准入约束：[开发准入约束与架构红线](../architecture/development-constraints.md)
- 查阅核心心智与公理：[当前心智模型](../architecture/mental-model.md)
- 接入跨语言运行时：[接入其他编程语言](add-language-runtime.md)
