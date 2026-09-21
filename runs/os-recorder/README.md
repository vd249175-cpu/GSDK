---
type: guide
title: 全电脑操作录制 Run
description: 运行 Microsoft UFO 兼容的 Windows 跨应用操作录制工作台。
status: stable
tags: [run, ufo, recorder, windows]
---

# 全电脑操作录制 Run

该 run 提供与 `browser-recorder` 一致的深色录制工作台，但录制范围扩展为整个
Windows 桌面及跨应用操作。底层使用 Microsoft UFO 官方演示学习流程支持的
Windows Steps Recorder，结果保存为 UFO 可继续处理的 ZIP/MHT。录制期间由只读
Windows 输入观察源把鼠标、滚轮和隐私化键盘活动实时送入动作时间线；停止后再用
PSR 产物中的权威 UFO 轨迹结算。

## 当前能力边界

本 run 已提供电脑操作的**观察与录制能力**，但尚未提供通用的**主动电脑控制
能力**。ExecutionWorldNode 当前只负责启动/停止 PSR 与观察 helper，不会代表
Agent 执行鼠标点击、键盘输入、窗口切换或应用操作，也没有把这些动作注册成
Codex 可调用的 MCP/tool。

要完成主动控制接入，还需要增加独立的 Windows ExecutionWorldNode 与
EffectAdapter（可复用 UFO 的 UI Automation 能力），定义受控动作 Info、执行后
Observation、目标窗口约束与敏感操作确认边界，并通过 MCP/tool 面向 Agent 暴露。
这些 Node 可以直接用 Python、Rust 或其他语言实现；GraphFramework 的 daemon
worker/provider 协议是语言无关的，JS 不是必经层。

## 启动

```bash
bash ./run.sh start runs/os-recorder/run.config.json
```

在工作台点击“开始全桌面录制”，切换到任意应用完成演示，再点击“停止并生成记录”。
每一步会在录制期间流式出现在动作时间线中；涉及应用和 ZIP 路径均来自 Graph
Projection。运行环境需要可通过 `python.exe` 启动的 Python 3，路径可在
`run.config.json` 的 `backend.dependencies.pythonExecutable` 中覆盖。

## 注意

- 录制产物包含屏幕截图，请先隐藏敏感信息。
- PSR 记录键盘动作类别，但不会记录输入的明文内容。
- 实时观察源同样不保存键值或文本，只记录“键盘活动”、前台应用与窗口标题。
- Windows 已将 PSR 标记为弃用；本 run 会在启动录制时检查本机是否仍提供
  `psr.exe`，缺失时通过 Projection 返回明确错误。
- 需要将演示总结为 UFO 知识时，再按插件集成文档显式运行 `record_processor`。
