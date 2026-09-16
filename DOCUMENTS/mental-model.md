---
type: reference
---

# GraphFramework 当前心智模型

GraphFramework 是由 Rust 调度器与外层宿主承载的开放因果图微内核框架。当前 Studio 使用 Electron 主进程内的 NativeRuleSpace，独立 Rust daemon 提供另一种语言无关宿主接入。当前仓库以源码包方式构建；源码与针对性测试高于本文。

## 1. 设计目标

这套架构不是为了把类、页面、服务或物理动作都包装成 Node，而是为了在业务复杂度增长后仍然保持四项性质：

- **唯一所有权**：跨 change 持续存在的业务事实有且只有一个 Owner，避免异步回调并发写入造成状态撕裂；
- **显式因果**：业务协作只由定向 Info 推进，每次 State 写入、下游发送和 Effect 都能回到触发它的 change；
- **物理圈禁**：领域决策与文件、网络、数据库、进程和系统 I/O 分离，物理结果必须作为 Observation 回到图中；
- **局部可理解**：生产 GraphFactory 是实际装配清单，实例分析从已构造 Node 的真实方法事实建立局部因果图，使排障和测试不依赖对全系统的记忆。

微内核负责调度、一致性、取消和可观测性，零业务语义；应用 Node 负责具体业务事实和决策；只读分析层负责寻址、切片、验证和视角折叠，并由生产 `NativeRuleSpace` 按需加载。实例分析提供的是可溯源的静态证据，不替代针对性运行测试和真实物理核对。
Rust 调度器另有 C ABI，供非 JS 宿主直接调用相同的 `admit/send/poll/settle` 操作；便携因果事实使 JS Agent 可分析外部语言节点，而不依赖其源码解析器。`packages/rust/kernel-daemon` 直接复用同一个 Rust 调度 crate，提供业务无关的独立进程宿主，持有通用 JSON State 与版本，并用 `poll + commit` 协议承载任意语言的 change；当前 Studio 生产装配尚未切换到该进程。

## 2. 一个业务执行面

```text
Electron renderer
  └─ React Elements / ApplicationClient
       │ Electron IPC：纯 DTO
       ▼
Electron main
  ├─ RendererGraphBridge
  ├─ NativeRuleSpace（生产与应用运行宿主）
  │  ├─ Rust mailbox/change/submission 调度（packages/rust/kernel）
  │  ├─ JS 或进程协议业务 Node、宿主持有的 State 与 change
  │  ├─ 构造注入的 EffectAdapter
  │  └─ JS 实例事实提取 → Rust N-API 因果分析与折叠视角（只读）
  └─ 文件、数据库、进程与窗口宿主

开发期与测试规约
  ├─ KernelRuntime：TypeScript 参考规约与测试 Oracle（只读规约，不再作为生产内核维护）
  └─ @graphvideo/sdk/analysis：JS 实例事实生成器、分析 DTO 与显式离线纯算法，不启动 Runtime
```

当前 Studio 生产 Graph 仍由 Electron main 内的 `NativeRuleSpace` 承载，renderer/main 的 IPC 是桌面安全边界。新增的 `kernel-daemon` 是可选的独立规则空间宿主，使用带版本和凭证的 loopback JSON Lines 协议；它复用同一个 `packages/rust/kernel` 调度器，不形成第二套执行语义。

桌面窗口的生命周期现由 Studio 图推进：主进程在 ready 后向 `host-el` 注入 `DesktopStartRequestedInfo`，关闭窗口的 UI 命令注入 `DesktopCloseRequestedInfo`；`host-el` 将物理动作定向发送给 `sink-electron-window`，其 EffectAdapter 执行 BrowserWindow 操作，`src-electron-window` 把执行结果和系统 `closed` 事件转为 Observation Info，最终由 `host-el` 更新 State。关闭所有窗口不销毁 `NativeRuleSpace`，Electron 主进程和其加载的 Rust N-API 调度器继续运行，可由第二次启动或系统 activate 重新开窗。独立的通用 Rust daemon 已可运行，但当前 Studio 仍驻留 Electron 主进程；生产迁移完成前，结束 Electron 主进程仍会结束这份 Studio 图。

## 3. 权限与归属

