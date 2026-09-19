---
type: Developer Guide
title: Kernel 与 Node SDK 开发指南
description: Node、ExecutionWorldNode/ObservationWorldNode、submission 与 NativeRuleSpace 原生规则空间规约。
status: stable
tags: [sdk, node, world-node, native-rule-space, effect-adapter]
---

# Kernel 与 Node SDK

## 原生规则空间生命周期

`new NativeRuleSpace()` 创建空 Rust 规则空间；`mountDomainNode`/`register` 只装配节点，业务启动由宿主另行注入 Info。`await space.evict(nodeId, { timeoutMs })` 密封投递，等待该节点当前 change 结束，丢弃 backlog，并等待清理。超时留下密封节点，不能据此认定物理动作已结束。同步 `unregister` 立即断代，其清理钩子仍等待旧 handler 结束。

`await space.shutdown()` 只终止已无节点、无活跃 change、无待清理资源的空间，不代替业务退出或节点卸载；关闭后不能重新装配或注入 Info，重复关闭幂等。`await space.dispose({ timeoutMs })` 是拥有该空间的宿主使用的组合清理操作，取消 submission、卸载节点再关闭内核，重复调用共享结果；清理失败以 `AggregateError` 返回。业务保存必须在调用它之前通过显式关闭 Info 完成。Rust `Kernel::shutdown`、N-API `RuleSpace.shutdown` 与 C ABI `gv_kernel_shutdown` 共享空空间终止契约。

`Node.dispose()` 幂等，执行全部 disposer 及 `onUnmount`，汇总清理错误而不吞掉。`space.waitForDisposals()` 用于等待同步卸载已排入的清理任务。桌面通用宿主 `createEmptyNativeGraphHost` 创建空空间，`await host.mountPlugins()` 显式装配，失败时清理本批已创建节点；`host.evict(nodeIds)` 返回逐节点结果，`host.shutdown()` 独立停机。`createNativeGraphHost` 保留便捷组合装配入口。

`interveneState` 在规则空间开始关闭后拒绝新请求；同一节点的编辑、替换和异步推出互斥，推出期间的 State 干预直接返回 busy，避免编辑等待与节点清理交叉。

Kernel `Node` 是执行和 State 所有权基类，不依赖分析继承，也不提供图标、分类、描述、副标题或展示摘要契约。开发期通过 `@graphvideo/sdk/analysis` 的 `inspectNodeObjects(nodes)` 读取现有实例的属性与业务方法 DTO；实例读取不执行 getter 或 change。展示内容由消费它的 UI/文档维护，不写入 Kernel Node。

## 1. 纯领域 Node

```ts
import { Node, type DomainChangeContext, type Info } from '@graphvideo/sdk/node'

interface CounterState {
  count: number
}

export class CounterNode extends Node<CounterState> {
  constructor(id = 'node-counter') {
    super(id, 'Counter', { count: 0 })
  }

  protected override change(info: Info, ctx: DomainChangeContext<CounterState>) {
    if (info.type !== 'IncrementRequestedInfo') return
    const count = ctx.read('count') + 1
    ctx.write('count', count)
    ctx.send({ type: 'CounterChangedInfo', count }, 'node-consumer')
  }
}
```

- 只通过 `ctx.send` 通信，目标是稳定 Node ID。`send` 返回轻量投递反馈：
  `enqueued` 表示已进入目标 Mailbox，`dropped` 表示本次未接纳（目标未准入、
  正处替换密封或空目标）。反馈只描述投递层物理事实，不等待下游 change，
  不携带业务返回值；`enqueued` 后仍可能在替换时被丢弃，最终诊断以 trace
  的 `InfoDropped` 事件为准。
- 不直接调用其他 Node，不声明 flows 或 Transition Registry。
- 不导入文件、网络、SQLite、PTY 或 Electron API。

推荐：

```ts
ctx.send({
  type: 'CounterChangedInfo',
  ...buildCounterPayload(count),
}, 'node-consumer')
```

禁止：

```ts
ctx.send(makeCounterChangedInfo(count), 'node-consumer')
```

这条约束不限制 payload 的复杂度，只要求因果协议判别字段在发送点可证明。`@graphvideo/sdk/analysis` 的 `validateCausalIndex` 遇到无法证明的发送会报告 `unresolved-info-type`（本地应用内经 `npm --prefix packages/desktop run diagnose -- validate` 触发），且不会把函数名或 `UnknownInfo` 加入分析图。

## 2. WorldNode 与 EffectAdapter：观察与执行分离

所有外部物理副作用（文件 I/O、数据库、系统进程、网络）必须通过 `WorldNode` 和构造注入的 `EffectAdapter` 执行。
**核心架构约束：WorldNode 必须严格分为执行与观察两类，两者职责物理分离，不得混合。**

### 执行类物理节点（ExecutionWorldNode）

负责主动向外部物理系统发起动作、修改外部状态、启动外部任务并取得提交句柄（handle）。执行完成后立即结算 change，零持续监听职责，不兼任轮询。

