---
type: Architecture Specification
title: graphframework-kernel-daemon 常驻图宿主守护进程规约
description: 常驻微内核守护进程架构、多 Session 租约调度、分布式 Effect 委派与行文本 JSON 协议。
status: stable
tags: [rust, daemon, kernel-daemon, multi-session, effect-delegation, protocol]
---

# `graphframework-kernel-daemon` 常驻图宿主守护进程规约

源码目录：[`packages/rust/kernel-daemon/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-daemon)  
源码入口：[`packages/rust/kernel-daemon/src/lib.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-daemon/src/lib.rs) 与 [`main.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-daemon/src/main.rs)

`graphframework-kernel-daemon` 是 GraphFramework 的常驻独立进程宿主。它在后台常驻运行 Rust 原生规则空间与只读/写入 JSON 状态树，允许外部多个客户端进程（Worker / Provider）以语言无关的方式挂载实体、拉取单飞任务并委派物理副作用。

---

## 1. 守护进程架构与多 Session 租约模型

```text
┌────────────────────────────────────────────────────────┐
│             graphframework-kernel-daemon               │
│                                                        │
│  ┌───────────────────┐        ┌─────────────────────┐  │
│  │ Rust Kernel       │        │ Node Records        │  │
│  │ (Single-flight)   │        │ (State & Version)   │  │
│  └───────────────────┘        └─────────────────────┘  │
│  ┌───────────────────┐        ┌─────────────────────┐  │
│  │ Leases & Sessions │        │ Effect Records      │  │
│  │ (Claim & Release) │        │ (Queued / Active)   │  │
│  └───────────────────┘        └─────────────────────┘  │
└───────────▲──────────────────────────────▲─────────────┘
            │ STDIN / STDOUT               │ Socket / IPC
┌───────────▼───────────┐      ┌───────────▼───────────┐
│ Node Worker (Python)  │      │ Effect Adapter (Node) │
│ Claims: ["node-calc"] │      │ Claims: ["adapter-fs"]│
└───────────────────────┘      └───────────────────────┘
```

- **Session 与租约机制 ([`Session`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-daemon/src/lib.rs#L56-L71))**：
  - 每个连接到 Daemon 的客户端分配唯一 `session_id`；
  - 客户端通过 `claim` 声明接管特定 Node ID 的执行租约；
  - 若客户端断开连接，Daemon 自动清理该 Session 的在途 Effect 与认领租约，未完成的任务重置回队列。
- **物理副作用异步外派 ([`EffectRecord`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-daemon/src/lib.rs#L45-L54))**：
  - Node 在执行 Change 时若需执行 I/O，向 Daemon 提交 Effect 请求；
  - 拥有对应 `adapter_id` 能力的外部 Provider（如专门的文件系统 Provider 或网络 Provider）通过 `poll_effect` 拉取请求；
  - Provider 执行完物理动作后，通过 `commit_effect` 将观察结果回传，驱动后续因果流转。

---

## 2. 通信协议动作集 (Protocol Actions)

守护进程通过标准输入输出（STDIN/STDOUT）或 Socket 接收以换行符分隔的 JSON 报文：

### 2.1 节点管理与认领
- `admit`：在宿主中准入新节点，初始化其 JSON State 与 Effect 权限集合。
- `claim`：Session 认领对某节点的处理权。
- `release`：Session 释放对某节点的认领。
- `evict`：注销节点，丢弃队列并产生墓碑。

### 2.2 任务拉取与结算 (Poll / Commit)
- `poll_change`：Worker 批量或单次拉取其认领节点中已到达的 Change。返回 `{ token, view }`。
- `commit_change`：Worker 执行完成后回传：
  - 更新后的 State Patch 或新版本；
  - 派生的新 `send` 脉冲列表；
  - 派生的 `effect` 申请；
  - 执行失败标记（若发生异常，自动转化为 `@error/NodeFailed` Info）。

### 2.3 副作用调度
- `poll_effect`：适配器 Provider 拉取对应 `adapter_id` 的未决副作用请求。
- `commit_effect`：适配器 Provider 回传物理操作的 Observation 事实。

### 2.4 控制面与调试接口
- `inject_root`：注入外部根脉冲。
- `intervene`：控制面强制修改节点 State（单飞间隙原子生效）。
- `snapshot`：读取全图节点当前 State、Version 与 Projection 映射。
- `events`：读取全局因果事件环形缓冲区（最多保留 1000 条最近事件）。
- `analyze`：针对当前图运行拓扑分析（直接调用内嵌的 `graphframework-analysis`）。
- `shutdown`：请求平稳停机。
