---
type: guide
---

# Kernel 与 Node SDK

Kernel `Node` 是执行和 State 所有权基类，不依赖分析继承，也不提供图标、分类、描述、副标题或展示摘要契约。开发期通过 `@graphvideo/sdk/analysis` 的 `inspectNodeObjects(nodes)` 读取现有实例的属性与业务方法 DTO；实例读取不执行 getter 或 change。展示内容由消费它的 UI/文档维护，不写入 Kernel Node。

## 1. 纯领域 Node

```ts
import { Node, type DomainChangeContext, type Info } from '@graphvideo/kernel'

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

这条约束不限制 payload 的复杂度，只要求因果协议判别字段在发送点可证明。`@graphvideo/sdk/analysis` 的 `validateCausalIndex` 遇到无法证明的发送会报告 `unresolved-info-type`（本地应用内经 `npm --prefix apps/local-app run diagnose -- validate` 触发），且不会把函数名或 `UnknownInfo` 加入分析图。

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
} from '@graphvideo/kernel'

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
} from '@graphvideo/kernel'

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

## 3. 图装配与热替换

具体 Node 由插件的 `createNodes` 创建，再由主进程宿主装配：

```ts
const nodes = createPluginNodes(plugins, dependencies)
const kernel = new KernelRuntime({ errorTargetNodeId: 'supervisor-node' })
kernel.mount(...nodes)
```

依赖通过构造显式传入 WorldNode。Kernel 零业务语义，不知道任何具体业务服务名称。

运行期实体管理（`mount` 保留作启动期装配兼容）：

```ts
kernel.admit(newNode)          // 动态准入，generation 从 0 或墓碑代次续计
kernel.evict(nodeId)          // 驱逐：密封新投递、丢弃残留队列、代次 +1
await kernel.replace(newNode) // 间隙暴力替换：等待当前单飞 change 结算后
                               // 丢弃旧队列、纯净挂载新实例（State 不继承）
kernel.readState(nodeId)      // 读取指定 Node 当前 State
kernel.getGeneration(nodeId)  // 查询实体代次（含已驱逐墓碑）
```

替换语义：密封期间发往该 `nodeId` 的消息按 `dropped` 结算；旧队列逐条结算后
丢弃，不回放；新实例以自身构造初始 State 启动，历史上下文由上游沿因果链用
业务 Info 显式恢复。`replace` 等待在途 change 超时（默认 5000ms，可配
`replaceWaitTimeoutMs`）则抛错并保留旧实例。Projection `revision` 全程单调递增。

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
const result = await kernel.inject({
  submissionId: 'test/1',
  targetNodeId: 'node-counter',
  info: { type: 'IncrementRequestedInfo' },
})

if (result.status === 'accepted') {
  await kernel.waitForSubmission(result.submissionId)
}
```

`waitForSubmission` 只等待该根提交的因果 delivery。`cancel(submissionId)` 会传播 AbortSignal，但不会回滚已有 State 或物理事实。
`injectRootInfo` 同时接受 Node 实例与 `nodeId` 字符串；目标未准入或正处替换
密封时记一笔 `InfoDropped` 并让 submission 直接完成（无悬挂）。

## 6. Projection 与测试

```ts
const projection = kernel.readProjection()
const dispose = kernel.subscribeProjection((next) => {})
```

测试应使用固定 Clock/ID/Adapter fixture，直接挂载最小节点集。不得从 renderer 创建 Runtime，也不得用临时 `node -e` 验证。

```bash
npx vitest run <target-test> --silent
npx tsc --noEmit
npm --prefix apps/local-app run diagnose -- validate
```

## 7. 原生规则空间宿主（Rust 调度 + JS 业务）

`@graphvideo/backend-sdk` 的 `NativeRuleSpace` 把调度事实（实体登记、mailbox、
单飞、submission 结算、丢弃台账）交 Rust `crates/kernel` 持有，业务 State 与
change 代码仍在 JS，Rust 与 JS 不各存一份权威业务 State。同一插件 `Node` 经 `mountDomainNode`/`describeDomainNode` 桥接挂载，
`change` 签名零改动：`read/write/patchState/send` 直通（投递反馈结构与
`DeliveryFeedback` 一致），`span` 内联执行（原生路径不记录 trace span），
`WorldNode` 通过构造注入的 EffectAdapter 执行，并接收宿主 Clock 与 submission AbortSignal。

热替换走与 TS 参考同一线性化语义：`space.replace(id)` 在单飞间隙内丢弃旧
backlog（按 `Evicted` 结算）、代次 +1、干净槽启动；遇 Busy 有界重试（默认
5000ms）。宿主侧必须显式传入新实例初值，State 绝不隐式继承。`readProjection`
返回 EncodedValue、Node version/status、调度计数和单调 revision；`getState` 只返回
状态副本，不能绕过 change 修改权威 State。构建见 `npm run build:native` 与
`npm run build:runtime`；端到端演示见
`apps/local-app/src-main/native-graph-host.mjs` 与同目录单测。
`space.replace` 可以在 JS change 运行期间提出：目标会立即密封，宿主等待单飞间隙
完成替换。`cancel` 会跳过排队投递，并中止该 submission 正在等待的 EffectAdapter；
已经写入的 State 和已经完成的物理副作用不回滚。
