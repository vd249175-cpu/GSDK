---
type: Developer Guide
title: 瑞士风因果可视化器使用手册 (causal-visualizer)
description: 瑞士现代主义交互式因果图全息观测工具：实时拓扑流、SSE 遥测事件流与节点状态深度检视。
status: stable
tags: [tooling, visualizer, swiss-2d, telemetry, topology-ui]
---

# 瑞士风因果可视化器使用手册 (`packages/tooling/causal-visualizer`)

源码目录：[`packages/tooling/causal-visualizer/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling/causal-visualizer)

`causal-visualizer` 是 GraphFramework 的独立因果全息观测工具。它采用包豪斯/瑞士现代主义（Swiss-2D）排版风格，提供毫秒级图拓扑渲染、实时脉冲动画流动与节点状态原子追踪。

---

## 1. 30 秒开箱即用：如何启动并观测系统？

只需两步，即可在浏览器中直观看到整个工作流的实时因果图：

### 步骤 1：启动遥测服务端 (Telemetry Server)
在终端中启动轻量遥测后台（默认监听 `51888` 端口）：
```bash
node packages/tooling/causal-visualizer/telemetry-server.mjs
```
> 服务端自动装载当前 Run 的真实拓扑，暴露 HTTP 与 SSE 实时事件流。

### 步骤 2：启动前端可视化界面
在另一终端中启动 Vite 前端热重载服务：
```bash
npm run dev --prefix packages/tooling/causal-visualizer
```
在浏览器中打开 `http://localhost:5173`，即可看到交互式因果画板。

---

## 2. 核心观测与交互特性

1. **确定性瑞士网格布局 (Swiss Layout Engine)**：
   - 依据因果流向（从源触发节点 -> 领域计算节点 -> 终端执行节点）自动计算最佳拓扑分层；
   - 彻底避免传统力导向图（Force-directed）震颤晃动与节点重叠。
2. **实时因果脉冲粒子动效 (Live Pulse Animation)**：
   - 当图中有真实 `ctx.send` 发生时，通过 SSE 毫秒级广播，可视化画板上对应路由瞬间亮起光子动画，真实展现因果流速。
3. **单节点深度检视面板 (Node Detail Panel)**：
   - 点击画板中任意节点，右侧滑出检视面板：
     - **实时 State 快照**：展示当前节点内存中的所有字段值；
     - **当前代数与版本**：显示 `generation` 与 `version`；
     - **关联入/出因果路由**：列出所有连接的前驱与后继。
4. **实时过滤与搜索**：
   - 支持按 Node ID 模糊匹配筛选局部子图，快速定位异常节点。

---

## 3. 遥测 HTTP API 接口列表

遥测服务器（`http://127.0.0.1:51888`）提供以下标准数据接口，可供外部第三方大屏无缝集成：

| API 路径 | 协议类型 | 返回内容与格式 |
| :--- | :--- | :--- |
| `GET /api/topology` | HTTP JSON | 全图静态拓扑快照：`{ revision, nodes: [{ nodeId, generation, state, ... }], routes: [...] }` |
| `GET /api/events` | Server-Sent Events (SSE) | 实时因果事件推送流：包含 `agent_info_injected`、`state_intervened` 等物理事件 |
