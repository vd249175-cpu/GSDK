---
type: reference
---

# GraphFramework 当前心智模型

GraphFramework 是运行在应用主进程内的开放因果图微内核框架。当前仓库以源码工作区方式构建；源码与针对性测试高于本文。

## 1. 设计目标

这套架构不是为了把类、页面、服务或物理动作都包装成 Node，而是为了在业务复杂度增长后仍然保持四项性质：

- **唯一所有权**：跨 change 持续存在的业务事实有且只有一个 Owner，避免异步回调并发写入造成状态撕裂；
- **显式因果**：业务协作只由定向 Info 推进，每次 State 写入、下游发送和 Effect 都能回到触发它的 change；
- **物理圈禁**：领域决策与文件、网络、数据库、进程和系统 I/O 分离，物理结果必须作为 Observation 回到图中；
- **局部可理解**：生产 GraphFactory 是实际装配清单，实例分析从已构造 Node 的真实方法事实建立局部因果图，使排障和测试不依赖对全系统的记忆。

微内核负责调度、一致性、取消和可观测性，零业务语义；应用 Node 负责具体业务事实和决策；分析工具负责开发期的寻址、切片、验证和视角折叠。实例分析提供的是可溯源的开发期证据，不是 TypeScript 编译器，也不替代针对性运行测试和真实物理核对。

## 2. 一个业务执行面

```text
Electron renderer
  └─ React Elements / ApplicationClient
       │ Electron IPC：纯 DTO
       ▼
Electron main
  ├─ RendererGraphBridge
  ├─ NativeRuleSpace（当前本地应用生产宿主）
  │  ├─ Rust mailbox/change/submission 调度
  │  ├─ JS 业务 Node、State 与 change
  │  └─ 构造注入的 EffectAdapter
  └─ 文件、数据库、进程与窗口宿主

开发期旁路
  ├─ KernelRuntime：TypeScript 参考实现与测试运行时
  └─ @graphvideo/sdk/analysis：读取 Node 实例描述，不启动 Runtime
```

Kernel 不是独立进程，没有 Socket、握手、远程挂载或第二套执行器。renderer/main 的 IPC 是桌面安全边界。

## 3. 三层权限

| 层 | 目录 | 权限 |
| :--- | :--- | :--- |
| 微内核 | `core/src` | 调度 mailbox/change、State、Info、submission、Projection；零业务语义 |
| 业务插件与物理宿主 | `apps/local-app/plugins`、`apps/local-app/src-main` | 定义业务 Node，通过 EffectAdapter 接触物理世界 |
| UI 工作台与投影 | `sdk/workbench/src`、`sdk/client`、`apps/local-app/renderer` | 发送固定命令，读取投影 DTO，不执行 Node |

## 4. 六个运行本体

### Node

Node 是私有 State 的自治 Owner。所有具体 Node 位于已装配插件的后端范围，由一个扁平 GraphFactory 创建。

### State

每个字段只有一个 Owner。`ctx.read/write/patchState` 只能访问当前 Node 的 State。写入立即增加 Node 版本；单飞保证同一 Node 不会并发变迁。当前实现不是可回滚数据库事务，取消不会撤销已经发生的写入。

### Info

Info 是 Node 间唯一通信载体：

```ts
ctx.send(info, targetNodeId)
```

send 只负责将脉冲排入目标 Mailbox，不递归调用目标 Node。**发送节点不关心 send 后的具体业务执行情况与下游状态**（即发即忘，彻底杜绝 RPC 阻塞耦合）；内核可提供轻量即时物理投递反馈（已入队 `enqueued` 或本次未接纳 `dropped`），仅供节点做极简局部物理判定（如打点记录或探测降级），绝不阻塞当前单飞因果推进。系统没有 flows、声明边、observedEdges、GraphEdge、Wrapper 或广播总线。

### change

```text
Info → mailbox → single-flight change
     → ctx.read / ctx.write / ctx.send / ctx.effectAdapter
     → ChangeRecord / StateDelta → Projection
```

Node 不暴露直接 `setState`、直接 send、Transition Registry 或 Runtime 旁路。

### 错误即特殊 Info（Error as Causal Info）

