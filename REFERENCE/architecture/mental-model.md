---
type: Architecture Specification
title: GraphFramework 核心心智模型与不可破坏公理
description: 系统的运行本体、单写者状态所有权边界、原生 Rust 微内核调度契约与 13 条不可破坏公理。
status: stable
tags: [architecture, mental-model, state-ownership, causal-order, single-flight, invariants]
---

# GraphFramework 核心心智模型与不可破坏公理

本文档是 GraphFramework 的最高心智中枢与理论基石。所有开发、重构与 Agent 操作均必须建立在本文阐述的心智模型之上。

信息发生冲突时，裁决顺序为：
```text
源码与针对性测试 > 核心心智模型 > 其它文档
```

---

## 1. 核心设计目标（四项基本性质）

GraphFramework 的设计**不是**为了把普通的函数、类、服务无意义地包装成 Node，而是为了在系统与业务规模指数级膨胀后，依然保持以下四项物理性质：

1. **唯一所有权 (Single Ownership)**：
   - 跨 Change 持续存在的业务事实**有且只有一个 Owner Node**。
   - 杜绝传统异步回调并发写入导致的状态撕裂与脏写竞争。
2. **显式因果 (Explicit Causality)**：
   - 业务协作**唯一通过定向 Info 推进**。
   - 系统的每一次 State 变更、下游发送和物理 Effect 均能精确溯源到触发它的上游 Change。
3. **物理圈禁 (Physical Encapsulation)**：
   - 领域计算与物理 I/O（文件、网络、数据库、进程、硬件）在物理结构上彻底隔离。
   - 外部事实只能作为观察结果（Observation）封装为 Info 回到图中。
4. **局部可理解 (Local Intelligibility)**：
   - 任何局部的排障、单测与重构，无需记忆全系统的状态，通过单节点单测 Harness 或诱导子图即可闭环验证。

---

## 2. 六大核心运行本体

