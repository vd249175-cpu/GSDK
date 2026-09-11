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
4. **状态与实体严格绑定（State Bound to Entity）**：
   - 节点的 State 是该实体内部私有的特征，随实体本身的驱逐而彻底消亡；
   - 旧实体被拿出时，旧 State 随之销毁；新实体放入时以自身全新的初始 State 启动，空间绝不自动继承或迁移旧状态。

---

## 三、 生命周期哲学：生命周期没有特权，只是一条普通 Info

要彻底解耦运行时与程序，必须打破“生命周期是系统级特权 API”的传统思维。

> **核心公理：生命周期的本质就是一条普通 `Info`，它可以来自外部输入，更常见的是来自上游节点沿因果链的正常流转。它在因果图中自由流通，没有任何特权；并非每个节点都直接暴露给外部，大多节点由上游通过因果关系自然驱动开启与关闭。**

### 1. 生命周期消息平权与链式流转（Lifecycle Flattening & Propagation）
- 传统的 `init()`、`start()`、`stop()`、`destroy()` 钩子全部被消除。
- 取而代之的是标准的物理脉冲：
  - `{ type: 'NodeStartRequestedInfo', ... }`
  - `{ type: 'NodeStopRequestedInfo', mode: 'drain' }`
- **指令来源的多元与拓扑现实**：
  - **绝非所有节点都直接面向外部系统**：因果图内的大多数领域节点（Domain Node）深嵌在网络中，根本没有向外部环境暴露控制端口的能力；
  - **沿链流转为主，外部注入为辅**：开启或关闭指令的大多数场景，是由**上游父节点、工作流调度节点或监督节点（Supervisor Node）通过标准 `ctx.send(info, targetNodeId)` 沿因果链向下传播**；只有图边界的根入口节点（Root Node），才由外部系统通过 `injectRootInfo` 触发；
  - 无论是上游发来的业务任务还是生命周期指令，在接收端看来遵循完全一致的物理规律。
- 这些 Info 遵循所有既有的物理定律：
  - 它们会排入节点的 Mailbox；
  - 触发节点标准的 `change(info, ctx)` 分支；
  - 节点的响应方式依然是标准的 `ctx.patchState`（记录运行状态）和 `ctx.send`（向下游通知自己的离开或启动）。

### 2. 判定拒绝与间隙暴力替换（Refuse & Brute-force Swap）
当节点接收到关闭指令时：
- `StopInfo` 绝非系统特殊句法，只是 Node 在其自由表达的代码中包含的普通判定分支（例如识别到关闭指令后标记自身，并在后续逻辑中直接拒绝处理其他业务 change）；
- **丢弃而非排空**：系统不需要等待积压的 Mailbox 慢慢消费完；
- **间隙暴力替换**：调度器只需等待当前正在执行的单飞（single-flight）`change` 结算完成的微小间隙（通常只需几微秒到几毫秒），直接执行暴力替换；
- 旧节点残留的 Mailbox 连同后续在途消息**全部直接丢弃**，新节点立即入驻接管。这使得即使节点存在高频消息洪峰，热重载也能瞬间确定性完成。

### 3. change 的本质：Node 内部代码的自由表达（Free Code Expression）
必须澄清：**`change` 是纯粹的代码级自由表达，绝非外部可写的判定规则**：
- `change(info, ctx)` 是开发者在具体 Node 类中用 TypeScript/JavaScript 书写的图灵完备代码，完全享有自由编码主权；
- 外部世界（包括外部系统与其他节点）**绝对无法从外部注入判定规则、脚本或动态逻辑**。外部对节点的唯一交互通道是发送不可变的只读数据契约（`Info` DTO）；
- 节点如何解释 `Info`、在何时拒绝变更、如何转移内部状态，全部内聚在 Node 源码之中；
- **修改逻辑的唯一正统途径**：编写新版本的 Node 代码类，通过运行期的间隙暴力替换（`space.replace`）将新实体放入物理规则空间，新代码随之以纯净初始状态生效。

### 4. 错误即特殊 Info（Error as Causal Info）
在物理规则空间中，**Node 的执行异常永远被代码捕获为一条特殊的 Info**：
- **无致命 Panic，空间永不宕机**：Node 内部代码抛出的任何未捕获异常或断言失败，都会被调度器安全拦截并实体化封装为具象的 `ErrorInfo`。
- **平权流通与任意发送**：该 Info 不会触发中断停机，而是作为普通的因果事实在空间中自由流动。它可被写进自身 State、发送给依赖方作为失败通知、或定向抛给专门的监督节点（Supervisor Node）执行熔断、告警或重试。
- **确定性溯源**：报错成为可被因果链条检索的标准事实（如 `findCausalChain` 能清晰追踪到是哪个参数触发了该异常），消除无头异常。

---

## 四、 核心目标落地：节点级间隙暴力热重载协议

依托“物理空间 + 实体准入驱逐 + 丢弃而非排空”，热重载的落地流程收敛为一个极度轻快、确定性的间隙置换过程：

