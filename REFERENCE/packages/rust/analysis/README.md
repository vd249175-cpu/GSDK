---
type: Architecture Specification
title: graphframework-analysis 因果拓扑分析引擎规约
description: 语言无关的高性能 Rust 因果拓扑分析计算引擎、统一 analyze_json 派发器与请求契约。
status: stable
tags: [rust, analysis, topology, metrics, causal-graph]
---

# `graphframework-analysis` 因果拓扑分析引擎规约

源码目录：[`packages/rust/analysis/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis)  
源码入口：[`packages/rust/analysis/src/lib.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/lib.rs)

`graphframework-analysis` 是 GraphFramework 的权威拓扑计算核心。它纯由 Rust 实现，不依赖任何特定语言的 AST 解析器或运行时，接受来自 TypeScript、Python、Daemon 等语言适配器提交的因果事实快照（Snapshots）与前端关联上下文（Context），提供确定性的因果索引构建、拓扑切片查询与图算法指标计算。

---

## 1. 核心架构与请求派发入口

外部系统通过统一函数 [`analyze_json`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/lib.rs#L161) 发起分析计算：

```rust
pub fn analyze_json(
    request: &serde_json::Value,
    facts: &serde_json::Value,
    context: &serde_json::Value
) -> Result<serde_json::Value, String>
```

- **参数结构**：
  - `request`：携带操作名 `op` 及对应参数的 JSON 对象；
  - `facts`：包含 `{ "snapshots": [...], "liveStates": { ... } }`；
  - `context`：包含 `{ "frontendLinks": [...], "frontendServiceLinks": [...] }`。
- **构建索引**：内部首先调用 `build_index` 构建统一倒排索引 `Index`，随后按 `op` 路由派发至对应算法模块。

---

## 2. 操作名 (`op`) 矩阵与子模块归属

| 操作名 (`op`) | 职责描述 | 子模块 |
| :--- | :--- | :--- |
| `"index"` | 序列化全图索引（实体字典、依赖边、节点/状态/脉冲分区） | [model.rs](model.md) |
| `"facts"` | 返回纯净的 Snapshot 快照原始数组 | [model.rs](model.md) |
| `"validate"` | 校验全图合法性（孤立节点、未解析 Info 类型、悬空目标） | [query.rs](query.md) |
| `"entity"` | 按唯一全局地址（`address`）精准查询单个因果实体详情 | [query.rs](query.md) |
| `"expand"` | 展开指定实体的直接关联因果邻居 | [query.rs](query.md) |
| `"path"` | 寻找一组实体地址之间的最短因果传递链 | [query.rs](query.md) |
| `"select"` | 给定 Node ID 列表，提取对应的诱导子图（Induced Subgraph） | [query.rs](query.md) |
| `"view"` | 生成支持层级折叠（Fold）的宏观节点拓扑视图 | [views.rs](views.md) |
| `"health"` | 计算因果健康度指标（环路检测、死端节点、入度/出度比率） | [metrics.rs](metrics.md) |
| `"reach"` | 计算指定节点的可达集合与反向影响范围 | [metrics.rs](metrics.md) |
| `"centrality"` | 计算节点介数中心性（Betweenness Centrality）与枢纽分布 | [metrics.rs](metrics.md) |
| `"communities"` | 基于 Louvain 启发式算法发现宏观节点视图下的社区结构与模块度 | [metrics.rs](metrics.md) |
| `"granularCommunities"` | 在全量微观因果实体图上执行 Louvain 社区划分 | [metrics.rs](metrics.md) |
| `"compareCommunities"` | 将算法自动发现的社区与人工折叠（Fold）配置进行对比度量 | [metrics.rs](metrics.md) |

---

## 3. 子文档导航

- [因果图模型规约 (`model.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/model.md)：`Index`、`Entity` 7 大类型、`Edge` 关系与静态快照合并规则。
- [图算法与健康度度量 (`metrics.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/metrics.md)：有向有权图构建、拓扑排序、Brandes 中心性算法与 Louvain 社区划分。
- [因果切片与拓扑查询 (`query.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/query.md)：地址解析、双向展开、BFS 最短链路搜索与全图合法性校验。
- [因果视图与拓扑折叠 (`views.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/views.md)：多层级树状 Fold 折叠、边聚合权重计算与 UI 路径投影。