```ts
import {
  ExecutionWorldNode,
  type EffectAdapter,
  type Info,
  type WorldChangeContext,
} from '@graphvideo/sdk/node'

interface WriteRequest { path: string; value: string }
interface WriteObserved { path: string; bytes: number }

class FileWriteNode extends ExecutionWorldNode<{ lastWrittenBytes: number }> {
  constructor(
    id: string,
    private readonly adapter: EffectAdapter<WriteRequest, WriteObserved>,
  ) {
    super(id, 'FileWriteNode', { lastWrittenBytes: 0 })
  }

  protected override async change(
    info: Info,
    ctx: WorldChangeContext<{ lastWrittenBytes: number }>,
  ) {
    if (info.type !== 'WriteFileRequestedInfo') return
    const observed = await ctx.effectAdapter(this.adapter, {
      path: String(info.path),
      value: String(info.value),
    })
    ctx.write('lastWrittenBytes', observed.bytes)
    ctx.send({ type: 'WriteCommittedInfo', bytes: observed.bytes }, 'node-domain-owner')
  }
}
```

### 观察类物理节点（ObservationWorldNode）

负责独立监听外部物理事件、轮询外部状态或接收系统回调，并将物理感知事实作为 Observation 封装为 Info，定向 send 回传给领域 State Owner。零主动外部写操作，不兼任动作下发。

```ts
import {
  ObservationWorldNode,
  type EffectAdapter,
  type Info,
  type WorldChangeContext,
} from '@graphvideo/sdk/node'

interface PollRequest { taskId: string }
interface TaskProgress { taskId: string; progress: number; done: boolean }

class TaskWatcherNode extends ObservationWorldNode<{ currentProgress: number }> {
  constructor(
    id: string,
    private readonly adapter: EffectAdapter<PollRequest, TaskProgress>,
  ) {
    super(id, 'TaskWatcherNode', { currentProgress: 0 })
  }

  protected override async change(
    info: Info,
    ctx: WorldChangeContext<{ currentProgress: number }>,
  ) {
    if (info.type !== 'PollTaskRequestedInfo') return
    const observed = await ctx.effectAdapter(this.adapter, { taskId: String(info.taskId) })
    ctx.write('currentProgress', observed.progress)
    ctx.send({ type: 'TaskProgressObservedInfo', ...observed }, 'node-domain-owner')
  }
}
```

Adapter 契约：

```ts
interface EffectAdapter<Request, Observation> {
  readonly id: string
  execute(request: Request, context: {
    clock: Clock
    signal?: AbortSignal
    recordTransport?(metadata: unknown): void
    recordRawSummary?(summary: RawSummary): void
  }): Promise<Observation>
}
```

Adapter 必须响应 `context.signal`，并返回可被领域解释的 Observation。它不能直接写其他 Node State。

### change 内并发

同一 Node 的不同 change 永不并发，但一个 WorldNode change 可以并发等待多个互不依赖的 Adapter：

```ts
const observations = await Promise.all(requests.map((request) => (
  ctx.effectAdapter(adapter, request)
)))

ctx.patchState({ completed: observations.length })
```

这些调用共享当前 change 的生命周期与 submission 取消信号。并发请求的物理完成顺序不确定，因此应在全部 Observation 返回后集中推进 State；需要顺序保证时不要使用 `Promise.all`。JS Promise 并发不是 CPU 多线程并行。

## 3. 图装配与宿主（NativeRuleSpace 为生产标准）

具体 Node 由插件的 `createNodes` 创建，生产主进程宿主统一使用 `@graphvideo/sdk/node` 的 `NativeRuleSpace`（基于 Rust 原生微内核）：

```ts
import { NativeRuleSpace, mountDomainNode, replaceDomainNode } from '@graphvideo/sdk/node'
import { createPluginNodes } from '@graphvideo/sdk/plugin'

const nodes = createPluginNodes(plugins, dependencies)
const space = new NativeRuleSpace({ errorTargetNodeId: 'supervisor-node' })
for (const node of nodes) {
  mountDomainNode(space, node)
}
```

`mountDomainNode` 同步从该实例生成 `PortableAnalysisSnapshot`，随 admission 一起保存；`readStaticTopology()` 只读取这些已校验事实并过滤未准入目标。静态路由不是 Rust 调度器从 handler 文本猜出的运行时边，也不会用正则扫描 `Function#toString()`。JS 适配器使用 TypeScript AST；无法证明的 Info 类型或目标保留为分析诊断，不进入 topology。

> **注意**：旧有的纯 TypeScript `KernelRuntime` 已冻结为可执行规约与测试 Oracle（主要用于单节点无本地依赖的快速测试夹具 `createTestRuntime`），生产主线不再维护双内核并行演进。

依赖通过构造显式传入 WorldNode。微内核零业务语义，不知道任何具体业务服务名称。

运行期实体管理（原生空间与规约同构）：

```ts
mountDomainNode(space, newNode) // 动态准入，generation 从 0 或墓碑代次续计
space.unregister(nodeId)       // 驱逐：密封新投递、丢弃残留队列、代次 +1
await replaceDomainNode(space, newNode) // 等待当前单飞 change 结算后
                             // 丢弃旧队列、纯净挂载新实例（State 不继承）
space.getState(nodeId)       // 读取指定 Node 当前 State
space.generation(nodeId)     // 查询实体代次（含已驱逐墓碑）
```