```text
阶段 1: 停用判定与拒绝 (Refuse)
  上游节点 ctx.send(StopInfo) ───► [ 旧 Node 实例 ]
  (或外部系统注入入口节点)             │
                         Node 自由判定逻辑拒绝后续 change，等待当前单飞 change 结束（进入间隙）

阶段 2: 间隙暴力置换 (Brute-force Swap & Discard)
  Space.evict(nodeId) ──────────────► [ 旧 Node 移除，其残留 Mailbox 与未达消息全部直接暴力丢弃！]
                                          │
  Space.admit(新 Node 实例) ─────────► [ 新 Node 注入，以纯净初始状态启动，绝不继承旧状态！]

阶段 3: 承接与自然激活 (Resume)
  上游节点沿链派发新业务 Info ───► [ 新 Node 实例 ]
  (或外部系统注入新脉冲)               │
                                   新代码以全新逻辑开始消费新到达的业务 Info
```

### 关键机制设计：

#### 1. 未达消息自然丢弃（No Stash / Direct Drop）
- **空间保持纯粹物理特性，不做任何魔术缓冲**：
  - 当一个 Node 处于“正在被置换”的微小空隙（已被 `evict`、新 Node 尚未 `admit`），如果上游节点向该 `nodeId` 发送消息，**没有到达目标实体的消息直接丢弃**。
  - 空间不建立复杂的暂存队列（Stash Buffer），也不做消息积压与回放。
  - 这种设计让微内核保持绝对的精简与高确定性，避免在内核层引入由于挂起积压带来的内存泄漏、消息过期或死锁风险。

#### 2. 状态不继承与纯净重启（Clean State Reboot）
- **State 绝不跨实体生命周期自动继承**：
  - 节点的 State 是该实体私有的演化轨迹，严格绑定于该实体自身的存续；
  - 绝不隐式将旧实体的 State 迁移给新实体，彻底消除新旧代码版本间的 Schema 迁移地狱（Schema Migration Hell）；
  - 新节点被放入空间（`admit`）时，始终以自身代码定义的全新纯净初始 State 启动；
  - 若业务上需要恢复上下文或加载历史参数，必须由上游节点沿因果链派发业务 `Info`（或外部向入口节点显式注入）来显式推进状态，严禁内核层在底层隐式传递或塞入旧 State。

---

## 五、 规划的 API 演进方案

### 1. 内核空间接口演进（保持向后兼容）

```ts
export interface SpaceOptions {
  readonly id?: string
}

export class RuleSpace {
  // 1. 动态实体准入与驱逐（纯净初始化，消亡即销毁）
  admit(node: Node): void
  evict(nodeId: string): void

  // 2. 实体间隙暴力热替换（等待当前单飞 change 间隙，丢弃残留消息并纯净置换）
  replace(newNode: Node): Promise<void>

  // 3. 根部物理脉冲注入（仅限图边界入口节点，绝大多数内部节点通过上游 ctx.send 驱动）
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
}
```

---

## 六、 实施路径与里程碑（Milestones）

| 阶段 | 目标 | 交付物 | 验证方式 |
| :--- | :--- | :--- | :--- |
| **M1: 空间实体动态化** | 解耦内核装配期，支持运行期随时 `admit` 和 `evict` 节点。 | `core/src/space.ts` 或增强 `runtime.ts` | 针对性单测：在调度循环中任意时刻丢入/拿出 Node，验证因果拓扑即时伸缩。 |
| **M2: 未达消息自然丢弃与防御** | 目标节点不在空间时，未到达消息安全丢弃，绝不导致内核崩溃或消息阻塞。 | `core/src/delivery.ts` 安全派发逻辑 | 并发测试：上游持续向已下线/置换中的 Node 发送 Info，验证内核稳定运行、未达消息自然丢弃。 |
| **M3: 生命周期平权与 Info 标准化** | 制定标准生命周期 Info 契约，消除特权生命周期方法。 | `sdk/contract/lifecycle.ts` | 编写示例节点，仅通过响应 `StopRequestedInfo` 完成自清洁并在 change 中拒绝后续逻辑。 |
| **M4: 节点级间隙暴力热更新 API 与验证** | 交付 `space.replace(newNode)` 间隙暴力热替换方案，丢弃残留消息并纯净初始化。 | `core/` 导出原子热更方法并在 `apps/` 中演示 | 编写热更集成测试：无需重启应用进程，动态替换 CounterNode 逻辑，验证旧未达消息被丢弃、新节点以初始状态干净启动且新逻辑即时生效。 |

---

## 七、 总结

这一范式转变将微内核从“被动执行具体程序片段的单体容器”，提升为**“永远在线、规则恒定、支持万物动态来去的物理规则空间”**。
通过：
1. **空间（Rule Space）与实体（Nodes）的彻底物理分离**；
2. **生命周期 Info 化与平权（启动/关闭皆普通消息，无系统特权，可沿因果链自然流转）**；
3. **change 的代码级自由表达（Node 自主决定状态逻辑，外部不可注入规则）**；
4. **准入（Admit）与驱逐（Evict）的间隙暴力热更机制（单飞间隙暴力替换、未达消息直接丢弃、State 绝不隐式继承）**；

微内核将具备极高的一致性、轻量性与现代运行时最渴望的**真正不停机热重载**特性。
