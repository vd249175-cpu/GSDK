---
type: reference
---

# GraphFramework 当前心智模型

GraphFramework 是运行在应用主进程内的独立开放因果图微内核框架。源码与针对性测试高于本文。

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
  ├─ StudioRuntime
  │  ├─ KernelRuntime
  │  ├─ 扁平 Node 集合
  │  └─ EffectAdapter
  └─ 文件、数据库、进程与窗口宿主

开发期旁路
  └─ tools/causal：构造 Node 实例，由分析工具读取实例描述 DTO，不启动 Runtime
```

Kernel 不是独立进程，没有 Socket、握手、远程挂载或第二套执行器。renderer/main 的 IPC 是桌面安全边界。

## 3. 三层权限

| 层 | 目录 | 权限 |
| :--- | :--- | :--- |
| 微内核 | `core/src` | 调度 mailbox/change、State、Info、submission、Projection；零业务语义 |
| 业务插件与物理宿主 | `plugins/`、`app/src/nodes`、`app/src/effects`、`app/electron` | 定义业务 Node，通过 EffectAdapter 接触物理世界 |
| UI 工作台与投影 | `sdk/workbench/src`、`app/src/application`、`app/src/client` | 发送应用命令，读取 ApplicationState，不执行 Node |

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

send 只入队，不递归调用目标 Node。系统没有 flows、声明边、observedEdges、GraphEdge、Wrapper 或广播总线。

### change

```text
Info → mailbox → single-flight change
     → ctx.read / ctx.write / ctx.send / ctx.effectAdapter
     → ChangeRecord / StateDelta → Projection
```

Node 不暴露直接 `setState`、直接 send、Transition Registry 或 Runtime 旁路。

### 单飞与任务并行

single-flight 只约束同一 Node 同时最多执行一个 change，用于防止 Owner State 并发变迁；它不是业务任务或外部物理任务的并发度限制。一次 change 可以接收并处理多组数据，也可以并行发起多组 Effect 请求。WorldNode 还可以只提交任务并取得 handle 后结束 change，由其他负责物理轮询或回调接收的 WorldNode 继续观察任务，再通过 Info 将 Observation 交回 State Owner。

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

ApplicationClient 提供前端稳定方法；ApplicationHost 将方法翻译为根 Info，或调用明确的图外桌面服务。图外服务不会被伪装成 Kernel 字段或边。

唯一人工维护的关系表是 `app/src/application/frontend-links.ts`，描述：

```text
Application 方法 → 根 Node/Info → Owner State → ApplicationState → UI 消费者
```

Node 内部关系仍只从已构造实例的方法 DTO 中实际的 `ctx.send/read/write` 推导。

## 7. 本地资源
 
本地物理资源保存在项目目录，UI 只接收协议封装的可重建 URL 或 DTO：
 
```text
assets.url(nodeId, versionId)
  → custom-asset://node/<nodeId>/<versionId>
  → 宿主安全解析与响应
```

磁盘绝对路径不进入 ApplicationState。

### 项目 SQLite 快照

项目快照是用户手动触发的图外项目生命周期能力。Electron 物理宿主使用 SQLite backup 将活动 `.graphvideo/nodes.sqlite` 保存到 `.graphvideo/snapshots/`，并维护快照父子关系与逻辑分支。快照目录不复制进 Node State 或 ApplicationState；图形化页面打开时经 Application Service 按需读取。

从旧快照建立分支会先创建切换前保护快照，再将选中的 SQLite 快照恢复为活动数据库。恢复后的项目仍通过既有 `ProjectOpenedInfo` 进入 `src-fs-source`，由原有项目与 SQLite Owner 重新投影；项目快照不属于 `n-hist` 编辑器撤回栈。

## 8. 实例驱动分析

`tools/causal` 调用 GraphFactory 得到真实 Node 实例，由 `inspectNodeObjects` 读取属性和方法描述 DTO，并结合前端联动表建立：

```text
entry  --inject--> info@Target
info   --trigger-> change
change --send----> info@Target
change --write---> state
state  --read-by-> change
state  --project-> ui
```

Node 的 contains/owns 是归属，不是路径捷径。分析工具调用 GraphFactory 得到普通 Node，但不创建或运行 Runtime。实例反射完全属于 `tools/causal/inspect-nodes.ts`：它读取数据属性与业务方法，不调用 getter、change 或实例上的 State 查询覆盖方法。Kernel Node 不继承分析类，也不持有图标、描述、分类或副标题等展示字段；关系解析只针对这些真实实例。

分析侧允许通过 `analysis/folds.json` 将一组基础 Node 折叠并命名为当前视角中的 Node。折叠 Node 的 State、change、Info 与 Effect 从成员基础事实自动无损合并，不声明运行时边。`analysis/views/*.json` 只保存折叠项的展开情况。

自定义折叠视角与内置 `all-nodes` 使用相同的 Node 链路、健康和社区算法；内置 `all-granular` 将 change、State、Info 等作为原子顶点，只用于细颗粒社区发现。完整规则见 [causal-analysis.md](./causal-analysis.md)。

### 外部世界不例外

世界就是一张一直运行的图，软件与物理世界不分家。对任意一组被框定的 Node，框外 Node 就是它的外部世界——没有第二套“外部系统”概念：

- 物理世界只以 Observation 进图：`WorldNode` 经构造注入的 `EffectAdapter` 执行 I/O，返回的 Observation 经 Info 交回 State Owner（§4）。磁盘、网络、SQLite、窗口宿主不是图外的例外，只是尚未被框进来的 Node。
- 框定即定边界：`selectInducedSubgraph` 把任意 Node 集合划进来，被切断的 send/read 就是它与世界的交换面；`analyzeViewHealth` 检查这个边界是否被凿穿。内外之分是视角，不是本体。
- 折叠即世界切分：`analysis/folds.json` 把一组基础 Node 折叠命名为当前视角中的 Node，成员事实无损合并；`analysis/views/*.json` 只保存展开情况。折叠前后的 Node 链路、健康和社区算法完全相同——折叠不改变因果，只改变粒度。
- 契约在 SDK，实现在外：`FoldDefinitionFile`、`ExpansionViewFile`、`AnalysisCatalog`、`AnalysisView` 定义在 `@graphvideo/sdk/analysis`（`sdk/analysis/model.ts`）；命名 view 的存储（`analysis/*.json`）与解算（`tools/causal/views.ts`）留在仓内工具。第三方工作台共享世界切分时只依赖契约，各自决定存储。

## 9. 不可破坏的验收公理

1. 一个业务执行面、一个 StudioRuntime。
2. 每个 State 字段只有一个 Owner。
3. Node 间只通过实际 `ctx.send` 通信。
4. 同一 Node 的 change 严格 single-flight；该约束不限制外部任务并行。
5. State 和 send 只能经过当前 change ctx。
6. 纯领域 Node 零物理副作用；WorldNode 严格分为执行类（`ExecutionWorldNode`）与观察类（`ObservationWorldNode`），观察与执行职责必须物理分离。
7. renderer 只注入根 Info、只读取 Projection。
8. 应用命令等待自身 submission，不等待全图。
9. 媒体 URL 是可丢弃 DTO，磁盘路径不进入 UI。
10. 实例分析不创建 Runtime，也不参与生产运行。
