---
type: reference
---

# 实例因果分析

## 1. 能证明什么

`@graphvideo/sdk/analysis` 从调用方已经构造的 Node 实例及显式前端联动表建立静态 `CausalIndex`。分析过程不扫描插件目录、不创建 Runtime、不执行 getter/change，也不进入生产调度。

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

`nodeObjects` 是调用方实际构造的 Node；分析 SDK 不负责发现或装配。`frontendLinks` 明确补入应用入口和 State→UI 投影关系，`frontendServiceLinks` 记录图外服务消费者。

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
- `analyzeViewHealth`
- `analyzeViewReachability`
- `analyzeViewCentrality`
- `discoverViewCommunities`
- `discoverGranularCommunities`
- `compareCommunityPartitions` / `compareCommunitiesToView`

`buildAllNodesView` 将索引中的每个基础 Node 投影为一个视角 Node，并把 send 按来源、目标和 Info 类型聚合为保留 witness 的 route。SDK 不负责从磁盘读取或解析自定义 folds/views；其他视角仍由消费方构造。折叠只改变当前观察粒度，不修改基础因果事实或生产 Graph。

健康、中心性和 Louvain 社区结果只描述当前静态视角：

- 高耦合、强连通或高凝聚不证明存在生产根入口；
- 入度为零不证明 Node 应删除，可能存在未登记的宿主输入；
- `routeCount` 与 witness 是静态关系证据，不代表运行频率；
- 社区比较只报告 NMI/ARI/F1 与 split/merge，不自动重写人工视角。

## 6. 当前应用入口

`apps/local-app/scripts/diagnose.mjs` 暴露基础索引命令 `node/change/info/state/expand/path/select/frontend/validate`，并通过 `buildAllNodesView` 提供 `health/reach`。当前 `analysis/config.json` 只是消费方配置占位，不会被该脚本自动解析为自定义折叠视角。

完整使用方式见 [Node 实例因果调试指南](./debug-guide.md)。
