---
type: Reference Manual
title: 核心插件全景与开发装配指南 (Plugins Reference)
description: 官方核心插件（app/plugins/*）的无遗漏全景手册。系统暴露节点工厂、类工厂、前端 UI 挂载点以及推荐装配与实例化方式。
status: stable
---

# 核心插件全景与开发装配指南 (Plugins Reference)

本目录是 GraphFramework 官方核心插件集（位于 [`app/plugins/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/app/plugins)）的标准参考手册与能力货架。

**设计宗旨**：贯彻“**让人不看代码也会使用、在不开发代码的情况下可以直接用**”原则。无需翻阅插件内部实现源码，即可查明所有**节点类、节点工厂函数、图工厂函数、EffectAdapter、前端 UI 挂载（`rendererRoots`）与开箱即用的装配配置**。

---

## 1. 插件架构契约与规范 (Plugin Architecture Contract)

GraphFramework 中的所有插件（无论内置于 `app/` 还是 run 隔离开发于 `runs/<name>/plugins/`）遵循完全同构的 Manifest、SDK 导出与生命周期标准。

### 1.1 插件清单规范 (`graphframework.plugin.json` v2)

每个插件根目录下必须包含 `graphframework.plugin.json`：

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

每个插件严格暴露以下四种维度的要素：

1. **节点类与类工厂 (Node Classes & Factories)**：
   - 继承自 `@graphframework/sdk/plugin` 的 `Node`、`ExecutionWorldNode` 或 `ObservationWorldNode`。
   - 提供形如 `create<Feature>(ctx)` 的工厂函数，返回命名的节点实例集合字典 `{ session, execution, observation, ... }`。
2. **图工厂 (Graph Factories)**：
   - 导出形如 `create<Feature>Graph(ctx)` 的统一工厂函数，返回展平的节点实例数组 `Node[]`。
   - 必须附带静态自省方法 `create<Feature>Graph.describe()`，返回 `{ kind: 'graph', localIds, requiredBindings, rendererRoots }`。
3. **前端界面与渲染根白名单 (Frontend, `rendererRoots` & UI Specification)**：
   - 在 `defineBackendPlugin` 中定义白名单 `rendererRoots`，明确声明主进程/工作台允许向哪些节点注入哪些 `infoType`，严禁前端绕过白名单直发任意私有 Info。
   - **强制遵循界面三大支柱**：详见 **[插件前端界面与工作台开发规范 (frontend-specification.md)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/frontend-specification.md)**。必须包含：
     - **顶部设置**（`SettingsDialog` 工业设置弹窗、四套主题与字体密度调节）；
     - **Blender 级单页面自由切分与拖出**（左上角面板自由切换、右上角水平/垂直切分、弹出为悬浮独立窗口、`Ctrl+Space` 最大化）；
     - **底部达芬奇模式分页**（**铁律：即使只有 1 个页面也必须保留**，常驻无损切换）。
4. **标准装配与实例化契约 (Assembly & Instantiation)**：
   - 在独立工作流的 `runs/<name>/assembly.mjs` 中通过 `run.backendPlugin(...)`、`run.graph(...)` 等链式注入。

---


## 2. 核心插件能力货架 (Core Plugins Matrix)

官方当前提供的 6 大核心插件如下：

| 插件 ID | 插件类型 | 节点工厂 / 图工厂 | 涵盖节点类 | 前端宿主与 UI | 核心功能与使用定位 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **[`example.unified-recorder`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/unified-recorder.md)** | 后端 + 前端 | `createUnifiedRecorder`<br>`createUnifiedRecorderGraph` | `UnifiedSessionNode`<br>`UnifiedCaptureNode`<br>`UnifiedObserverNode` | Electron Host + React UI<br>(`runs/main` 默认桌面) | **双源桌面/浏览器统一录制器**。<br>实时合流、MHT 截图解压落盘、高信噪比纯文字 `agent-transcript.md`。 |
| **[`example.browser-recorder`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/browser-recorder.md)** | 后端 + 前端 | `createBrowserRecorder`<br>`createBrowserRecorderGraph` | `RecordingSessionNode`<br>`BrowserCaptureNode`<br>`BrowserObserverNode` | Electron Host + React UI | **Playwright 原生流式录制器**。<br>支持 playwright-cli 管道与 Chrome 9343 CDP WebSocket 实时录制。 |
| **[`example.os-recorder`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/os-recorder.md)** | 后端 + 前端 | `createOsRecorder`<br>`createOsRecorderGraph` | `RecordingSessionNode`<br>`RecordingCaptureNode`<br>`RecordingObserverNode` | Electron Host + React UI | **Windows 全桌面步骤记录器**。<br>调用 PSR 生成 ZIP 归档，解析 XML/MHT 提取键鼠操作步骤与截图。 |
| **[`example.ufo-computer-control`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/ufo-computer-control.md)** | 后端 | `createUfoComputerControl`<br>`createUfoComputerControlGraph` | `UfoComputerSessionNode`<br>`UfoComputerExecutionNode`<br>`UfoComputerObservationNode` | 纯后端（由 Session/Info 驱动） | **Microsoft UFO 计算机全控**。<br>桌面应用巡检、控件树遍历、原生点击/输入/滚轮/热键 10 大指令下发。 |
| **[`demo.topology`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/demo-topology.md)** | 后端 + 前端 | `createDemoTopology`<br>`createDemoTopologyGraph` | `OrdersNode`<br>`RouterNode`<br>`BillingNode`<br>`InventoryNode`<br>`LedgerNode`<br>`FraudNode` | Electron Host + React UI | **因果拓扑与动态节点挂接范例**。<br>多节点扇出扇入、事务回执流水线、运行期动态准入挂接 `FraudNode`。 |
| **[`example.hello-counter`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/hello-counter.md)** | 后端 | `createCounterNode`<br>(`defineNodeFactory`) | `CounterNode` | 离线自诊断命令行 | **微内核最小规约与自诊断范例**。<br>用于最小后端测试、单飞验证与静态因果拓扑离线验证。 |

---

## 3. 标准装配与实例化指南 (Assembly & Instantiation Paradigms)

在 GraphFramework 中，插件从不直接硬编码启动，而是通过以下三种标准模式之一进行装配：

### 模式一：工作流声明式装配 (`runs/<name>/assembly.mjs`) —— 推荐生产模式

这是官方全仓唯一推荐的宿主编排方式，支持多图组合、多插件拼装与前后端路由绑定：

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

    // 5. 声明关键守护节点
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

在单元测试或无头验证脚本中，直接调用类工厂进行纯内存实例编排：

```javascript
import { createTestRuntime } from '@graphframework/sdk/testing';
import { createUnifiedRecorder } from '../../app/plugins/backend/unified-recorder/index.mjs';

const runtime = createTestRuntime();

// 1. 注入模拟的物理 EffectAdapter
const fakeDesktopControl = {
  id: 'unified/desktop-control',
  execute: async ({ op, sessionId }) => ({ handle: 'fake-handle', startedAt: new Date().toISOString() }),
};
const fakeBrowserControl = {
  id: 'unified/browser-control',
  execute: async ({ op, sessionId }) => ({ handle: 'fake-browser-handle' }),
};

// 2. 调用节点工厂生成全量节点
const { session, execution, observation } = createUnifiedRecorder({
  instanceId: 'test-recorder',
  dependencies: {
    desktopControl: fakeDesktopControl,
    browserControl: fakeBrowserControl,
  },
});

// 3. 挂载入测试运行空间
runtime.mountNode(session);
runtime.mountNode(execution);
runtime.mountNode(observation);

// 4. 发送命令测试
await runtime.send({ type: 'StartRecordingInfo', sessionId: 'sess-001' }, 'test-recorder/session');
console.log('Session State:', runtime.readState('test-recorder/session'));
```

---

## 4. 详细插件参考跳转索引

请直接查阅对应插件的独立完整手册（包含全部字段契约、数据流向图与复制即用代码）：

- [1. 统一双源录制插件 (Unified Recorder)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/unified-recorder.md)
- [2. 浏览器操作录制插件 (Browser Recorder)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/browser-recorder.md)
- [3. Windows 桌面步骤录制插件 (OS Recorder)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/os-recorder.md)
- [4. UFO 计算机全控插件 (UFO Computer Control)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/ufo-computer-control.md)
- [5. 因果拓扑演示插件 (Demo Topology)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/demo-topology.md)
- [6. 计数器与诊断插件 (Hello Counter)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/hello-counter.md)
