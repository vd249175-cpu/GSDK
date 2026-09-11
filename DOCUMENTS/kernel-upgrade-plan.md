---
type: plan
title: 微内核升级方案：从“发动机”演进为“Rust 原生物理规则空间”与热重载架构
description: 针对运行时与程序混淆问题的微内核范式转移方案，采用 Rust 重构微内核实现与 JS 业务实体的物理隔离，通过无特权生命周期 Info 与动态实体准入/驱逐机制，实现节点级在线热重载。
---

# 微内核升级方案：从“发动机”演进为“Rust 原生物理规则空间”与热重载架构

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
3. **技术栈同构导致物理隔离缺失（Homogeneous Stack Dilemma）**：
   - 当前内核调度器与业务 Node 全部用 TypeScript 书写，共享同一个 V8 进程和运行时堆；
   - 尽管架构规范严厉禁止跨层调用与后门，但在代码层面，由于共享 JS 执行上下文与内存空间，极易在心智与实现上模糊“空间宿主”与“访客实体”的界限；
   - 缺乏由编译器或物理硬件强制保证的硬边界。

---

## 二、 核心升级思路：从“发动机”到“Rust 原生物理规则空间”

将微内核的定位从**“驱动业务代码运转的发动机”**彻底演进为**“自洽且永恒的物理规则空间（Rule Space / Physical Environment）”**。

为了从根本上斩断运行时与程序的混淆，我们将微内核用 **Rust** 进行原生重构，确立**“Rust 永恒规则空间 + JS 动态业务实体”**的双层物理拓扑：

```text
┌─────────────────────────────────────────────────────────────┐
│              Rust 原生微内核 (Rule Space 物理环境)          │
│  - 纯物理法则：因果 DAG 拓扑、Mailbox 队列、原子单飞调度     │
│  - 空间性质：零业务语义、无 GC 抖动、强类型内存安全、永不宕机│
│  - 实体生命周期控管：admit / evict / 间隙原子暴力替换 (replace)│
│  - 投递决策：未达消息物理级原子丢弃、轻量投递反馈状态       │
└──────────────────────────────┬──────────────────────────────┘
                               │ N-API (napi-rs) 极简跨语言边界
┌──────────────────────────────▼──────────────────────────────┐
│           TypeScript / JavaScript (Guest 业务实体)          │
│  - 业务 Node 自由编码（change 图灵完备自由表达）            │
│  - 状态私有持有与纯净重启（State 随实例彻底消亡，绝不继承）   │
│  - 生命周期脉冲沿因果链自然流转（Start/Stop 普通 Info）      │
└─────────────────────────────────────────────────────────────┘
```

### 为什么选择 Rust 作为物理规则空间基座？
1. **语言级物理硬隔离（Physical Decoupling）**：
   - Rust 微内核独立编译为原生二进制模块（通过 `napi-rs` 供 Node.js/Electron 调用）；
   - Rust 源码在编译期物理上绝无可能引用或耦合任何 JS/DOM/UI 业务代码；JS 实体也无法跨越 FFI 边界非法侵入内核内部数据结构。两者语言不同、内存隔离，从根源上彻底终结“运行时与程序混淆”。
2. **“环境恒在不宕机”的绝对底气（Permastable Space）**：
   - Rust 卓越的类型系统、所有权机制与零 Panic 防御，使规则空间成为坚固的物理宿主；
   - 即使 JS 业务代码抛出未捕获异常，调度器安全拦截并实体化为 `ErrorInfo` 脉冲，Rust 空间永恒常驻、绝不宕机。
3. **微秒级原子热重载与投递（Zero-GC Atomic Hot Swap）**：
   - 在途消息的高速丢弃、单飞执行状态切换、实体指针的间隙暴力替换，在 Rust 侧通过原子原语和无锁结构完成，耗时仅几微秒，彻底摆脱 V8 GC 造成的不可控调度抖动。

### 空间的四大基本性质：
1. **默认环境稳定不宕机（Permastable Space）**：
   - 规则空间本身独立于任何具体的业务节点；空间是环境，业务是访客。
   - 空间永远不主动终止或宕机，单节点的异常、抛错或离开不影响规则空间本身的存在与运转。
2. **实体自由准入与驱逐（Admit & Evict）**：
   - 节点（Node）只是空间内的物理实体；
   - 空间提供原生的 `space.admit(node)`（丢入实体）与 `space.evict(nodeId)`（取出实体）能力，且这两个操作随时可以在空间运行中执行。
3. **物理法则普适且唯一**：
   - 空间内实体之间相互施加影响的**唯一合法手段是定向脉冲（`Info`）**；
   - 发送节点只发射脉冲，不关心下游业务执行情况（即发即忘，单向推进）；
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

### 4. 发送者的解耦哲学与轻量投递反馈（Unconcerned Sender & Delivery Feedback）
在因果物理模型中，必须彻底理清发送端与接收端的心智边界：
- **节点对 send 后的业务情况“完全不关心”（Unconcerned / Fire-and-Forget）**：
  - `ctx.send(info, targetNodeId)` 是非阻塞的单向脉冲发射；
  - 发送节点只负责将消息推向物理空间，**绝不关心、也不追踪后续下游节点的业务执行结果、处理耗时或状态转移**；
  - 节点不等待返回值，彻底杜绝同步 RPC（请求-响应）的阻塞耦合，确保自身单飞因果推进的独立性与确定性。
