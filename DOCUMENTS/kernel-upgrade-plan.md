---
type: plan
title: 微内核升级方案：从“发动机”演进为“物理规则空间”与热重载架构
description: 针对运行时与程序混淆问题的微内核范式转移方案，通过无特权生命周期 Info 与动态实体准入/驱逐机制，实现节点级在线热重载。
---

# 微内核升级方案：从“发动机”演进为“物理规则空间”与热重载架构

## 一、 现状诊断：为什么当前内核“运行时与程序混淆”？

当前微内核架构（以 `KernelRuntime` 为代表）虽然实现了单飞调度与因果单向推进，但在深层架构隐喻上，依然沿袭了**“发动机隐喻（Engine Metaphor）”**：

1. **装配期与运行期的二元固化**：
   - 节点的挂载目前主要依托于启动阶段的 `kernel.mount(...nodes)` 一次性装配；
   - 节点与 Runtime 形成了紧耦合的“一体化引擎总成”：节点像固定在发动机缸体内的活塞与齿轮，系统认为运行时等同于这些节点的集合；
   - 如果要增删或重写某个节点的逻辑，通常需要关闭整个 Runtime、重新创建实例并挂载，这直接导致无法进行局部热更新。
2. **生命周期具有外挂特权（Privileged Lifecycle）**：
   - 当前的 `dispose()` 或销毁操作是 Runtime 的宿主级管理 API，属于“图外神力”；
   - 节点自身无法在因果图内部像接收业务请求一样感知、流转自己的生命周期；
   - 缺乏由因果事件驱动的优雅收敛、排空与状态结转标准。

---

## 二、 核心升级思路：从“发动机”到“物理规则空间”

将微内核的定位从**“驱动业务代码运转的发动机”**彻底演进为**“自洽且永恒的物理规则空间（Rule Space / Physical Environment）”**。

```text
【旧范式：发动机隐喻】
  Runtime ══ [ 节点A ── 节点B ── 节点C ]  (发动机与内部齿轮锁死，停机才能换件)

【新范式：物理规则空间】
  ┌─────────────────── Rule Space (永恒物理空间) ───────────────────┐
  │                                                                 │
  │   物理法则：                                                    │
  │   - 作用力唯一媒介：ctx.send(info, targetNodeId)                 │
  │   - 状态质量守恒：仅 Owner 节点在 change 中可写入 State          │
  │   - 惯性单飞定律：单节点严格排队 single-flight                  │
  │                                                                 │
  │   空间内的实体（Entities）：                                    │
  │      [ Node A ]  ◄── Info ──►  [ Node B ]                       │
  │         ▲                          │                            │
  │       admit(放入)                evict(拿出)                    │
  │         │                          ▼                            │
  └─────────┼──────────────────────────┼────────────────────────────┘
        外部世界                     物理销毁 / 热更替换
```

### 空间的四大基本性质：
1. **默认环境稳定不宕机（Permastable Space）**：
   - 规则空间本身独立于任何具体的业务节点；空间是环境，业务是访客。
   - 空间永远不主动终止或宕机，单节点的异常、抛错或离开不影响规则空间本身的存在与运转。
2. **实体自由准入与驱逐（Admit & Evict）**：
   - 节点（Node）只是空间内的物理实体；
   - 空间提供原生的 `space.admit(node)`（丢入实体）与 `space.evict(nodeId)`（取出实体）能力，且这两个操作随时可以在空间运行中执行。
3. **物理法则普适且唯一**：
   - 空间内实体之间相互施加影响的**唯一合法手段是定向脉冲（`Info`）**；
   - 不存在任何后门、共享内存或跨节点的隐式调用。
4. **状态与实体分离（State Decoupling）**：
   - 节点的 State 是该实体在空间中的坐标与特征；
   - 当旧实体被拿出、新实体放入时，新实体可以在准入时无缝继承同一空间坐标下的持久化 State。

---

## 三、 生命周期哲学：生命周期没有特权，只是一条普通 Info

要彻底解耦运行时与程序，必须打破“生命周期是系统级特权 API”的传统思维。

> **核心公理：生命周期的本质就是一条从外部流入的普通 `Info`，它在因果图中自由流通，没有任何特权。**

### 1. 生命周期消息平权（Lifecycle Flattening）
- 传统的 `init()`、`start()`、`stop()`、`destroy()` 钩子全部被消除。
- 取而代之的是标准的物理脉冲：
  - `{ type: 'NodeStartRequestedInfo', ... }`
  - `{ type: 'NodeStopRequestedInfo', mode: 'drain' }`
- 这些 Info 遵循所有既有的物理定律：
  - 它们会排入节点的 Mailbox；
  - 触发节点标准的 `change(info, ctx)` 分支；
  - 节点的响应方式依然是标准的 `ctx.patchState`（记录运行状态）和 `ctx.send`（向下游通知自己的离开或启动）。

### 2. 局部优雅平息（Causal Drain）
当节点接收到关闭指令时：
- 节点标记自身为退出状态；
- 在当前 `change` 结算后，处理完 Mailbox 中现存的在途 `Info`，或者将未处理的 `Info` 暂存回空间；
- 触发观察者或外部环境感知到 Quiescence，完成物理收敛。

### 3. 错误即特殊 Info（Error as Causal Info）
在物理规则空间中，**Node 的执行异常永远被代码捕获为一条特殊的 Info**：
- **无致命 Panic，空间永不宕机**：Node 内部代码抛出的任何未捕获异常或断言失败，都会被调度器安全拦截并实体化封装为具象的 `ErrorInfo`。
- **平权流通与任意发送**：该 Info 不会触发中断停机，而是作为普通的因果事实在空间中自由流动。它可被写进自身 State、发送给依赖方作为失败通知、或定向抛给专门的监督节点（Supervisor Node）执行熔断、告警或重试。
- **确定性溯源**：报错成为可被因果链条检索的标准事实（如 `findCausalChain` 能清晰追踪到是哪个参数触发了该异常），消除无头异常。