Node 执行过程中的报错在代码层面**永远被安全捕获为一条特殊的 Info**，绝不击穿或宕掉微内核环境：

```text
Node change 异常 ──► 自动捕获 ──► 封装为 Error Info ──► 作为普通 Info 发送/流转
```

- **报错即因果事实**：物理世界与业务逻辑中的“失败”不是让进程崩溃的 Panic，而是图中的一个客观因果事实。
- **可随意定向发送**：错误 Info 与常规业务 Info 享有完全平等的流通权利。它既可由当前 Node 写入自身私有状态，也可通过 `ctx.send` 定向发送给下游消费者、错误收集器或专门的监督节点（Supervisor Node）进行告警、重试或熔断。
- **空间恒定不灭**：这一机制确保了即使业务节点代码出现未捕获异常，规则空间依然恒常稳定运转，并能将失败事实精确追踪到具体的因果链路中。

### 单飞与任务并行

必须区分 change 调度、change 内异步并发和外部任务并行：

| 范围 | 当前语义 |
| :--- | :--- |
| 同一 Node 的多个 change | 严格 single-flight，前一个结束后才处理下一条 Info |
| 单个 change 内的独立异步 Effect | 可以用 `Promise.all` 并发等待；仍属于同一 change/submission |
| 已提交到物理系统的多个外部任务 | 可以同时在途，不受单个 Node 实例数量限制 |
| 不同 Node 的 JS change | Rust 调度事实彼此独立；当前 `NativeRuleSpace` JS pump 逐个 `await handler`，尚不表示 JS handler 同时执行 |

change 内并发只适用于互不依赖的物理请求：

```ts
const [left, right] = await Promise.all([
  ctx.effectAdapter(leftAdapter, leftRequest),
  ctx.effectAdapter(rightAdapter, rightRequest),
])

ctx.patchState({ left, right })
```

推荐先并发取得全部 Observation，再由当前 change 集中写 State。不要让多个完成顺序不确定的回调分别竞争写 State；有先后依赖的 Effect 应显式串行。Promise 并发也不等于 JS CPU 多线程，CPU 密集工作应下沉到 Adapter 所管理的物理执行环境。

single-flight 保护的是 Owner State 的变迁，不是业务任务或物理任务的并发度。WorldNode 还可以只提交任务并取得 handle 后结束 change，由负责轮询或回调接收的 ObservationWorldNode 继续观察，再通过 Info 将 Observation 交回 State Owner。

因此，一个 Node 实例并不意味着只能存在一个外部在途任务。无论外部任务如何并行，Owner State 仍只能由 Owner Node 在后续单飞 change 中更新。

### WorldNode 与 EffectAdapter

纯领域 Node 不执行 I/O。所有物理操作圈禁在 `WorldNode`，且 **WorldNode 必须分为执行与观察两类，两者职责严格物理分离**：

- **执行类物理节点（`ExecutionWorldNode`）**：负责主动向外部物理系统发起动作、修改外部世界、启动外部任务并取得提交句柄（handle）。执行完成后立即结算 change，零持续监听职责，不兼任轮询；
- **观察类物理节点（`ObservationWorldNode`）**：负责监听外部物理事件、轮询外部状态或接收系统回调，将获取到的物理事实作为 Observation 封装为 Info，定向 `ctx.send` 回传给业务领域 Node。零主动外部写操作，不兼任动作下发；
- **观察与执行物理分离**：同一 Node 不得既发起物理写动作又承担外部事件监听或轮询，确保单飞变迁的职责纯粹与因果可追溯性。

只有 `WorldNode` 可以调用构造时注入的 EffectAdapter。Adapter 接收请求 DTO、Clock 和 AbortSignal，返回 Observation；不存在 Effect Registry 或任意函数式 effect。

### Projection

Projection 是 renderer 唯一可读的业务事实 DTO：

```ts
interface GraphProjection {
  revision: number
  nodes: Array<{ nodeId: string; state: EncodedValue; version: number; status?: string }>
  scheduler: {
    pendingDeliveries: number
    activeChanges: number
    scheduledGraphMicrotasks: number
  }
}
```