| 层 | 目录 | 权限 |
| :--- | :--- | :--- |
| 原生调度微内核 | `packages/rust/kernel`、`packages/rust/kernel-node` | 生产持有 mailbox、generation、single-flight 调度、submission 结算、hot replace |
| 核心规约与类型底座 | `packages/sdk/javascript/src/node` | Node/WorldNode、Info、Context、State、Projection 编解码、参考规约；零业务语义 |
| 业务插件与物理宿主 | `app/plugins`、`packages/desktop/host` | 插件定义业务 Node 和业务宿主接入，通用宿主通过 EffectAdapter 接触物理世界并挂载至 NativeRuleSpace |
| UI 工作台与投影 | `packages/frontend/workbench/src`、`packages/frontend/client`、`packages/desktop/renderer` | 发送固定命令，读取投影 DTO，不执行 Node |

## 4. 六个运行本体

### Node

Node 是私有 State 的自治 Owner。所有具体 Node 位于已装配插件的后端范围，由一个扁平 GraphFactory 创建。

### State

每个字段只有一个 Owner。普通业务变迁中，`ctx.read/write/patchState` 只能访问当前 Node 的 State。写入立即增加 Node 版本；单飞保证同一 Node 不会并发变迁。可信主进程的 Agent 控制面可以在 Rust 编辑保留位取得单飞间隙后，凭预期 generation/version 对该 Owner 的 State 做一次带审计的干预；这不是 Node 的 change，也不会自动发送 Info 或执行 Effect。当前实现不是可回滚数据库事务，取消不会撤销已经发生的写入。

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

Node 不暴露直接 `setState`、直接 send、Transition Registry 或 Runtime 旁路。Agent 干预是主进程持有的独立控制面，不加入 Node `ctx`。

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

### generation 替换是刻意断代

Node 热替换不是连续发布事务，而是明确的 generation 因果边界。`replace` 等待旧 Node 到达单飞间隙，随后丢弃旧 mailbox backlog、使旧 worker 租约失效，并用新实例声明的初始 State 干净启动。旧 State 不自动继承或迁移，旧 Info 不跨 generation 重放，新版本失败也不自动回滚；这些丢失与不回滚语义是有意设计，不是待补缺陷。

内核无法在零业务语义前提下判断两个版本的 State schema、Info 契约或已发生物理 Effect 是否兼容。需要保留或恢复业务事实时，应由业务通过显式 Info 建模；需要 Git 拉取、目录发现、编译器和依赖定位、安装、构建、启动或文件监听时，应由可选外层宿主完成。Rust 微内核不承担这些开发与部署职责。

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

可信主进程另有 Agent 控制面：`agentInspect` 读取 Projection、解码后的各 Node State、待投递 Info、drop ledger 和带游标的近期因果事件；`agentAnalyze` 查询当前实例的静态因果索引、折叠视角及结构指标；`agentInject` 向任意已装配 Node 注入根 Info 并取得物理投递反馈；`agentInterveneState` 在单飞间隙以 generation/version 比较后修改 State。干预留下 `state_intervened` 事件，包含 actor、reason、修改前后 State 和版本。近期事件在宿主内存中最多保留 1000 条；游标过旧会报告 `truncated`，它不是持久审计库。通用 Rust daemon 把同一控制面做成语言无关协议（`agentInspect/agentInject/agentInterveneState`），Node、Agent、Electron 与各语言 SDK 都只是外部 DTO 客户端；Agent State 干预仅支持 Patch。

## 6. 应用边界

主进程宿主把 renderer 方法翻译为经过 `rendererRoots` 校验的根 Info，或调用明确的图外桌面服务。图外服务不会被伪装成 Kernel 字段或边。当前 Studio preload 暴露项目、生成、资源、Element 和窗口固定接口，图协议只能向插件白名单允许的目标与 Info 类型注入；renderer 不能通过这些接口获得任意 Node 注入或 State 干预权限。`hello-counter` 仅是独立测试和离线诊断示例。Agent 控制面由独立的本机回环端口承载，使用启动时生成的随机令牌，并拒绝带浏览器 Origin 的请求；它不映射到 renderer IPC 或开放给可视化工具的遥测服务。

## 7. 实例驱动分析

