---
type: Architecture Specification
title: 因果图数据模型与索引构建规约 (model.rs)
description: 因果实体 (Entity)、依赖边 (Edge)、全局地址规范 (Address) 与快照合并构建规约。
status: stable
tags: [rust, analysis, model, causal-entities, snapshot]
---

# 因果图数据模型与索引构建规约 (`model.rs`)

源码文件：[`packages/rust/analysis/src/model.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/model.rs)

`model.rs` 维护可移植因果图的纯内存倒排索引 [`Index`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/analysis/src/model.rs#L31-L41)。它将来自不同语言 Node 的静态事实与动态运行时状态融合成全局有向图。

---

## 1. 实体分类与全局地址规范 (`address`)

每个因果实体均具备全图唯一的全局字符串地址（`address`），杜绝命名冲突与跨节点冒充：

| 实体分类 (`kind`) | 全局地址格式 (`address`) | 归属规则与说明 |
| :--- | :--- | :--- |
| **`node`** | `node:{nodeId}` | 节点本体。每个快照必须且只能定义自身这一个 `node` |
| **`change`** | `change:{nodeId}::{subId}` | 该节点内部的一个因果变迁过程（Change Handler） |
| **`state`** | `state:{nodeId}::{fieldName}` | 节点拥有的状态字段。外部节点不可声明或私自写入 |
| **`info`** | `info:{infoType}@{nodeId}` | 进入该节点的脉冲入口（`target == nodeId`） |
| **`effect`** | `effect:{nodeId}::{subId}` | 节点触发的物理副作用请求 |

---

## 2. 关系边类型与因果形态规范 (`edge`)

因果图中的所有关系边必须是严格单向的物理事实，符合以下因果形态：

| 边类型 (`edge_type`) | 起点 (`from`) | 终点 (`to`) | 语义解释 |
| :--- | :--- | :--- | :--- |
| **`trigger`** | `info:...@{nodeId}` | `change:{nodeId}::...` | 外部脉冲触发了该节点特定 Change 的执行 |
| **`read-by`** | `state:{nodeId}::...` | `change:{nodeId}::...` | Change 执行过程中读取了本节点拥有的 State 字段 |
| **`write`** | `change:{nodeId}::...` | `state:{nodeId}::...` | Change 执行过程中写入更新了本节点拥有的 State 字段 |
| **`send`** | `change:{nodeId}::...` | `info:...` | Change 执行过程中通过 `ctx.send` 发送了派生脉冲 |
| **`effect`** | `change:{nodeId}::...` | `effect:{nodeId}::...` | Change 执行过程中调用了 `ctx.effectAdapter` |

### 置信度评级 (`confidence`)
每条关系边标注推导置信度：
- `"high"`：通过静态 AST 确凿证明或物理运行时直接捕获；
- `"medium"`：静态控制流分支推导；
- `"low"`：启发式猜测或动态反射派发。

---

## 3. 快照合并与索引构建校验 (`build_index`)

当调用 `build_index` 时，执行极其严格的合规性校验：
1. **单快照边界安全限制**：
   - 每个 Snapshot 的实体数量不超过 5000（`MAX_ENTITIES_PER_SNAPSHOT`）；
   - 依赖边数量不超过 20000（`MAX_EDGES_PER_SNAPSHOT`）；
   - 快照总数不超过 512。
2. **防冒充校验 (Impersonation Guard)**：
   - 校验快照内部声明的所有 `change`、`state`、`effect` 的 `nodeId` 必须严格等于快照归属的 `nodeId`；
   - 严禁任何插件节点伪造或声明属于其他节点的 State。
3. **动态状态合成 (Live-state Synthesis)**：
   - 若运行时提供了 `liveStates`，引擎自动与静态声明的 `state` 字段进行并集融合；若静态未声明但运行时出现新字段，自动动态补全。
