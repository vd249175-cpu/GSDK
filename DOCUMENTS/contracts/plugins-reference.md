---
type: Contract
title: 插件全景与契约索引 (Plugin Reference)
description: GSDK 业务插件规范、当前插件拓扑全景清单（包含 Node、Info、State、Elements）以及内核与 SDK 边界说明。
status: stable
tags: [plugins, reference, topology, contracts]
---

# 插件全景与契约索引 (Plugin Reference)

本文件是当前业务插件的导航与关键契约索引。完整装配以各插件 Manifest、backend 工厂、Node 源码及针对性测试为准；下面记录关键输入输出，不代替全部 payload 定义。

> **核心原则**：
> 1. **业务迭代优先消费内核**：日常功能、UI 与模型接入放在插件中，避免向 Rust 加入业务语义。涉及调度、版本、执行或分析协议时，仍需对照内核源码与针对性测试核实边界。
> 2. **全栈通过 SDK 交互**：后端主进程与插件使用 `@graphframework/sdk` 的 node/plugin/effect 等公开子路径，前端仅通过 SDK Client 提供的快照与命令进行交互。
> 3. **插件平权**：内置业务插件（如 `demo.topology`）与第三方插件采用完全相同的 Manifest、装配接口与执行生命周期。

---

## 1. 架构边界与 SDK 分工

```text
┌────────────────────────────────────────────────────────┐
│                   前端 UI (Renderer)                   │
│   React 组件 / Workbench Elements / 自定义 Inspector   │
└─────────────────────────┬──────────────────────────────┘
                          │ 仅通过 @graphframework/client 交互
                          │ (useAppState / useApplicationClient)
┌─────────────────────────▼──────────────────────────────┐
│             插件系统层 (plugins)        │
│   Manifest (graphframework.plugin.json) + backend.ts       │
│   - 声明 rendererRoots (公开给前端的安全入口)          │
│   - 组装 Authoring / Persistence / Generation Nodes     │
└─────────────────────────┬──────────────────────────────┘
                          │ 通过 @graphframework/sdk 定义 Node/Info
                          │ 挂载至 NativeRuleSpace
┌─────────────────────────▼──────────────────────────────┐
│             底座内核 (零业务语义，统一生产调度)            │
│   Rust 生产微内核 (packages/rust/kernel) + packages/sdk/javascript/src/node 规约       │
└────────────────────────────────────────────────────────┘
```

- **前端视角**：
  - 读事实：只通过快照 `useAppState(selector)` 读取已解码的投影 DTO；
  - 触发动作：只通过 `client.injectRootInfo(targetNodeId, info)` 向受信任的 `rendererRoots` 注入意图。
- **后端视角**：
  - 纯领域 Node：零 I/O、零网络、零 Electron API，仅通过 `change(info, ctx)` 推进内部状态或 `ctx.send(nextInfo, targetId)`；
  - 副作用 WorldNode：严格区分**执行类 (`ExecutionWorldNode`)** 与**观察类 (`ObservationWorldNode`)**，物理动作由构造注入的 `EffectAdapter` 执行。

---

## 2. 插件标准契约 (Plugin Contract)

本仓库插件位于 `app/plugins/<plugin-directory>/`；目录名不必等于 Manifest ID，外部目录由 application.json 的 path 指定：

### 2.1 Manifest 规范 (`graphframework.plugin.json`)
插件分后端与前端两种 `apiVersion: 2` 形态，`kind` 与 `contributes` 必须一致（当前实例均见 `app/plugins/<backend|frontend>/demo-topology/`）：
```json
{
  "id": "demo.topology",
  "name": "Topology Demo",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "backend",
  "contributes": {
    "backend": "index.mjs",
    "nodeFactories": [],
    "graphFactories": ["createDemoTopologyGraph"]
  }
}
{
  "id": "demo.topology",
  "name": "Topology Demo",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "frontend",
  "contributes": {
    "host": "desktop/main.mjs",
    "frontend": "index.tsx",
    "elements": [],
    "workspaces": []
  }
}
```

### 2.2 后端入口规范（`index.mjs`）
后端通过 `defineBackendPlugin` 导出，提供节点实例与前端白名单；命名 run 只调用配置命中的工厂（`nodeFactories/graphFactories`），不调用全量 `createNodes`（当前实例见 `app/plugins/backend/demo-topology/index.mjs` 与 `app/plugins/backend/hello-counter/index.mjs`）：
```ts
import { defineBackendPlugin } from '@graphframework/sdk/plugin'
export default defineBackendPlugin({
  id: 'demo.topology',
  createNodes: (ctx) => Object.values(createDemoTopology(ctx)),
  rendererRoots: [{
    targetNodeId: 'demo.orders',
    infoType: 'SubmitOrder',
    validate: (info) => info?.type === 'SubmitOrder' && typeof info?.orderId === 'string',
  }],
})
```

