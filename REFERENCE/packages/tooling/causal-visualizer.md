---
type: Developer Guide
title: Swiss-2D 因果可视化器开发指南
description: 可视化器的根导出、telemetry transport 契约、当前运行边界与构建验证方式。
status: experimental
tags: [tooling, causal-visualizer, swiss-2d, telemetry, react]
---

# Swiss-2D 因果可视化器开发指南

`@graphframework/causal-visualizer` 是一个私有 React 工具包，提供确定性 Swiss-2D 布局、拓扑画布、节点详情面板和 telemetry client。它当前可作为组件构建与测试，但仓库尚未提供经 `run.sh` 装配的独立 visualizer run；因此不得用 `npm run dev` 或直接执行 `telemetry-server.mjs` 充当生产启动方式。

## 1. 根导出

```ts
import {
  VisualizerApp,
  VisualizerClient,
  DEFAULT_SERVER_URL,
  type TopologySnapshot,
  type CausalTelemetryEvent,
} from '@graphframework/causal-visualizer'
```

`VisualizerClient` 支持两种 transport：桌面 preload 暴露的 `graphframeworkDesktop.graphKernel`，或 HTTP/SSE。非桌面宿主可显式指定 endpoint：

```ts
const client = new VisualizerClient({
  serverUrl: 'http://127.0.0.1:51888',
  autoConnect: true,
})
```

`GET /api/topology` 返回 `TopologySnapshot`；`GET /api/events` 发送 `CausalTelemetryEvent` SSE。集成方负责把这两个端点挂入某个命名 run 的宿主，并在停止时调用 `client.dispose()`。

## 2. 当前数据契约

- snapshot：`revision`、`nodes[]`、可选 `routes[]` 和 `recentEvents[]`。
- node：`nodeId`、`generation`、`version`、`status`、已解码只读 `state`。
- event：`root_injected`、`info_sent`、`change_start`、`change_end`、`state_mutated`、`node_admitted`、`node_evicted`。
- layout engine 根据 Node ID 推断 domain/observation/execution 角色；这是展示启发式，不是业务事实源。

画布不得主动修改 Kernel State。状态只能来自 Projection/telemetry；动作必须通过宿主已认证的控制面发送 Info。

## 3. 开发与验证

安装依赖后只做构建和针对性测试，不启动旁路服务：

```bash
npm --prefix packages/tooling/causal-visualizer ci
npm --prefix packages/tooling/causal-visualizer run build
npm --prefix packages/tooling/causal-visualizer test
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

若要交付可运行界面，先创建独立 `runs/<name>/`，把 telemetry adapter 和前端实例纳入该 run 的 assembly，再由 `bash ./run.sh start ...` 启动。完成标准：根入口可解析、snapshot/event DTO 与服务端一致、断线可恢复、dispose 无残留订阅、布局测试确定性通过。