`ApplicationState` 只由 Projection 解码。选择、草稿和布局等非业务状态保存在 `ClientState`。

## 5. 根提交、完成与取消

renderer 图协议只有：

```text
请求：graph.injectRootInfo
      graph.cancel
      graph.projection.read
事件：graph.projection.updated
```

每个根 Info 获得一个 `submissionId`。命令完成表示该 submission 经 `ctx.send` 产生的待处理 delivery 已全部结算，不等待无关 submission。

`graph.cancel` 中止指定 submission 的 AbortSignal：未执行 delivery 会跳过，send/effect 会停止继续推进；已写 State 和已完成物理副作用不回滚。

## 6. 应用边界

主进程宿主把 renderer 方法翻译为经过 `rendererRoots` 校验的根 Info，或调用明确的图外桌面服务。图外服务不会被伪装成 Kernel 字段或边。当前本地应用只暴露 counter 读写与窗口控制白名单；renderer 不能指定任意 Node、Info 或 submission。

## 7. 实例驱动分析

`@graphvideo/sdk/analysis` 对真实 Node 实例调用 `inspectNodeObjects`，读取属性和方法描述 DTO，并建立：

```text
entry  --inject--> info@Target
info   --trigger-> change
change --send----> info@Target
change --write---> state
state  --read-by-> change
state  --project-> ui
```

Node 的 contains/owns 是归属，不是路径捷径。分析工具接收普通 Node，但不创建或运行 Runtime。`inspect-nodes.ts` 读取数据属性与业务方法，不调用 getter 或 change。Kernel Node 不继承分析类，也不持有图标、描述、分类或副标题等展示字段。

分析契约支持 `FoldDefinitionFile`、`ExpansionViewFile`、`AnalysisCatalog` 与 `AnalysisView`。折叠视角只改变分析粒度，不增加运行时边；`all-nodes` 与 `all-granular` 分别提供 Node 级和细颗粒分析视角。API 与证据边界见 [实例因果分析](./causal-analysis.md)。

### 外部世界不例外

世界就是一张一直运行的图，软件与物理世界不分家。对任意一组被框定的 Node，框外 Node 就是它的外部世界——没有第二套“外部系统”概念：

- 物理世界只以 Observation 进图：`WorldNode` 经构造注入的 `EffectAdapter` 执行 I/O，返回的 Observation 经 Info 交回 State Owner（§4）。磁盘、网络、SQLite、窗口宿主不是图外的例外，只是尚未被框进来的 Node。
- 框定即定边界：`selectInducedSubgraph` 把任意 Node 集合划进来，被切断的 send/read 就是它与世界的交换面；`analyzeViewHealth` 检查这个边界是否被凿穿。内外之分是视角，不是本体。
- 折叠即世界切分：一组基础 Node 可以折叠为当前视角中的 Node，成员事实仍来自原始因果索引；折叠不改变因果，只改变粒度。
- 契约在 SDK，存储在消费方：`FoldDefinitionFile`、`ExpansionViewFile`、`AnalysisCatalog`、`AnalysisView` 定义在 `@graphvideo/sdk/analysis`；消费方自行决定命名视角的存储与装配。

## 8. 不可破坏的验收公理

1. 一个业务执行面、一个主进程 RuleSpace。
2. 每个 State 字段只有一个 Owner。
3. Node 间只通过实际 `ctx.send` 通信。
4. 同一 Node 的 change 严格 single-flight；单个 change 可并发等待独立 Effect，该约束不限制外部任务同时在途。
5. State 和 send 只能经过当前 change ctx。
6. 纯领域 Node 零物理副作用；WorldNode 严格分为执行类（`ExecutionWorldNode`）与观察类（`ObservationWorldNode`），观察与执行职责必须物理分离。
7. renderer 只注入根 Info、只读取 Projection。
8. 应用命令等待自身 submission，不等待全图。
9. 媒体 URL 是可丢弃 DTO，磁盘路径不进入 UI。
10. 实例分析不创建 Runtime，也不参与生产运行。
11. 节点报错即因果事实：Node 执行异常永远被捕获为特殊 Info，绝不击穿环境，可在图中自由发送与流转。
