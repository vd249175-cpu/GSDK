---
type: Reference Manual
title: 核心插件全景与开发装配指南 (Plugins Reference)
description: 官方核心插件（app/plugins/backend/* 与 app/plugins/frontend/*）的无遗漏全景手册。系统暴露节点工厂、图工厂、前端 UI 入口以及推荐装配与实例化方式。
status: stable
---

# 核心插件全景与开发装配指南 (Plugins Reference)

本目录是 GraphFramework 官方核心插件集（后端位于 `app/plugins/backend/*`，前端位于 `app/plugins/frontend/*`）的标准参考手册与能力货架。

**设计宗旨**：贯彻“**让人不看代码也会使用、在不开发代码的情况下可以直接用**”原则。无需翻阅插件内部实现源码，即可查明所有**节点类、节点工厂函数、图工厂函数、EffectAdapter、前[端 UI 入口与开箱即用的装配配置](./frontend-specification.md)**。

> 路径说明：仓库曾存在旧式 `app/plugins/demo-topology/`（v1 manifest）；现行权威位置是 `app/plugins/backend/demo-topology/`（`index.mjs`，与 `backend.mjs` 内容一致）与 `app/plugins/frontend/demo-topology/`（`index.tsx`）。新开发一律使用后者。

---

## 1. 插件架构契约与规范 (Plugin Architecture Contract)

GraphFramework 中的所有插件（无论内置于 `app/` 还是 run 隔离开发于 `runs/<name>/plugins/`）遵循完全同构的 Manifest、SDK 导出与生命周期标准。

### 1.1 插件清单规范 (`graphframework.plugin.json` v2)

每个插件根目录下必须包含 `graphframework.plugin.json`，由 `@graphframework/sdk/plugin` 的 `parseStudioPluginManifest` 校验（`apiVersion` 仅接受 `1` 或 `2`；v2 要求 `kind` 为 `backend` 或 `frontend`，且 `contributes` 字段不得跨 kind 混用）：

#### 后端插件清单 (Backend Plugin)

```json
{
  "id": "example.unified-recorder",
  "name": "Unified Recorder",
  "version": "0.1.0",
  "apiVersion": 2,
  "kind": "backend",
  "contributes": {
    "backend": "index.mjs",
    "nodeFactories": [],
    "graphFactories": ["createUnifiedRecorderGraph"]
  }
}
```

#### 前端插件清单 (Frontend Plugin)

```json
{
  "id": "example.unified-recorder",
  "name": "Unified Recorder",
  "version": "0.1.0",
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

### 1.2 核心暴露规范 (Exposures Standard)

每个后端插件严格暴露以下维度的要素：

1. **节点类与类工厂 (Node Classes & Factories)**：
   - 继承自 `@graphframework/sdk/plugin` 的 `Node`、`ExecutionWorldNode` 或 `ObservationWorldNode`。
   - 提供形如 `create<Feature>(ctx)` 的工厂函数，返回命名的节点实例集合字典 `{ session, execution, observation, ... }`。`ctx` 由 run 宿主按实例注入：`{ pluginId, dependencies, instanceId, nodeId, params, bindings, nodeIdFor }`，其中 `dependencies` 携带宿主注入的 EffectAdapter 与路径，不携带业务 State。
   - 单节点插件（如 hello-counter）用 `defineNodeFactory` 定义 `createCounterNode`。
2. **图工厂 (Graph Factories)**：
   - 导出形如 `create<Feature>Graph(ctx)` 的统一工厂函数，返回展平的节点实例数组（实现为 `Object.values(create<Feature>(ctx))`）。
   - 六个核心后端插件均附带静态自省方法 `create<Feature>Graph.describe()`，返回 `{ kind: 'graph', localIds, requiredBindings, rendererRoots }`（SDK 中 `describe` 为可选，`defineGraphFactory` 要求它在存在时必须是纯函数）。
3. **后端插件模块（`defineBackendPlugin`）**：
   - 模块默认导出 `defineBackendPlugin({ id, createNodes, rendererRoots })`。`createNodes(context)` 返回本插件的节点数组；`rendererRoots` 是显式用户命令白名单，条目为 `{ targetNodeId, infoType, validate }`，宿主用 `assertRendererRoot` 强制校验——内部 Info（如 `StartCaptureInfo`、`RecordingEventInfo`）不在白名单，renderer 不得直接注入。
4. **前端界面 (Frontend)**：
   - 前端插件入口为 `index.tsx`：挂载到 `#root` 的 React `App`，同时具名导出 `App`。**强制遵循界面三大支柱**：详见 **[插件前端界面与工作台开发规范 (frontend-specification.md)](./frontend-specification.md)**。必须包含：
     - **顶部设置**（`SettingsDialog` 工业设置弹窗、四套主题与字体密度调节）；
     - **Blender 级单页面自由切分与拖出**（左上角面板自由切换、右上角水平/垂直切分、弹出为悬浮独立窗口、`Ctrl+Space` 最大化）；
     - **底部达芬奇模式分页**（**铁律：即使只有 1 个页面也必须保留**，常驻无损切换）。
5. **标准装配与实例化契约 (Assembly & Instantiation)**：
   - 在独立工作流的 `runs/<name>/assembly.mjs` 中通过 `run.backendPlugin(...)`、`run.frontendPlugin(...)`、`run.node(...)`、`run.graph(...)`、`run.frontend(...)`、`run.requireNode(...)` 链式注入（见 §3 模式一；`run.graph`/`run.node` 条目为 `{ id, plugin, factory, params?, bindings? }`，图工厂产物按实例命名空间挂接，`localIds` 必须精确匹配）。

---

## 2. 核心插件能力货架 (Core Plugins Matrix)

官方当前提供的 6 大核心插件如下：

| 插件 ID | 插件类型 | 节点工厂 / 图工厂 | 涵盖节点类 | 前端宿主与 UI | 核心功能与使用定位 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **[`example.unified-recorder`](./unified-recorder.md)** | 后端 + 前端 | `createUnifiedRecorder`<br>`createUnifiedRecorderGraph` | `UnifiedSessionNode`<br>`UnifiedCaptureNode`<br>`UnifiedObserverNode` | Electron Host + React UI<br>(`runs/main` 默认桌面) | **双源桌面/浏览器统一录制器**。<br>实时合流、MHT 截图解压落盘、高信噪比纯文字 `agent-transcript.md`。 |
| **[`example.browser-recorder`](./browser-recorder.md)** | 后端 + 前端 | `createBrowserRecorder`<br>`createBrowserRecorderGraph` | `RecordingSessionNode`<br>`BrowserCaptureNode`<br>`BrowserObserverNode` | Electron Host + React UI | **Playwright 原生流式录制器**。<br>支持 playwright-cli 管道与 Chrome 9343 CDP WebSocket 实时录制。 |
| **[`example.os-recorder`](./os-recorder.md)** | 后端 + 前端 | `createOsRecorder`<br>`createOsRecorderGraph` | `RecordingSessionNode`<br>`RecordingCaptureNode`<br>`RecordingObserverNode` | Electron Host + React UI | **Windows 全桌面步骤记录器**。<br>调用 PSR 生成 ZIP 归档，解析 XML/MHT 提取键鼠操作步骤与截图。 |
| **[`example.ufo-computer-control`](./ufo-computer-control.md)** | 后端 | `createUfoComputerControl`<br>`createUfoComputerControlGraph` | `UfoComputerSessionNode`<br>`UfoComputerExecutionNode`<br>`UfoComputerObservationNode` | 纯后端（由 Session/Info 驱动） | **Microsoft UFO 计算机全控**。<br>桌面应用巡检、控件树遍历、原生点击/输入/滚轮/热键 10 大指令下发。 |
| **[`demo.topology`](./demo-topology.md)** | 后端 + 前端 | `createDemoTopology`<br>`createDemoTopologyGraph` | `OrdersNode`<br>`RouterNode`<br>`BillingNode`<br>`InventoryNode`<br>`LedgerNode`<br>`FraudNode` | Electron Host + React UI | **因果拓扑与动态节点挂接范例**。<br>多节点扇出扇入、事务回执流水线、运行期动态准入挂接 `FraudNode`。 |
| **[`example.hello-counter`](./hello-counter.md)** | 后端 | `createCounterNode`<br>(`defineNodeFactory`) | `CounterNode` | 离线自诊断命令行 | **微内核最小规约与自诊断范例**。<br>用于最小后端测试、单飞验证与静态因果拓扑离线验证。 |

---

## 3. 标准装配与实例化指南 (Assembly & Instantiation Paradigms)

在 GraphFramework 中，插件从不直接硬编码启动，而是通过以下三种标准模式之一进行装配：

### 模式一：工作流声明式装配 (`runs/<name>/assembly.mjs`) —— 推荐生产模式

这是官方全仓唯一推荐的宿主编排方式，支持多图组合、多插件拼装与前后端路由绑定（下例结构与 `runs/main/assembly.mjs` 同构）：

```javascript
// runs/<name>/assembly.mjs
export default {
  id: 'my-workflow.assembly',
  contribute(run) {
    // 1. 注册后端插件（指向插件真实绝对路径或相对路径）
    run.backendPlugin({
      id: 'example.unified-recorder',
      path: '../../app/plugins/backend/unified-recorder',
    });
    run.backendPlugin({
      id: 'example.ufo-computer-control',
      path: '../../app/plugins/backend/ufo-computer-control',
    });

    // 2. 注册前端插件
    run.frontendPlugin({
      id: 'example.unified-recorder',
      path: '../../app/plugins/frontend/unified-recorder',
    });

    // 3. 实例化图（绑定插件导出的图工厂）
    run.graph({
      id: 'recorder',
      plugin: 'example.unified-recorder',
      factory: 'createUnifiedRecorderGraph',
    });
    run.graph({
      id: 'computer',
      plugin: 'example.ufo-computer-control',
      factory: 'createUfoComputerControlGraph',
    });

    // 4. 挂载前端工作台实例并关联主图
    run.frontend({
      id: 'main-ui',
      plugin: 'example.unified-recorder',
      graph: 'recorder',
    });

    // 5. 声明关键守护节点（实例命名空间下的 session 节点）
    run.requireNode('recorder/session');
    run.requireNode('computer/session');
  },
};
```

启动命令（唯一合法入口）：

```bash
bash ./run.sh start runs/<name>/run.config.json
```

---

### 模式二：单节点按需注册 (`run.node`)

如果只需要引入某个插件中的单个独立节点（如 `hello-counter` 的计数器）：

```javascript
export default {
  id: 'counter-demo.assembly',
  contribute(run) {
    run.backendPlugin({
      id: 'example.hello-counter',
      path: '../../app/plugins/backend/hello-counter',
    });

    // 直接通过 nodeFactory 单独实例化
    run.node({
      id: 'my-counter',
      plugin: 'example.hello-counter',
      factory: 'createCounterNode',
    });

    run.requireNode('my-counter');
  },
};
```

---

### 模式三：测试与脚本中内存编排 (`createTestRuntime`)

在单元测试或无头验证脚本中，用 `@graphframework/sdk/testing` 的 `createTestRuntime` 做纯内存编排。真实签名（见 `app/plugins/backend/hello-counter/backend.test.mjs`）：构造时传入 `nodes`，用 `runtime.inject({ targetNodeId, info })` 发 Info，用 `await runtime.waitForQuiescence()` 等待因果结算，用 `runtime.getState(nodeId)` 读 State：

```javascript
import { createTestRuntime } from '@graphframework/sdk/testing';
import plugin from '../../app/plugins/backend/unified-recorder/index.mjs';
import { createUnifiedRecorder } from '../../app/plugins/backend/unified-recorder/index.mjs';

// 1. 注入模拟的物理 EffectAdapter（经工厂 ctx.dependencies 进入 WorldNode）
const fakeDesktopControl = {
  id: 'unified/desktop-control',
  execute: async ({ op, sessionId }) => ({ handle: 'fake-handle', startedAt: new Date().toISOString() }),
};
const fakeBrowserControl = {
  id: 'unified/browser-control',
  execute: async ({ op, sessionId }) => ({ handle: 'fake-browser-handle' }),
};

// 2. 调用节点工厂生成全量节点（或直接用插件默认导出装配）
const { session, execution, observation } = createUnifiedRecorder({
  instanceId: 'test-recorder',
  dependencies: {
    desktopControl: fakeDesktopControl,
    browserControl: fakeBrowserControl,
  },
});

// 3. 挂载入测试运行空间（构造时传入）
const runtime = createTestRuntime({ nodes: [session, execution, observation] });

// 4. 发送命令并等待结算后断言
runtime.inject({ targetNodeId: 'test-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 'sess-001' } });
await runtime.waitForQuiescence();
console.log('Session State:', runtime.getState('test-recorder/session'));
runtime.dispose();
```

---

## 4. 详细插件参考跳转索引

请直接查阅对应插件的独立完整手册（包含全部字段契约、数据流向图与复制即用代码）：

- [1. 统一双源录制插件 (Unified Recorder)](./unified-recorder.md)
- [2. 浏览器操作录制插件 (Browser Recorder)](./browser-recorder.md)
- [3. Windows 桌面步骤录制插件 (OS Recorder)](./os-recorder.md)
- [4. UFO 计算机全控插件 (UFO Computer Control)](./ufo-computer-control.md)
- [5. 因果拓扑演示插件 (Demo Topology)](./demo-topology.md)
- [6. 计数器与诊断插件 (Hello Counter)](./hello-counter.md)
