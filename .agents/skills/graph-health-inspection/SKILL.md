---
name: graph-health-inspection
description: >-
  Procedures and runbook for inspecting GraphFramework graph health, causal topology,
  and runtime observability across any named run or offline plugin nodes.
  Use when verifying graph health, inspecting causal routes, querying node metrics,
  analyzing topology (health, reachability, centrality, communities), or diagnosing
  runtime daemon state.
---

# GraphFramework 图健康度与因果分析技能手册

本手册指导如何在任意命名 `run`（或离线插件切片）中执行图健康度评估、因果拓扑静态分析与运行态观测。

---

## 核心维度概览

| 检查维度 | 核心关注点 | 关键指标 / 依据 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **拓扑与因果健康（Causal Health）** | 因果闭合性、是否有悬挂或未决通信、因果死循环、耦合与内聚 | `unresolved-info-type`、`cyclicNodeIds`、`stronglyConnectedComponents`、`density`、`routes` | 静态编译期、装配期、运行态 `analyze` |
| **运行时探活（Liveness & Quiescence）** | 微内核进程状态、单飞变迁结算、租约与在途工作屏障 | `pending: 0`、`leases: 0`、`effects: 0`、`closed: false` | 运行期探活、`status`、启停屏障 |
| **因果观测（Observability & Audit）** | 权威 State 投影、近期因果事件环形缓冲、丢弃台账、干预记录 | `projection`、`events`、`drops`、`activeChanges` | 调试排障、Agent 控制面检查 |

---

## 1. 运行态下的 Run 图检查（Live Run Inspection）

任何正在运行中的命名 run（配置位于 `runs/<name>/run.config.json`）均独占一个 Rust `kernel-daemon` 并在 `.generated/runtime/` 下持有通信端点与令牌。

### 1.1 命令行统一检查入口

在仓库根目录下执行 Bash 统一入口：

```bash
# 1. 运行期探活与进程所有权校验（检查 PID、未结算资源、停止状态）
bash ./run.sh status runs/<name>/run.config.json

# 2. 实时拓扑健康度分析（默认 op: health）
bash ./run.sh analyze runs/<name>/run.config.json

# 3. 实时全局视角与因果路由拓扑（op: view）
bash ./run.sh analyze runs/<name>/run.config.json '{"op":"view"}'

# 4. 实时视角折叠与分层分析（foldDepth: 0 查看根折叠组）
bash ./run.sh analyze runs/<name>/run.config.json '{"op":"view","foldDepth":0}'

# 5. 读取运行时投影、租约、近 100 条因果事件与干预审计
bash ./run.sh inspect runs/<name>/run.config.json '{"limit":100}'
```

### 1.2 健康度报告输出解读

执行 `analyze`（`op: 'health'`）返回的 JSON DTO 包含以下核心字段：

```json
{
  "nodeCount": 2,
  "density": 0.5,
  "reciprocity": 0.0,
  "cyclicNodeIds": [],
  "stronglyConnectedComponents": [],
  "nodes": [
    {
      "nodeId": "example.counter",
      "sourceNodeCount": 1,
      "inboundRoutes": 0,
      "outboundRoutes": 1,
      "inboundNeighbors": 0,
      "outboundNeighbors": 1,
      "afferentCoupling": 0,
      "efferentCoupling": 1,
      "instability": 1.0,
      "conductance": 0.5,
      "boundaryRatio": 1.0,
      "cohesion": 0.0,
      "directionalBalance": 0.0,
      "cycleMember": false
    }
  ]
}
```

- **`cyclicNodeIds` 与 `stronglyConnectedComponents`**：因果死循环检测。若出现非预期的环路，说明图中存在定向 Info 互相循环触发的风险，应重点排查。
- **`nodes.*.outboundRoutes` / `inboundRoutes`**：节点跨边界的发出/接收因果路由数。
- **`nodes.*.afferentCoupling` / `efferentCoupling`**：传入耦合度（依赖外部多少节点）与传出耦合度（被多少外部节点依赖）。
- **`instability`**：不稳定度（$Efferent / (Afferent + Efferent)$）。值为 1 表示纯发射源（如事件源），0 表示纯消费宿（如聚合收集器）。
- **`cohesion`**：组内自循环内聚度。

