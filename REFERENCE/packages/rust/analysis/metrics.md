---
type: API Reference
title: 图拓扑指标与因果健康度度量规约 (metrics.rs)
description: 拓扑健康度、可达性分析、Brandes 介数中心性与 Louvain 社区划分算法规约。
status: stable
tags: [rust, analysis, metrics, health, reachability, centrality, louvain]
---

# 图拓扑指标与因果健康度度量规约 (`metrics.rs`)

源码文件：[`packages/rust/analysis/src/metrics.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/metrics.rs)

`metrics.rs` 实现了严密的确定性有向图与加权图拓扑分析算法。所有算法均采用确定性平局决断规则（Tie-breaking by Node ID），确保相同输入在任何平台下产生比特级完全一致的输出。

---

## 1. 全图因果健康度度量 (`analyze_health`)

针对给定拓扑视图评估系统架构质量：

```json
{
  "viewId": "all-nodes",
  "nodeCount": 12,
  "routeCount": 35,
  "internalRouteCount": 8,
  "externalRouteCount": 27,
  "density": 0.2045,
  "reciprocity": 0.1818,
  "isolatedNodeIds": [],
  "sourceNodeIds": ["node-root-scheduler"],
  "sinkNodeIds": ["node-db-sink"],
  "weaklyConnectedComponents": [["node-a", "node-b", "..."]],
  "stronglyConnectedComponents": [["node-cycle-1", "node-cycle-2"]],
  "cyclicNodeIds": ["node-cycle-1", "node-cycle-2"],
  "nodes": [...]
}
```

### 核心健康指标算法：
- **环路检测与强连通分量 (Tarjan's SCC)**：检测是否存在因果回环（`cyclicNodeIds`）。正常因果图应保持有向无环（DAG），存在环路通常意味着潜在的无限脉冲循环。
- **孤立节点 (`isolatedNodeIds`)**：无任何入度与出度的死实体。
- **源节点 (`sourceNodeIds`)**：仅有出度无入度，通常为根事件触发源或观察节点（Observation Node）。
- **汇节点 (`sinkNodeIds`)**：仅有入度无出度，通常为终端执行类节点（Execution Node）。
- **互惠度 (`reciprocity`)**：双向路由占总边对的比例。

---

## 2. 节点因果可达性分析 (`analyze_reach`)

计算特定原点节点（`originNodeId`）的双向因果辐射能力：
- `upstream`：以 BFS 逆向搜索所有能因果传递到达原点的上游节点集合及最短跳数（`distance`）。
- `downstream`：以 BFS 正向搜索原点能因果影响的所有下游节点集合及最短跳数。
- `unreachableNodeIds`：既无法影响原点、也无法被原点影响的完全因果绝缘节点列表。

---

## 3. 节点介数中心性 (`analyze_centrality`)

基于经典的 **Brandes 快速介数中心性算法** 计算：
- **介数中心性 (`betweenness`)**：衡量一个节点作为所有节点对之间最短因果路径“交通咽喉”的频率。中心性极高的节点是系统的单点瓶颈与核心协调者；
- **度中心性 (`degree`)**：分别度量入度、出度与全度；
- **K-Core 核心数 (`coreNumber`)**：通过递归剥离度数最小顶点的剪枝算法计算核心子图深度。

---

## 4. Louvain 社区结构发现 (`discover_view` / `discover_granular`)

基于多阶段启发式 **Louvain 算法** 对带权路由进行模块度优化，自动将密集交互的实体聚类为高内聚、低耦合的子系统：
- **输入权重**：将多条并行的 Info 路由聚合为边权重；
- **优化目标**：最大化加权有向图模块度得分 $Q$（Modularity）；
- **输出**：社区划分方案 `{ "communities": [...], "modularity": 0.682 }`。

### 社区方案对比度量 (`compareCommunities`)
支持将算法自动发现的凝聚社区与人工配置的层级折叠（`folds.json`）进行对比度量，计算标准化互信息（NMI）与调整兰德指数（ARI），帮助架构师识别偏离真实因果流动的过时人工模块划分。