```text
┌─────────────────────────────────────────────────────────────┐
│                       权威规则空间                           │
│                                                             │
│       Info (脉冲) ──► Mailbox (FIFO) ──► single-flight      │
│                                               │             │
│                                               ▼             │
│                                         Change Handler      │
│                                         ┌─────────────┐     │
│                                         │ ctx.read    │     │
│                                         │ ctx.write   │     │
│                                         │ ctx.send    │     │
│                                         │ ctx.effect  │     │
│                                         └─────────────┘     │
│                                               │             │
│                                               ▼             │
│                           State 变更 ──► Projection (投影)  │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Node（状态自治所有者）
- Node 是私有 State 的唯一自治 Owner；
- 外部节点绝不能跨节点读取或修改其内存对象；
- Node 对象自身不持有任何展示性字段（图标、中文名、分类），展示元数据由外部 DTO 维护。

### 2.2 State（单写者状态）
- 每个 State 字段只有一个 Owner；
- 普通业务中，`ctx.read/write/patchState` 只能访问当前 Node 自己的 State；
- 写入立即递增 Node 的版本号（`version`）；
- 单飞调度保证同一 Node 不会并发变迁。

### 2.3 Info（唯一因果流动载体）
- Node 间通信的唯一合法方式：`ctx.send(info, targetNodeId)`；
- 即发即忘：`send` 只将脉冲压入目标实体的 Mailbox，不递归执行下游代码，杜绝 RPC 阻塞耦合；
- 系统中**严禁增加 flows、Edge、Wrapper 或全局广播总线**。

### 2.4 change（单飞执行原子单元）
- 单飞执行（Single-flight）：对于任意实体，同一时刻**最多只有一个 Change 在执行**；
- 不暴露直接 `setState` 旁路。

### 2.5 错误即因果事实（Error as Info）
- **异常绝不崩溃内核**：Node 执行过程中抛出的任何未捕获异常，在边界自动被安全捕获并封装为一条特殊的 `@error/NodeFailed` 脉冲；
- **同等因果流通权**：错误 Info 享有完全平等的路由权利，可自由定向发送给下游、收集器或监督节点进行熔断或重试。

### 2.6 Projection（业务事实单一来源）
- 前端与消费端**唯一可读的业务事实来源**；
- 渲染层只能通过 `valueCodec.decode` 解码 Projection DTO，严禁在前端本地拼凑第二份业务状态。

---

## 3. 物理节点与副作用分离公理

纯领域 Node 必须保持“零 I/O、零系统 API”。物理世界操作必须圈禁在 `WorldNode` 中，且**执行与观察必须物理分离，严禁混合**：

```text
┌─────────────────────────┐          ┌─────────────────────────┐
│   ExecutionWorldNode    │          │  ObservationWorldNode   │
│   (执行类物理节点)       │          │   (观察类物理节点)       │
├─────────────────────────┤          ├─────────────────────────┤
│ • 主动向物理系统发动作  │          │ • 监听系统/网络/文件事件 │
│ • 修改外部状态          │          │ • 轮询外部状态          │
│ • 提交任务并获取 handle │          │ • 接收外部回调          │
│ • 执行完成立即结算      │          │ • 感知事实封装为 Info   │
│ • 零持续监听职责        │          │ • 定向 send 回业务图    │
│ • 不兼任轮询            │          │ • 零主动写操作          │
└─────────────────────────┘          └─────────────────────────┘
```

物理动作只能通过构造注入的 [`EffectAdapter`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript/src/effect/effects.ts) 执行，系统不存在全局自由函数式 I/O。

---

## 4. 破坏性 Generation 断代哲学

Node 的热替换（`replace`）或注销（`evict`）是**刻意的破坏性因果断代**，绝非无缝迁移事务：

1. **单飞间隙触发**：内核等待该实体当前正在执行的单飞 Change 结束；
2. **丢弃旧 Mailbox Backlog**：旧队列中排队的所有未决脉冲被物理丢弃，记入丢弃台账（`DropReason::Evicted`）；
3. **干净初始启动**：递增代数（Generation），新实例以全新初始 State 启动，旧租约与旧 Token 永久失效；
4. **不回滚、不继承**：内核无法在零业务语义下猜测新旧版本的状态兼容性。微内核坚决不提供“自动状态继承”、“失败自动回滚”或“跨代消息保留”。业务若需要数据持久化，必须显式通过外层存储恢复。

---

## 5. 13 条不可破坏的验收公理 (Invariants)

1. **微内核生产唯一**：生产调度唯一运行在 Rust 原生微内核（`packages/rust/kernel` 经 `NativeRuleSpace`），TS 原型内核仅作为只读规约/测试 Oracle。
2. **单一所有权**：每个 State 字段有且只有一个 Owner Node。
3. **唯一通信路径**：Node 间唯一通信只经 `ctx.send(info, targetNodeId)`。
4. **单飞排他保证**：同一 Node 的 Change 严格单飞串行，单个 Change 内可用 `Promise.all` 并发等待独立物理 Effect，但不突破 Owner 锁。
5. **单飞写入守卫**：State 只能由 Owner 在当前 Change 上下文中更新；控制面干预必须凭预期的代数与版本号在单飞间隙执行。
6. **世界节点物理分离**：纯领域 Node 零 I/O；WorldNode 严格区分为执行类与观察类，两者严禁合并在同一节点。
7. **投影单向消费**：UI 与前端只读消费 Projection，严禁在前端伪造第二份状态。
8. **任务自身结算**：应用命令与根提交仅等待自身 `submission` 终态，不等待全图。
9. **磁盘路径绝不上前台**：媒体 URL 是可丢弃的轻量 DTO，本地真实绝对路径绝不硬编码进 UI。
10. **静态分析零运行时**：因果分析不启动图运行时，只读读取静态证据与快照。
11. **错误即因果事实**：Node 异常永远被捕获为特殊的因果 Info，绝不击穿崩溃微内核。
12. **代数断代绝不妥协**：换代时彻底丢弃旧队列、重置状态、废弃旧租约，坚决杜绝无缝隐式迁移。
13. **外层宿主不侵入内核**：Git 拉取、目录发现、依赖安装、编译器定位与进程拉起属于外层宿主，严禁下沉入 Rust 微内核。