### 1.3 编程化连接与检查

若在自动化测试或 Node 脚本中直接探测：

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectKernelDaemon } from '@graphvideo/sdk/agent';

const runtimeDir = 'runs/alice/.generated/runtime';
const ready = JSON.parse(readFileSync(join(runtimeDir, 'kernel.stdout'), 'utf8').split(/\r?\n/)[0]);
const token = readFileSync(join(runtimeDir, 'daemon-token'), 'utf8').trim();

const client = await connectKernelDaemon({ address: ready.address, token });
try {
  // 1. 运行态健康
  const health = await client.health();
  console.log('Daemon Liveness:', health.pid, 'pending:', health.pending);

  // 2. 静态因果健康与视角
  const analysisHealth = await client.analyze({ op: 'health' });
  const view = await client.analyze({ op: 'view' });

  // 3. Agent 控制面透视
  const inspect = await client.agentInspect(0, 50);
} finally {
  client.close();
}
```

---

## 2. 离线 / 插件静态因果检查（Offline SDK Analysis）

在无须启动微内核、无真实 I/O 的情况下，直接对已构造的 Node 实例进行离线静态拓扑验证。

```ts
import {
  buildCausalIndex,
  validateCausalIndex,
  buildAllNodesView,
  analyzeViewHealth,
  findCausalPaths,
} from '@graphvideo/sdk/analysis';
import { createCounterNode } from '../../app/plugins/backend/hello-counter';

// 1. 构造目标节点实例
const nodes = [createCounterNode()];

// 2. 建立因果索引并校验静态事实
const index = buildCausalIndex({ nodeObjects: nodes });
const report = validateCausalIndex(index);

// 校验红线：严禁 unresolvedInfoTypes 与未决发送目标
if (report.unresolvedInfoTypes.length > 0) {
  throw new Error(`发现未静态证明的 Info.type: ${JSON.stringify(report.unresolvedInfoTypes)}`);
}

// 3. 构建全节点视角并运行纯健康度算法
const view = buildAllNodesView(index);
const health = analyzeViewHealth(view);

console.log('Offline Graph Health:', {
  nodeCount: health.nodes.length,
  density: health.density,
  cycles: health.cyclicNodeIds,
});

// 4. 寻径断言（验证两实体间是否有因果链）
const path = findCausalPaths(index, 'node:example.counter', 'state:example.counter::count');
console.log('Path status:', path.diagnostics.status);
```

---

## 3. 标准排障与修复流程（Checklist）

1. **红线排查（`unresolved-info-type`）**：
   - 检查所有 `ctx.send(info, target)`。`info.type` 必须是字面量或当前分支能静态推断的常量字符串，严禁通过动态函数或不可见变量传入。
2. **孤儿节点（Inbound & Outbound 为 0）**：
   - 若某节点 `inboundRoutes == 0 && outboundRoutes == 0`，排查该节点是否属于图根节点（需在 `run.config.json` 的 `lifecycle.startInfos` 或 `rendererRoots` 中声明注入入口），或者是否漏写了 `change` 中的发送逻辑。
3. **因果死循环（`cyclicNodeIds.length > 0`）**：
   - 检查是否有 Node A 发送 `Info1` 给 Node B，Node B 在当前 change 中又发送 `Info2` 触发 Node A 并再次发送 `Info1`。若业务需要双向流转，必须引入状态守卫或显式终止条件。
4. **运行期静止态异常（`pending > 0` 或 `leases > 0` 超时）**：
   - 检查是否有 `WorldNode` 发起异步 Effect 后没有正确回调 `completeEffect`，或 Worker 租约被异常终止。
