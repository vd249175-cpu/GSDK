---
type: reference
---

# 实例因果分析

## 1. 能证明什么

`@graphvideo/sdk/analysis` 可从调用方已经构造的 JS Node 实例提取每 Node 的 `PortableAnalysisSnapshot`；其它语言生成相同纯数据。跨语言权威计算在 Rust `graphvideo-analysis` crate：daemon `analyze`、N-API `analyzeJson`、C ABI `gv_analyze` 共享同一实现，`KernelDaemonClient.analyze` 与 `NativeRuleSpace.analyze` 只组装或转发 DTO。JS 实例描述不属于统一内核查询；需要时显式调用 `inspectNodeObjects`。生产入口不扫描插件目录、不创建 Runtime、不执行 getter/change，也不介入调度。没有实例或便携事实的原始 handler 会作为 `opaque-handler` Node 保留，其当前 State 字段可见，但不会凭空推断 send。

基础实体与关系为：

```text
entry  --inject--> info@Target
info   --trigger-> change
change --send----> info@Target
change --write---> state
state  --read-by-> change
change --effect--> effect
state  --project-> ui
```

Node 的成员归属不构成路径边。静态索引说明源码和显式边界表中存在关系，不证明某次 submission 的真实执行顺序、频率或成功结果。

## 2. 建立与校验索引

```ts
const index = buildCausalIndex({
  nodeObjects: plugin.createNodes({}),
  frontendLinks,
  frontendServiceLinks,
})

const report = validateCausalIndex(index)
```

`nodeObjects` 是调用方实际构造的 Node；分析 SDK 不负责发现或装配。`frontendLinks` 明确补入应用入口和 State→UI 投影关系，`frontendServiceLinks` 记录图外服务消费者。生产宿主自动把插件已声明的 `rendererRoots` 转成无投影的入口事实；若调用方提供同一根入口的 `analysisFrontendLinks`，以显式联动表为准。State→UI 关系始终不得推测。

便携事实的 JSON 帧、Rust 保存周期和外部 Node 执行协议见 [跨语言 Node 与分析事实协议](./portable-node-protocol.md)。

只有静态可证明的 `Info.type` 与目标 Node 才进入 send 边。`unresolved-info-type` 和无法解析的发送目标是源码问题，不能生成 `UnknownInfo` 或根据变量名猜测。

## 3. 查询与路径

- `queryEntity`：按精确地址读取一个实体。
- `expandEntity`：读取一个实体的一层入边与出边。
- `findCausalPaths`：查询两个地址之间的有向最短路径。
- `findCausalChain`：按输入顺序分别检查相邻地址段；断链不阻止后续段检查。
- `selectInducedSubgraph`：选择基础 Node 集合并重算内部边界。

路径结果的 `diagnostics.status` 区分：

- `found`：在深度上限内找到路径；
- `depth-limited`：存在路径，但超过本次返回上限；
- `unreachable`：当前有限索引中不可达。

`shortestDistance` 是已确认的最短距离；`truncated` 只表示仍有未返回的最短路径，不是路径总数。前向失败时，`findCausalChain` 返回反向路径和 frontier 定位线索；它们不能自动证明故障点。

## 4. 子图边界

`selectInducedSubgraph(index, nodeIds)` 返回：

- `entities` / `edges`：选中 Node 内部实体和关系；
- `boundaryIn` / `boundaryOut`：穿过选择边界的关系；
- `rootInfos`：没有 SEND/INJECT 来源的 Info；
- `entryPoints` / `exitPoints`：当前子图的实际交换面。

删除 Node 或重构拓扑前，需要把这些结果与生产装配、renderer 根入口、State/Projection 消费者和真实 Adapter 一起核对。孤立或高内聚都只是结构证据，不等于“未使用”或“正确”。

## 5. 视角与结构指标

SDK 提供 `FoldDefinitionFile`、`ExpansionViewFile`、`AnalysisCatalog` 和 `AnalysisView` 契约，并提供以下纯算法：

- `buildAllNodesView`
- `buildFoldDepthView`
- `analyzeViewHealth`
- `analyzeViewReachability`
- `analyzeViewCentrality`
- `discoverViewCommunities`
- `discoverGranularCommunities`
- `compareCommunityPartitions` / `compareCommunitiesToView`

`buildAllNodesView` 将索引中的每个基础 Node 投影为一个视角 Node，并把 send 按来源、目标和 Info 类型聚合为保留 witness 的 route。`buildFoldDepthView(base, folds, foldDepth)` 对调用方提供的层级定义做完整叶子覆盖、重复、未知 Node 和环校验：深度 0 显示根折叠组，深度 1 显示其子组或基础 Node，深度继续增加直到基础 Node。跨组 route 与组内 route 保留原始 send witness。SDK 不从磁盘读取 folds/views；折叠只改变当前观察粒度，不修改基础因果事实或生产 Graph。

健康、中心性和 Louvain 社区结果只描述当前静态视角：

- 高耦合、强连通或高凝聚不证明存在生产根入口；
- 入度为零不证明 Node 应删除，可能存在未登记的宿主输入；
- `routeCount` 与 witness 是静态关系证据，不代表运行频率；
- 社区比较只报告 NMI/ARI/F1 与 split/merge，不自动重写人工视角。

## 6. 当前应用入口

`apps/local-app/scripts/diagnose.mjs` 仍是显式离线入口，使用发布包中的纯函数分析自身插件。生产 `NativeRuleSpace.analyze(request)` 从当前装配按需生成或读取便携事实，并通过 N-API 调用 Rust，支持 `index/facts/validate/entity/expand/path/select/view/health/reach/centrality/communities/granularCommunities/compareCommunities`；结果和 daemon 一样是 JSON DTO。增删替换 Node 会清除事实与结果缓存；State 字段集合进入缓存键，普通 State 值变化不会重算。daemon 的 `analysisRevision` 在增删替换、上下文变化或新增 State 字段时递增。`view` 及 Node 级指标可动态传 `foldDepth` 与可选 `folds`；未传 `folds` 时使用以全部当前 Node 为叶子的单层 `world` 根组。`agentInspect` 另提供 Projection、pending Info、drops、租约、pending Effects、submission 与事件游标。应用 Agent 控制通道的 `/analyze` 及 `node scripts/agent-control.mjs analyze request.json` 返回相同 DTO。`analysis/config.json` 是离线消费方配置，不会被自动解析。

完整使用方式见 [Node 实例因果调试指南](./debug-guide.md)。