`@graphvideo/sdk/analysis` 对真实 JS Node 实例调用 `inspectNodeObjects`，把属性和方法证据转换为每 Node 的 `PortableAnalysisSnapshot`；其它语言 Node 通过 [跨语言 Node 与分析事实协议](./portable-node-protocol.md) 提供相同纯数据。事实生成器属于各语言外层；语言无关的权威计算入口属于 Rust `graphvideo-analysis`，daemon `analyze`、N-API 与 C ABI 共享同一实现。`NativeRuleSpace.analyze` 已迁至 N-API，不再执行 TS 查询、折叠或指标兼容算法，返回与 daemon 相同的 JSON DTO；JS 实例描述可通过显式 `inspectNodeObjects` 离线读取，不属于内核分析操作。Rust 内核只在装配时保存外部 Node 事实并在 `admit/replace` 前校验。分析不执行 Node.change 或 Effect。

```text
entry  --inject--> info@Target
info   --trigger-> change
change --send----> info@Target
change --write---> state
state  --read-by-> change
state  --project-> ui
```

Node 的 contains/owns 是归属，不是路径捷径。分析工具接收普通 Node，但不创建或运行 Runtime。`inspect-nodes.ts` 读取数据属性与业务方法，不调用 getter 或 change。Kernel Node 不继承分析类，也不持有图标、描述、分类或副标题等展示字段。

分析契约支持 `FoldDefinitionFile`、`ExpansionViewFile`、`AnalysisCatalog` 与 `AnalysisView`。`foldDepth: 0` 合并根折叠组，`1` 展开一层，继续增加直到基础 Node；折叠视角只改变分析粒度，不增加运行时边。`all-nodes` 与 `all-granular` 分别提供 Node 级和细颗粒分析视角。API 与证据边界见 [实例因果分析](./causal-analysis.md)。

### 外部世界不例外

世界就是一张一直运行的图，软件与物理世界不分家。对任意一组被框定的 Node，框外 Node 就是它的外部世界——没有第二套“外部系统”概念：

- 物理世界只以 Observation 进图：`WorldNode` 经构造注入的 `EffectAdapter` 执行 I/O，返回的 Observation 经 Info 交回 State Owner（§4）。磁盘、网络、SQLite、窗口宿主不是图外的例外，只是尚未被框进来的 Node。
- 框定即定边界：`selectInducedSubgraph` 把任意 Node 集合划进来，被切断的 send/read 就是它与世界的交换面；`analyzeViewHealth` 检查这个边界是否被凿穿。内外之分是视角，不是本体。
- 折叠即世界切分：一组基础 Node 可以折叠为当前视角中的 Node，成员事实仍来自原始因果索引；折叠不改变因果，只改变粒度。
- 契约在 SDK，存储在消费方：`FoldDefinitionFile`、`ExpansionViewFile`、`AnalysisCatalog`、`AnalysisView` 定义在 `@graphvideo/sdk/analysis`；消费方自行决定命名视角的存储与装配。

## 8. 不可破坏的验收公理

1. 同一图只有一个权威规则空间。当前 Studio 使用一个主进程 NativeRuleSpace；daemon 是可选宿主，不与它并行维护同一图的第二份 State。
2. 每个 State 字段只有一个 Owner。
3. Node 间只通过实际 `ctx.send` 通信。
4. 同一 Node 的 change 严格 single-flight；单个 change 可并发等待独立 Effect，该约束不限制外部任务同时在途。
5. 普通 Node 的 State 写入和 send 只能经过当前 change ctx；可信主进程 Agent 可以经单飞编辑保留位进行显式、带版本校验与审计的 State 干预，也可以作为外部根注入 Info。
6. 纯领域 Node 零物理副作用；WorldNode 严格分为执行类（`ExecutionWorldNode`）与观察类（`ObservationWorldNode`），观察与执行职责必须物理分离。
7. renderer 只注入根 Info、只读取 Projection。
8. 应用命令等待自身 submission，不等待全图。
9. 媒体 URL 是可丢弃 DTO，磁盘路径不进入 UI。
10. 实例分析不创建 Runtime；生产规则空间仅按需执行只读分析，不介入调度或 Node change。
11. 节点报错即因果事实：Node 执行异常永远被捕获为特殊 Info，绝不击穿环境，可在图中自由发送与流转。
12. generation 替换刻意丢弃旧 backlog、重置 State、使旧租约失效且不自动回滚；内核不提供 State 自动继承/迁移、无缝切换或跨代消息保留。
13. Git、目录、编译器、依赖、安装、构建和进程启动属于可选外层宿主，不进入 Rust 微内核。