替换语义：密封期间发往该 `nodeId` 的消息按 `dropped` 结算；旧队列逐条结算后
丢弃，不回放；新实例以自身构造初始 State 启动，历史上下文由上游沿因果链用
业务 Info 显式恢复。`replace` 等待在途 change 超时（默认 5000ms，可配
`replaceTimeoutMs`，单次可传 `{ timeoutMs }`）则抛错并保留旧实例；这是切换前未完成替换，不是新版本启动后的自动回滚。Projection `revision` 全程单调递增。

## 4. 错误即 Info

`change` 内同步 throw 或异步 rejection（非取消）不再击穿 Runtime，也不再默认
取消同 submission 的兄弟分支：失败记入 `ChangeRecord.error` 与
`NodeErrorRecorded` trace 事件，所属 delivery 正常结算；若构造时配置了
`errorTargetNodeId`，内核在原 delivery 结算前登记一条
`{ type: '@error/NodeFailed', nodeId, generation, changeId, message, ... }`
定向投递给该监督节点。错误 Info 再触发失败时不再自动转发（单跳截断），
无接收方时仅留痕。取消（AbortError）仍走取消路径，既有写入不回滚。

## 5. 根提交

```ts
const submissionId = space.injectRoot(
  'node-counter',
  { type: 'IncrementRequestedInfo' },
  'test/1',
)
await space.waitForSubmission(submissionId)
```

`waitForSubmission` 只等待该根提交的因果 delivery。`cancel(submissionId)` 会传播 AbortSignal，但不会回滚已有 State 或物理事实。
生产 `space.injectRoot` 接受 `nodeId` 字符串；测试工具 `createTestRuntime().injectRootInfo` 还接受 Node 实例。目标未准入或正处替换
密封时记一笔 `InfoDropped` 并让 submission 直接完成（无悬挂）。

## 6. Projection 与测试

```ts
const projection = space.readProjection()
const unsubscribe = space.subscribeProjection((next) => {})
```

测试应使用固定 Clock/ID/Adapter fixture，直接挂载最小节点集。不得从 renderer 创建 Runtime，也不得用临时 `node -e` 验证。

```bash
npm --prefix packages/sdk/javascript test -- <target-test> --silent
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop run diagnose -- validate
```

## 7. 原生规则空间宿主（Rust 调度 + 多语言 Node）

`@graphvideo/sdk/node` 的 `NativeRuleSpace` 把调度事实（实体登记、mailbox、
单飞、submission 结算、丢弃台账）交 Rust `packages/rust/kernel` 持有，业务 State 由宿主保管，
change 代码可在 JS 或进程协议 Node 中执行。Rust 与宿主不各存一份权威业务 State。JS 插件 `Node` 经 `mountDomainNode`/`describeDomainNode` 桥接挂载，
`change` 签名零改动：`read/write/patchState/send` 直通（投递反馈结构与
`DeliveryFeedback` 一致），`span` 内联执行（原生路径不记录 trace span），
`WorldNode` 通过构造注入的 EffectAdapter 执行，并接收宿主 Clock 与 submission AbortSignal。

源码内部的 `mountProcessNode` 通过 JSON Lines 挂载非 JS Node；外部进程仍通过当前 change 的 `read/write/patchState/send/effect` 请求访问宿主能力。当前公开 index 未转出这个 helper，公开跨语言接入使用 daemon worker/provider；协议、内部桥接形状与接入缺口见 [跨语言 Node 与分析事实协议](../protocols/portable-node-protocol.md)。现有 JS Node 不进入进程桥接路径。
宿主语言也可通过 `packages/rust/kernel-ffi` 的 C ABI 直接驱动同一个 Rust 调度契约；C 头文件和 Python ctypes 样例见同一协议文档。

热替换走与 TS 参考同一线性化语义：底层 `space.replace(id, initialState, handler, options, registration)` 在单飞间隙内丢弃旧
backlog（按 `Evicted` 结算）、代次 +1、干净槽启动；遇 Busy 有界重试（默认
5000ms）。宿主侧必须显式传入新实例初值，State 绝不隐式继承。`readProjection`
返回 EncodedValue、Node version/status、调度计数和单调 revision；`getState` 只返回
状态副本，不能绕过 change 修改权威 State。原生构建与包内暂存使用：

```bash
cargo build --manifest-path packages/rust/Cargo.toml -p graphvideo-kernel-node
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs
```

第二个 stage 将按平台命名的 .node 复制到 JS SDK 的 `dist/native/`，供 Electron 构建产物和独立包消费。桌面构建使用
`npm --prefix packages/desktop run build`；端到端演示见
`packages/desktop/host/native-graph-host.mjs` 与 `app/plugins/hello-counter/tests/native-graph-host.test.mjs`。
`space.replace` 可以在 JS change 运行期间提出：目标会立即密封，宿主等待单飞间隙
完成替换。`cancel` 会跳过排队投递，并中止该 submission 正在等待的 EffectAdapter；
已经写入的 State 和已经完成的物理副作用不回滚。
