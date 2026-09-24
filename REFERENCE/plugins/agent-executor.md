---
type: Reference Manual
title: Python Agent 执行器
description: 图外 LangChain create_agent、图内工具端口、SQLite thread 恢复与多模态消息契约。
status: stable
---

# Agent 执行器

`example.agent-executor` 在 `app/plugins/backend/agent-executor/`。图内 `session` 接收 `AgentInputInfo`，把图参数 `promptSections` 与本次 Info 的 `promptSections` 按顺序交给执行席位。每个执行席位是 `ExecutionWorldNode`，通过 `agent/run` EffectAdapter 调用图外 Python worker。返回的 `AgentCompletedInfo` 或 `AgentFailedInfo` 进入单独的 `result` 节点；图内 State 只保留提交、答案和错误，不保留模型的完整消息历史。

Python worker 使用 [`langchain.agents.create_agent`](https://reference.langchain.com/python/langchain/agents/factory/create_agent) 和 `AsyncSqliteSaver`。宿主按 thread id 创建独立 OS 进程，SQLite 文件名由 thread id 的 SHA-256 确定；同一 thread 重启后恢复消息。不同 thread 可分配到不同执行席位并并行运行。每个 worker 同时只接受一个该 thread 的请求；模型一次生成的多个工具调用可并行到图内不同工具席位。默认 4 个执行席位、8 个工具席位，可用图参数 `executionSeats`（1–4）、`toolSeats`（1–32）调整。

工具用 `defineGraphTool({ name, description, parameters, execute, observe })` 注册。Python 只收到工具名称与 JSON Schema。工具请求通过宿主根注入 `AgentGraphToolInfo` 到图内 `tool-N` 执行节点，节点调用 `agent/tool-execution`，把 handle 发给 `tool-observation-N`；观察节点调用 `agent/tool-observation`，其 Projection 结果回传 worker。执行与观察分属不同 WorldNode。工具名称及参数模式由 run 宿主提供；未注册的名称无法执行。

输入 `AgentInputInfo` 必含 `threadId`、`requestId`、`text`，可含 `attachments` 和 `promptSections`。媒体块透传给模型；简写 `{ "type": "video", "url": "https://…" }` 转为 OpenRouter 的 `video_url` 块。所选模型与提供者仍须支持对应模态。提示词只在当前模型调用使用，不写入持久消息；下一轮可重新拼接。

安装 Python 依赖：`python -m pip install -r app/plugins/backend/agent-executor/requirements.txt`。模型名、base URL、Python 可执行文件由 run 的 `backend.dependencies` 配置；密钥只从进程环境 `OPENROUTER_API_KEY` 或 `OPENAI_API_KEY` 读取。worker 与 SQLite 均留在 run 的 `.generated/data/`，不进图状态或前端。

独立验证：`runs/agent-tool-socket/` 的装配和图端口测试，以及 `tests/test_python_agent.py` 的并行工具、SQLite 恢复和视频载荷测试。主 run 中也装配 `agent` 图；宿主默认提供 `record_note` 示例工具。
