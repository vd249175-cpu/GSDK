---
type: Reference Manual
title: 因果拓扑演示插件 (Demo Topology Plugin)
description: 官方 demo.topology 插件的无遗漏参考手册。展示多节点扇出扇入、事务回执汇聚、运行期动态准入挂接节点与拓扑分析。
status: stable
---

# 因果拓扑演示插件 (Demo Topology Plugin)

插件 ID：`demo.topology`  
代码源码路径：
- 后端：[`app/plugins/backend/demo-topology/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/app/plugins/backend/demo-topology)
- 前端：[`app/plugins/frontend/demo-topology/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/app/plugins/frontend/demo-topology)

`demo.topology` 是 GraphFramework 官方提供的因果拓扑与路由机制标准范例。它模拟了经典的“订单履约与风控流水线”，演示了微内核中的核心架构特质：
1. **多节点因果定向流转**：`OrdersNode` -> `RouterNode` -> 并行扇出至 `[BillingNode, InventoryNode]` -> 汇聚扇入至 `LedgerNode`；
2. **运行期动态节点准入挂接 (Dynamic Node Attachment)**：系统启动后，动态创建 `FraudNode` 并通过 `AttachScreening` 指令动态注册进路由器的扇出名单；
3. **丢弃处理与因果证明**：路由器使用 `ctx.send(...)?.status === 'dropped'` 统计背压与失效消息；
4. **前端渲染根安全沙箱**：唯独 `demo.orders` 接受白名单校验的 `SubmitOrder`，工作台与渲染器不可绕过白名单直发后续内部节点。

---

## 1. 因果拓扑结构全景 (Topology Mesh)

```mermaid
flowchart LR
    subgraph Boundary ["受控边界 (rendererRoots)"]
        User["用户 / UI 触发"] -->|SubmitOrder| Orders["demo.orders<br>(OrdersNode)"]
    end

    Orders -->|OrderPlaced| Router["demo.router<br>(RouterNode)"]

    subgraph Pipeline ["并行扇出流水线 (Fan-out)"]
        Router -->|BillOrder| Billing["demo.billing<br>(BillingNode)"]
        Router -->|ReserveStock| Inventory["demo.inventory<br>(InventoryNode)"]
        Router -.->|ScreenOrder (动态挂接)| Fraud["demo.fraud<br>(FraudNode)"]
    end

    subgraph Convergence ["汇聚扇入 (Fan-in)"]
        Billing -->|ReceiptPosted| Ledger["demo.ledger<br>(LedgerNode)"]
        Inventory -->|StockReserved| Ledger
        Fraud -.->|FraudVerdict| Ledger
    end
```

---

## 2. 节点工厂与图工厂 (Factories)

### 2.1 节点类工厂：`createDemoTopology(ctx)`

导出路径：`import { createDemoTopology } from '../../app/plugins/backend/demo-topology/index.mjs'`

- **函数签名**：
  ```typescript
  function createDemoTopology(ctx?: {
    instanceId?: string;
    nodeIdFor?: (local: string) => string;
  }): {
    orders: OrdersNode;
    router: RouterNode;
    billing: BillingNode;
    inventory: InventoryNode;
    ledger: LedgerNode;
  };
  ```
- **返回值**：
  - `orders`: `OrdersNode`（默认 ID：`demo.orders`）
  - `router`: `RouterNode`（默认 ID：`demo.router`）
  - `billing`: `BillingNode`（默认 ID：`demo.billing`）
  - `inventory`: `InventoryNode`（默认 ID：`demo.inventory`）
  - `ledger`: `LedgerNode`（默认 ID：`demo.ledger`）

---

### 2.2 图工厂：`createDemoTopologyGraph(ctx)`

导出路径：`import { createDemoTopologyGraph } from '../../app/plugins/backend/demo-topology/index.mjs'`

- **函数签名**：
  ```typescript
  function createDemoTopologyGraph(ctx?: Context): Node[];
  ```
- **描述符元数据 (`createDemoTopologyGraph.describe()`)**：
  ```javascript
  {
    kind: 'graph',
    localIds: ['orders', 'router', 'billing', 'inventory', 'ledger'],
    requiredBindings: [],
    rendererRoots: [
      { localId: 'orders', infoType: 'SubmitOrder' }
    ],
  }
  ```

---

## 3. 节点类、状态机与 Info 字典

### 3.1 核心节点类规格