---

## 四、 核心目标落地：节点级无感热重载协议（Hot Reload Protocol）

依托“物理空间 + 实体准入驱逐 + 生命周期 Info 平权”，热重载的落地流程收敛为一个极度优雅的物理替换过程：

```text
阶段 1: 平息 (Drain)
  外部系统 ─── inject(StopInfo) ───► [ 旧 Node 实例 ]
                                          │
                                       排空当前 Mailbox，落盘/暂存最新 State

阶段 2: 置换 (Swap)
  Space.evict(nodeId) ──────────────► [ 旧 Node 移除 ]
                                          │
  Space.holdMailbox(nodeId)           (期间到达该 nodeId 的外部 Info 进入空间缓冲暂存)
                                          │
  Space.admit(新 Node 实例, prevState) ► [ 新 Node 注入 ]

阶段 3: 激活 (Resume)
  外部系统 ─── inject(StartInfo) ────► [ 新 Node 实例 ]
                                          │
  Space.releaseMailbox(nodeId) ───────► (恢复缓冲队列，新代码无缝消费后续 Info)
```

### 关键机制设计：

#### 1. 空间级消息缓冲（Mailbox Stash）
- 当一个 Node 处于“正在被置换”的微小间隙（例如几毫秒的代码加载与切换期），上游节点可能正在向其 `ctx.send(info, nodeId)`。
- 空间识别到目标节点处于 `swapping` 状态，不会丢弃消息，也不会报错，而是将信息挂起在空间的局部缓冲区（Stash Buffer）；
- 一旦新 Node 通过 `admit` 归位并激活，缓冲区立即灌入新节点的 Mailbox，全图无任何感知，消息零丢失。

#### 2. 状态连续性（State Continuity）
- 节点的 State 本质上是 DTO；
- `evict` 时自动保留节点最新 State 快照；
- `admit` 时如果提供相同的 `nodeId`，默认将快照传递给新实例的构造或初始化上下文，确保业务状态无缝延续。

---

## 五、 规划的 API 演进方案

### 1. 内核空间接口演进（保持向后兼容）

```ts
export interface SpaceOptions {
  readonly id?: string
}

export class RuleSpace {
  // 1. 动态实体准入与驱逐
  admit(node: Node, initialState?: unknown): void
  evict(nodeId: string): { finalState: unknown }

  // 2. 实体安全热替换（原子事务）
  replace(newNode: Node, options?: { retainState?: boolean }): Promise<void>

  // 3. 普通物理脉冲注入（生命周期即普通 Info）
  injectRootInfo(targetNodeId: string, info: Info): string

  // 4. 状态与投影读取（环境不灭，投影常驻）
  readState(nodeId: string): unknown
  readProjection(): EncodedProjection

  // 5. 空间收敛等待
  waitForQuiescence(): Promise<void>
  waitForSubmission(submissionId: string): Promise<void>
}
```

### 2. 标准生命周期契约（通用协议）

在 `@graphvideo/sdk/contract` 中定义标准生命周期 Info 辨识类型：

```ts
export interface NodeStartRequestedInfo extends Info {
  readonly type: '@lifecycle/StartRequested'
  readonly timestamp: number
}

export interface NodeStopRequestedInfo extends Info {
  readonly type: '@lifecycle/StopRequested'
  readonly reason?: string
  readonly drainTimeoutMs?: number
}
```

---

## 六、 实施路径与里程碑（Milestones）

| 阶段 | 目标 | 交付物 | 验证方式 |
| :--- | :--- | :--- | :--- |
| **M1: 空间实体动态化** | 解耦内核装配期，支持运行期随时 `admit` 和 `evict` 节点。 | `core/src/space.ts` 或增强 `runtime.ts` | 针对性单测：在 Quiescence 循环中任意时刻丢入新 Node，验证因果拓扑即时扩展。 |
| **M2: 消息缓冲 (Stash) 机制** | 支持节点置换期间的信息挂起与安全重放，杜绝节点替换时的消息丢弃。 | `core/src/scheduler.ts` 增加实体占位与 Stash 队列 | 并发测试：上游持续高频 send，中间 Node 触发替换，验证置换完成后 100% 消息无序不丢失。 |
| **M3: 生命周期平权与 Info 标准化** | 制定标准生命周期 Info 契约，消除特权生命周期方法。 | `sdk/contract/lifecycle.ts` | 编写示例节点，仅通过响应 `StopRequestedInfo` 完成自清洁。 |
| **M4: 节点级热更新 API 与验证** | 交付 `space.replace(newNode)` 一键热替换方案。 | `core/` 导出原子热更方法并在 `apps/` 中演示 | 编写热更集成测试：无需重启应用进程，动态替换 CounterNode 增量算法，验证状态保持且新算法即时生效。 |

---

## 七、 总结

这一范式转变将微内核从“被动执行具体程序片段的单体容器”，提升为**“永远在线、规则恒定、支持万物动态来去的分布式仿真空间”**。
通过：
1. **空间（Rule Space）与实体（Nodes）的彻底物理分离**；
2. **生命周期 Info 化与平权**；
3. **准入（Admit）、驱逐（Evict）与暂存（Stash）三位一体的热重载机制**；

微内核将具备极高的弹性、自愈能力与现代运行时最渴望的**真正不停机热重载**特性。
