---
type: API Reference
title: 因果拓扑视图与层级折叠规约 (views.rs)
description: 宏观拓扑视图 (View)、路由聚合 (Route)、Witness 证明与层级折叠 (Fold Depth) 计算规约。
status: stable
tags: [rust, analysis, views, fold, aggregation, route]
---

# 因果拓扑视图与层级折叠规约 (`views.rs`)

源码文件：[`packages/rust/analysis/src/views.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/views.rs)

因果系统通常包含成百上千个微观事实（State 字段、Change 过程、Info 脉冲）。为了让架构师和前端可视化器清晰洞察系统结构，`views.rs` 将庞大的微观实体图聚合为**宏观节点级拓扑视图 [`View`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/views.rs#L36-L44)**，并支持多层级动态折叠（Fold Depth）。

---

## 1. 宏观视图与聚合路由模型

```rust
pub struct View {
    pub id: String,
    pub kind: String,                      // "all-nodes" 或 "fold"
    pub root: String,                      // 根折叠组标识
    pub expanded: Vec<String>,             // 展开的组列表
    pub nodes: BTreeMap<String, ViewNode>, // 视图节点集合（单节点或折叠聚合节点）
    pub routes: Vec<Route>,                // 聚合宏观路由
    pub base_map: BTreeMap<String, String>,// 原始 NodeId -> 聚合 ViewNodeId 映射
}
```

### 聚合路由 [`Route`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/views.rs#L11-L19)
若节点 A 内有多个 Change 向节点 B 发送相同类型的 `CounterInfo`，在视图层被自动合并为一条带权路由：
- `route_count`：该路由上发生的因果关联物理总次数（权重）；
- `internal`：布尔值。若为 `true`，代表起点与终点在当前折叠层级下属于同一个折叠组内部；
- `witnesses`：因果见证证据链（保留了底层每一条具体的微观 `send` 边 ID 与 Change 地址，确保宏观抽象不丢失微观证明）。

---

## 2. 全节点基础视图 (`build_all_nodes`)

`build_all_nodes(&index)` 是所有视图计算的基石：
- 提取全图所有已准入的 Node；
- 将微观 `change -> send -> info` 链式依赖升维提炼为 `Route(from_node, to_node, info_type)`；
- 聚合节点自身的内部状态与副作用能力，形成未折叠的全量宏观拓扑。

---

## 3. 层级折叠与深度计算 (`build_fold_view`)

当配置了折叠树（如通过 `folds.recommended.json` 声明领域分组）时，引擎根据指定的折叠深度 `fold_depth` 执行动态空间投影：
1. **组聚合节点 (`ViewNode.aggregate = true`)**：
   - 处于同一折叠组内的多个 Node 被压缩为一个聚合节点；
   - 聚合节点的 `states`、`changes`、`infos` 为所有子节点事实的无损并集。
2. **跨组路由动态再路由**：
   - 如果 A 和 B 均被折叠进组 G，则它们之间的路由被标记为 `internal = true`；
   - 如果外部节点 C 发往 A，该路由在视图中被重定向映射为 `C -> G`；
3. **确定性排序保障**：
   - 路由按 `(from, to, infoType)` 严格排序，保证生成视图在网络传输和图渲染引擎中的绝对确定性。
