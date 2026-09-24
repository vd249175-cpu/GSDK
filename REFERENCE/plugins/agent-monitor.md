---
type: Reference Manual
title: Agent 监控插件
description: Middleware 状态事件经 AgentMonitorInfo 注入图并形成可观察投影。
status: stable
---

# Agent 监控

`example.agent-monitor` 的 `monitor/session` 只接收 `AgentMonitorInfo`。Python `GraphMonitorMiddleware` 在模型调用前后、工具调用前后及 agent 开始、完成、失败时发出结构化事件；宿主注入图内。事件包含 thread id、request id、阶段、可选工具名与调用 id，不含密钥或消息正文。

节点投影保留最近 200 条事件和每个 thread 的最新事件。完整因果顺序仍以 run 的 inspect 事件记录为准。`runs/desktop-smoke-test/plugins/frontend/workflow-observer/observer.watch.json` 同时显示浏览器、电脑、agent、world 文档状态及相关 Info，供工作流全程观察。