## 3. 当前插件清单：`demo.topology`
`demo.topology` 是当前默认应用（`app/application.json`，`graphframework-demo`）装配的订单履约演示图：`demo.orders` 为唯一入口，`demo.router` 负责扇出，`demo.ledger` 汇总回执。后端实现见 `app/plugins/backend/demo-topology/index.mjs`，前端宿主与界面见 `app/plugins/frontend/demo-topology/`。
### 3.1 后端 Node 全景与职责
| Node ID | 类别 | 职责说明 | 关键输入 Info | 关键输出 / 发送 Info |
| :--- | :--- | :--- | :--- | :--- |
| `demo.orders` | 纯领域 Node | 持有已下单计数 `placed`，唯一入口 | `SubmitOrder`（`orderId: string`，见 `rendererRoots` 校验） | `OrderPlaced` → `demo.router` |
| `demo.router` | 纯领域 Node | 扇出订单，记录 `routed/dropped/screening`；`AttachScreening` 动态挂接筛查节点 | `OrderPlaced`；`AttachScreening`（`nodeId`） | `ScreenOrder` → 已挂接筛查节点；`BillOrder` → `demo.billing`；`ReserveStock` → `demo.inventory`（发送失败计入 `dropped`） |
| `demo.billing` | 纯领域 Node | 持有已开票 `billed[]` | `BillOrder` | `ReceiptPosted` → `demo.ledger` |
| `demo.inventory` | 纯领域 Node | 持有已备货 `reserved[]` | `ReserveStock` | `StockReserved` → `demo.ledger` |
| `demo.ledger` | 纯领域 Node | 汇总回执 `receipts/reservations/verdicts` | `ReceiptPosted`；`StockReserved`；`FraudVerdict` | 无（终汇节点） |
| `demo.fraud` | 纯领域 Node | 运行中才准入的筛查节点，不在初始装配内 | `ScreenOrder` | `FraudVerdict` → `demo.ledger` |
### 3.2 前端宿主与界面
前端插件（`app/plugins/frontend/demo-topology/`）不使用 Element/Workspace 贡献（`elements: []`，`workspaces: []`），也不使用 `@graphframework/client` hooks。`desktop/main.mjs` 是 Electron 前端宿主：读取 run `context.json`，经 run 控制面 `projection` 拉取 daemon 投影并用 `defaultValueCodec.decode` 解码（`getDemoSnapshot`），`demo:step` 经 `inject-renderer` 向 `<graph>/orders` 注入 `SubmitOrder`；`shell:close` 转为 `request-stop`。`desktop/preload.cjs` 只暴露三个固定通道：`window.demo`（`readState/step/reset`）、`window.graph`（`readCounter/incrementCounter`，以 `demo.orders.placed` 充当计数器）、`window.shell`（`minimize/toggleMaximize/close`；`close` 请求 run 停止，走完整关闭路径，不直接杀内核）。`frontend/app.tsx` 直接调用上述 `window` 通道渲染拓扑快照（节点、边、phase），主题在本组件内用 `localStorage` 切换 `dark/light/xueqing/shiliuqun`。

## 4. 参考插件：`hello-counter`

`hello-counter` 是最小规范插件，适合用作开发新插件时的脚手架骨架：
- **ID**: `example.hello-counter`
- **Node**: `example.counter` (持有 `{ count: number }`)
- **Action**: `IncrementInfo`
- **特点**: 单个纯领域 Node，无外部副作用，具备确定性 Vitest 测试。

---

## 5. 前端交互速查表（如何发送动作与读取状态）
下表列出 `demo.topology` 前端的实际通道与对应图入口；业务事实只读投影快照，写操作只走固定通道：
| 用户操作 | 前端调用的固定通道 / Info | 目标 Node ID | 说明 |
| :--- | :--- | :--- | :--- |
| **查看拓扑** | `window.demo.readState()` | —（读 `projection` 解码快照） | 返回节点、边、`placed` 计数与 `revision` |
| **下一单** | `window.demo.step()` → `SubmitOrder`（`orderId: order-N`） | `<graph>/orders`（如 `topology/orders`） | 经 `inject-renderer` 校验 `rendererRoots` 后注入 |
| **读计数** | `window.graph.readCounter()` | `demo.orders` 投影的 `placed` | 只读投影，不发 Info |
| **计数+1** | `window.graph.incrementCounter()` → `SubmitOrder` | `<graph>/orders` | 与 `step` 同一入口的计数器别名 |
| **关闭窗口** | `window.shell.close()` → `request-stop` | — | 请求 run 停止，走完整关闭路径，不直接杀内核 |
