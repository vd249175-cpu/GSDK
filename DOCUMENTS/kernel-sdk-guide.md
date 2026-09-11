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

规则：

- `change` 只消费 Info，不接受服务或 Runtime 参数。
- 只通过 `ctx.read/write/patchState` 访问本 Node State。
- 只通过 `ctx.send` 通信，目标是稳定 Node ID。
- 每个发送的 `Info.type` 必须在当前 change 分支或局部对象中静态可见。辅助函数可以构造 payload，但不得通过 `ctx.send(makeInfo(...), target)` 隐藏完整 Info。
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

这条约束不限制 payload 的复杂度，只要求因果协议判别字段在发送点可证明。`npm run trace -- validate --json` 遇到无法证明的发送会报告 `unresolved-info-type`，且不会把函数名或 `UnknownInfo` 加入分析图。

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

## 3. 图装配

具体 Node 由 `app/src/nodes/studio-factories.ts` 创建：

```ts
const nodes = createStudioNodes({ sqlitePersistAdapter })
const kernel = new KernelRuntime()
kernel.mount(...nodes)
```

依赖通过构造显式传入 WorldNode。Kernel 零业务语义，不知道任何具体业务服务名称。

## 4. 根提交

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

## 5. Projection 与测试

```ts
const projection = kernel.readProjection()
const dispose = kernel.subscribeProjection((next) => {})
```

测试应使用固定 Clock/ID/Adapter fixture，直接挂载最小节点集。不得从 renderer 创建 Runtime，也不得用临时 `node -e` 验证。

```bash
npx vitest run <target-test> --silent
npx tsc --noEmit
npm run trace -- validate --json
```
