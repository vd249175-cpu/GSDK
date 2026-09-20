---
type: Developer Guide
title: 接入其他编程语言
description: 基于常驻 Rust 图宿主协议与跨语言便携事实协议，为 Python、Go、C++ 等外部语言接入 Node 与 Worker 运行时。
status: stable
tags: [language-runtime, ffi, c-abi, daemon-protocol, polyglot]
---

# 接入其他编程语言

GraphFramework 的生产调度微内核运行在独立的 Rust 进程中。内核本身零业务语义、语言无关。任何编程语言（如 Python、Go、C++、C#）均可通过**常驻图宿主协议（Kernel Daemon Protocol）**或 **C ABI 绑定**接入图生态，作为独立 Worker 承载特定语言的业务 Node。

---

## 跨语言接入心智模型

```text
[其他语言 Worker (Python / Go / C++)]
    │
    │ 1. 建立 IPC / RPC 连接并获取租约 (Lease)
    │ 2. 声明准入该语言实现的 Node 实例
    ▼
[Rust Kernel Daemon]
    │
    │ 3. Poll: 下发目标为该 Node 的待处理 Info
    ▼
[语言 Worker: 执行 Node change]
    │ (纯内存计算 / 捕获异常为 Info)
    ▼
[Rust Kernel Daemon]
    │ 4. Commit: 提交 State 增量与发出的下游 Info
    ▼
[权威因果推进与收敛]
```

---

## 核心接入步骤

### 1. 遵循常驻图宿主协议 (Kernel Daemon Protocol)

外部语言进程作为 Worker 接入时，需遵循协议定义的四步循环：

1. **握手与注册**：连接 daemon 端点，声明本 Worker 支持的 Node 工厂与实例列表，获取租约凭据。
2. **有序 Poll**：向 daemon 拉取已就绪的 Info 帧。
3. **安全执行与异常捕获**：
   - 执行目标语言 Node 的 `change(info, ctx)` 逻辑；
   - **异常处理铁律**：执行过程中的任何未捕获异常，必须在语言桥接层被安全拦截，封装为特殊的错误 Info（如 `ExecutionFailureInfo`）并提交，**严禁使未捕获异常击穿或崩溃守护进程**。
4. **原子 Commit**：向 daemon 提交该 change 产生的 State 补丁及所有由 `ctx.send` 发出的下游 Info。

协议详细结构与帧定义见：[常驻 Rust 图宿主协议](../protocols/kernel-daemon-protocol.md)。

---

## 数据序列化：便携事实格式与 EncodedValue

跨语言传输的 State 与 Info payload 统一采用 `EncodedValue` 进行序列化：

- **自描述类型**：支持布尔、整型、浮点、UTF-8 字符串、字节数组、列表与键值映射。
- **确定性编码**：避免语言特定的对象序列化（如 Python pickle 或 Java Serializable），确保跨语言边界的零歧义解析。

数据格式规约见：[跨语言 Node 与分析事实协议](../protocols/portable-node-protocol.md)。

---

## 使用 C ABI 原生链接（高性能场景）

对于需要进程内嵌入或极高吞吐的语言运行时，可直接链接 Rust 导出的 C ABI：

- 源码位于 `packages/rust/crates/kernel-c-abi/`；
- 导出标准 C 函数符号，支持通过 FFI（如 Python `ctypes`/`cffi`、Go `cgo`、Rust FFI）直接操纵图实例与执行推进。

---

## 验证与验收

接入新语言运行时后，必须编写完整的端到端验证用例：

1. **单节点因果闭环**：向该语言 Node 注入测试 Info，验证 State 正确变更并提交；
2. **跨语言因果互通**：验证该语言 Node 发出的 Info 能够被 TypeScript / Rust 节点正常接收和处理；
3. **租约失效与平稳停机**：模拟 Worker 进程崩溃与正常退出，验证 daemon 租约回收机制与资源清理。

---

## 下一步

- 查阅完整守护进程通信协议：[常驻 Rust 图宿主协议](../protocols/kernel-daemon-protocol.md)
- 查阅跨语言事实序列化标准：[跨语言 Node 与分析事实协议](../protocols/portable-node-protocol.md)
- 查阅核心架构不可破坏公理：[当前心智模型](../architecture/mental-model.md)