- **微内核提供轻量即时投递反馈（Delivery Feedback）**：
  - 尽管节点不关心下游业务情况，但物理空间在派发瞬间可提供极轻量的即时状态或回调，便于节点做一些局部物理判定：
    - `dropped`：目标节点不在空间中、尚未准入或正处于置换间隙，消息被空间直接丢弃；
    - `empty`：目标节点判定拒绝处理或产生空输出；
    - `enqueued`：消息已成功进入目标 Mailbox。
  - **判定边界极其严格**：
    - 该反馈**仅反映空间投递层的物理事实**，绝不携带下游 Node 的业务数据或堆栈；
    - 仅供发送节点做极简判定（例如：丢弃打点、探测目标存活、执行简单降级），严禁借此构筑伪 RPC 阻塞调用。

### 5. 错误即特殊 Info（Error as Causal Info）
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

## 五、 规划的 API 与跨语言架构演进方案

### 1. 架构拓扑：Rust 原生内核与 N-API FFI 边界

系统采用 **Rust 原生核心（Core）+ Node-API 桥接（FFI）+ TypeScript 开发者门面** 的三层分工：

```text
  [ Rust 原生微内核: crates/kernel ]
       ▲ 纯 Rust 实现：因果 DAG、单飞排队、Mailbox 队列、原子丢弃、Quiescence 判定
       │
  [ 跨语言绑定: crates/kernel-node (napi-rs) ]
       ▲ 导出极简二进制与 DTO 交换接口，零业务语义
       │
  [ TypeScript 门面: @graphvideo/core ]
       └─ 面向 JS/TS 开发者暴露强类型的 RuleSpace 与 ChangeContext
```

### 2. 内核空间接口（TypeScript 门面）

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

### 3. 发送反馈与投递契约（轻量物理判定，非 RPC 响应）

```ts
export type DeliveryStatus = 'enqueued' | 'dropped' | 'empty';

export interface DeliveryFeedback {
  readonly status: DeliveryStatus;
  readonly reason?: string;
}

export interface DomainChangeContext<S = any> {
  read<K extends keyof S>(key: K): S[K];
  write<K extends keyof S>(key: K, value: S[K]): void;
  patchState(patch: Partial<S>): void;

  // 发送即忘：不关心下游业务结果；返回极简物理投递状态或触发简单回调，仅供局部轻量判定
  send(
    info: Info,
    targetNodeId: string,
    options?: { onDelivery?: (feedback: DeliveryFeedback) => void },
  ): DeliveryFeedback;

  span<T>(name: string, action: () => Promise<T> | T): Promise<T>;
}
```

### 4. 标准生命周期契约（通用协议）

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
| **M1: Rust 原生规则空间核心** | 在 Rust 中实现纯粹物理规则空间：Causal DAG、单飞排队、实体动态准入（`admit`）与驱逐（`evict`）、未到达消息直接丢弃。 | `crates/kernel` (Rust crate) | `cargo test` 针对性测试：高并发单飞调度、实体动态增删时的未达消息直接丢弃。 |
| **M2: N-API 跨语言绑定与轻量投递** | 基于 `napi-rs` 封装跨语言边界，支持 JS Node 实体接入 Rust 调度循环与轻量投递反馈（`DeliveryFeedback`）。 | `crates/kernel-node` 与 `@graphvideo/core` 原生扩展 | 混合测试：JS Node 发送 Info 经由 Rust 内核单飞调度回发 JS `change`，验证丢弃/入队等轻量反馈。 |
| **M3: 间隙暴力热更新与纯净重启** | 在 Rust 侧实现微秒级原子 `replace(newNode)`：在单飞结算间隙暴力拔出旧实体、丢弃残留在途消息、注入新实体并纯净启动。 | `crates/kernel` 原子置换原语 | 压力测试：在上游持续发送洪峰中，动态热替换目标 Node，验证无内存泄露、旧消息直接丢弃、新实例初始状态生效。 |
| **M4: SDK 全面对接与应用热更演练** | `@graphvideo/core` 全面对接 Rust 原生内核，SDK 与前端工作台零感适配，在 `apps/local-app` 中演示不停机热重载。 | `apps/local-app` 热更演示 | 针对性单测 + 应用级热重载演示：不重启 Node.js 进程，动态替换业务 Node 代码并秒级生效。 |

---

## 七、 总结

这一范式转变将微内核从“被动执行具体程序片段的单体容器”，提升为**“永远在线、规则恒定、支持万物动态来去的物理规则空间”**。
通过：
1. **Rust 原生物理规则空间（语言与内存级硬隔离，彻底杜绝运行时与程序混淆，微秒级调度与永恒稳定）**；
2. **空间（Rule Space）与实体（Nodes）的彻底物理分离**；
3. **生命周期 Info 化与平权（启动/关闭皆普通消息，无系统特权，可沿因果链自然流转）**；
4. **change 的代码级自由表达（Node 自主决定状态逻辑，外部不可注入规则）**；
5. **准入（Admit）与驱逐（Evict）的间隙暴力热更机制（单飞间隙暴力替换、未达消息直接丢弃、State 绝不隐式继承）**；
6. **发送者解耦与轻量物理投递反馈（不关心下游业务情况，提供极简状态回调做物理判定，非阻塞无 RPC）**；

微内核将具备极高的一致性、轻量性与现代运行时最渴望的**真正不停机热重载**特性。