| 节点类名 | 默认 ID | 状态 Schema | 接收的 Info (`info.type`) | 发送的下游 Info |
| :--- | :--- | :--- | :--- | :--- |
| **`OrdersNode`** | `demo.orders` | `{ placed: number }` | `SubmitOrder` (`{ orderId: string }`) | 发送 `OrderPlaced` 至 `demo.router` |
| **`RouterNode`** | `demo.router` | `{ routed: number, dropped: number, screening: string[] }` | 1. `AttachScreening` (`{ nodeId: string }`)<br>2. `OrderPlaced` (`{ orderId: string }`) | 1. 扇出 `BillOrder` 至 `billing`<br>2. 扇出 `ReserveStock` 至 `inventory`<br>3. 扇出 `ScreenOrder` 至所有 `screening` 节点 |
| **`BillingNode`** | `demo.billing` | `{ billed: string[] }` | `BillOrder` (`{ orderId: string }`) | 发送 `ReceiptPosted` 至 `demo.ledger` |
| **`InventoryNode`** | `demo.inventory` | `{ reserved: string[] }` | `ReserveStock` (`{ orderId: string }`) | 发送 `StockReserved` 至 `demo.ledger` |
| **`LedgerNode`** | `demo.ledger` | `{ receipts: string[], reservations: string[], verdicts: string[] }` | 1. `ReceiptPosted`<br>2. `StockReserved`<br>3. `FraudVerdict` | 无（作为汇聚终点 State 集中地） |
| **`FraudNode`**<br>*(动态节点)* | `demo.fraud` | `{ screened: string[] }` | `ScreenOrder` (`{ orderId: string }`) | 发送 `FraudVerdict` (`{ orderId, verdict: 'clear' }`) 至 `demo.ledger` |

---

## 4. 动态节点准入模式 (Dynamic Node Attachment Pattern)

在测试中演示动态挂接时，先用初始图启动 `createTestRuntime`，再构造 `FraudNode` 并经宿主挂载（生产 run 中由宿主装配流程完成挂载），最后发 `AttachScreening` 让路由器把它加入扇出名单：

```javascript
import { createTestRuntime } from '@graphframework/sdk/testing';
import { FraudNode, createDemoTopology } from '../../app/plugins/backend/demo-topology/index.mjs';

const nodes = createDemoTopology({ instanceId: 'demo' });
const runtime = createTestRuntime({ nodes: Object.values(nodes) });

// 1. 在运行中构造筛查节点实例（生产 run 中由宿主挂载，这里用构造时传入演示同一效果）
const fraudNode = new FraudNode('demo/fraud', { ledger: 'demo/ledger' });
const runtimeWithFraud = createTestRuntime({ nodes: [...Object.values(nodes), fraudNode] });

// 2. 向路由器发送 AttachScreening Info，动态完成拓扑热插拔
runtimeWithFraud.inject({
  targetNodeId: 'demo/router',
  info: { type: 'AttachScreening', nodeId: 'demo/fraud' },
});
await runtimeWithFraud.waitForQuiescence();

// 3. 此后下达订单，FraudNode 将自动收到 ScreenOrder 并参与因果结算
runtimeWithFraud.inject({
  targetNodeId: 'demo/orders',
  info: { type: 'SubmitOrder', orderId: 'ORD-999' },
});
await runtimeWithFraud.waitForQuiescence();
runtime.dispose();
runtimeWithFraud.dispose();
```

---

## 5. 推荐装配与实例化方式 (Recommended Assembly)

### 5.1 工作流声明式装配 (`runs/<name>/assembly.mjs`)

```javascript
// runs/<name>/assembly.mjs
export default {
  id: 'demo.assembly',
  contribute(run) {
    // 1. 引入后端插件
    run.backendPlugin({
      id: 'demo.topology',
      path: '../../app/plugins/backend/demo-topology',
    });

    // 2. 引入前端插件
    run.frontendPlugin({
      id: 'demo.topology',
      path: '../../app/plugins/frontend/demo-topology',
    });

    // 3. 实例化整图
    run.graph({
      id: 'demo-topo',
      plugin: 'demo.topology',
      factory: 'createDemoTopologyGraph',
    });

    // 4. 守卫入口节点与汇聚账本节点
    run.requireNode('demo-topo/orders');
    run.requireNode('demo-topo/ledger');
  },
};
```

### 5.2 纯内存测试与状态验证

```javascript
import { createTestRuntime } from '@graphframework/sdk/testing';
import { createDemoTopology } from '../../app/plugins/backend/demo-topology/index.mjs';

const nodes = createDemoTopology({ instanceId: 'test-demo' });

// 挂载全部静态节点（构造时传入）
const runtime = createTestRuntime({ nodes: Object.values(nodes) });

// 提交订单并等待结算
runtime.inject({ targetNodeId: 'test-demo/orders', info: { type: 'SubmitOrder', orderId: 'ORDER-1001' } });
await runtime.waitForQuiescence();

// 验证账本节点的状态变迁（已同时收到发票回执与库存锁定回执）
const ledgerState = runtime.getState('test-demo/ledger');
console.log('Receipts:', ledgerState.receipts); // ['ORDER-1001']
console.log('Reservations:', ledgerState.reservations); // ['ORDER-1001']
runtime.dispose();
```
