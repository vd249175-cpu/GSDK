---
type: API Reference
title: 因果拓扑切片与查询规约 (query.rs)
description: 实体地址检索、邻域展开 (expand)、因果路径搜索 (path) 与诱导子图选择 (select)。
status: stable
tags: [rust, analysis, query, path, subgraph, validation]
---

# 因果拓扑切片与查询规约 (`query.rs`)

源码文件：[`packages/rust/analysis/src/query.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/query.rs)

`query.rs` 提供面向可视化工具与控制面的低延迟因果图切片与查询能力，支持在微观实体级进行点查、拓扑展开与路径回溯。

---

## 1. 实体点查与地址消歧 (`query_entity`)

- **查询方式**：
  - 支持传入完整规范地址（如 `node:node-counter`、`state:node-counter::count`）；
  - 支持传入 Info 短地址（如 `info:CounterChangedInfo`）。若该 Info 在全图中仅有一处目标，自动补全解析；若存在多处接收目标，返回清晰的歧义错误（`Ambiguous Info address; use one of: ...`）。

---

## 2. 邻域展开 (`expand_entity`)

针对任意给定的实体地址，提取其一阶因果直接依赖：
- **针对节点 (`node`)**：自动将其拥有的所有内部事实（Change、State、Effect）视为统一边界，返回进入该节点的外部 `inbound` 边及源实体，以及从该节点派发出去的 `outbound` 边及目标实体。
- **针对微观实体 (`change` / `state` / `info`)**：直接返回该微观节点的入边前驱与出边后继。

---

## 3. 因果传递路径搜索 (`find_chain`)

支持在任意多个实体地址之间搜索因果影响传播链路（Causal Chain）：
- **参数约束**：
  - `maxDepth`：最大搜索深度（默认 6，防止深层图爆炸）；
  - `maxPaths`：最大返回路径数（默认 5 条最佳因果链）。
- **算法模型**：
  - 基于加权 BFS 优先遍历核心因果边类型（`trigger`、`send`、`write`、`read-by`、`effect`）；
  - 自动跳过弱置信度边或与因果流向相反的无效依赖，返回格式化链路数组。

---

## 4. 诱导子图提取 (`select_subgraph`)

给定一组关注的节点 ID 集合（`nodeIds`），自动切片出仅包含这些节点的微观子系统：
- **`nodes`**：选中的节点对象集合；
- **`entities`**：属于这些节点的所有微观实体（State、Change、Info、Effect）；
- **`edges`**：两个端点均属于所选内部实体的内部依赖边；
- **`boundaryIn`**：来自未选中外部节点、指向本子图的入口边（外部依赖）；
- **`boundaryOut`**：从本子图发往未选中外部节点的出口边（外部影响）。

---

## 5. 全图健康合规校验 (`validate_index`)

在不运行图的前提下静态验证因果图的闭合性与规范性：
- **未解析的脉冲类型 (`unresolvedInfoTypes`)**：节点中声明了 `ctx.send` 发送某种 Info，但没有任何节点监听它（悬空信息）；
- **未解析的发送目标 (`unresolvedSendTargets`)**：`ctx.send` 指向的 `targetNodeId` 在全图中未被任何已准入节点认领；
- **悬空依赖边 (Dangling Edges)**：边的端点地址不存在于已知实体集合中。
