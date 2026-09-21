---
type: guide
title: OS Recorder 与 Microsoft UFO 集成说明
description: Windows Steps Recorder 物理桥、UFO 演示格式和 GraphFramework 因果边界。
status: stable
tags: [ufo, windows, recorder, world-node]
---

# OS Recorder 与 Microsoft UFO 集成说明

## 上游与范围

- 上游源码：`packages/ufo/` Git 子模块，来源为
  `https://github.com/microsoft/UFO.git`。
- UFO 官方演示学习流程使用 Windows Steps Recorder 录制跨应用操作，并由
  `record_processor` 解析 ZIP 内的 MHT 轨迹。
- 本 run 负责“录制 + 本地解析 + 展示”；不会自动运行 LLM 总结，也不要求配置
  OpenAI/Azure 密钥。
- PSR 记录鼠标操作、应用/窗口上下文、键盘动作类别与截图。出于系统安全设计，
  它不会保存用户输入的明文内容；需要表达输入内容时应使用 PSR 注释。
- Microsoft 已将 PSR 标记为弃用。本实现与 UFO 当前官方演示格式保持一致，且会
  在每次开始录制前检查 `psr.exe`；未来上游更换录制格式时只需替换 run Adapter。
- Adapter 默认直接启动 `psr.exe`；若当前 Windows 对直接 `CreateProcess` 返回
  `EACCES`，则通过系统 `rundll32.exe` 的 ShellExecute 入口启动或停止 PSR。
  `rundll32.exe` 与解包使用的 `tar.exe` 均固定从 `%WINDIR%\\System32` 解析，
  不受 Git Bash `PATH` 中同名程序影响。

## 因果链路

```text
renderer
  -> StartRecordingInfo / StopRecordingInfo
  -> recorder/session (State Owner)
  -> StartCaptureInfo / StopCaptureInfo
  -> recorder/execution (ExecutionWorldNode)
  -> ufo/psr-capture-control EffectAdapter
  -> Windows psr.exe

recorder/session
  -> ObserveRecordingInfo
  -> recorder/observation (ObservationWorldNode)
  -> ufo/psr-capture-observation EffectAdapter
  -> ZIP/MHT
  -> RecordingObservedInfo
  -> recorder/session
```

执行节点不读取录制内容；观察节点不启动或停止进程。业务 State 只由 session
Owner 在自己的 change 中修改。

## 产物

录制结果保存到：

```text
runs/os-recorder/.generated/data/recordings/<session>-<timestamp>.zip
```

ZIP 与 UFO 的 `record_processor` 输入兼容。安装 UFO 的 Python 依赖并配置模型后，
可以按上游方式继续处理：

```bash
cd packages/ufo
python -m record_processor -r "<演示目标>" -p "<录制 ZIP 绝对路径>"
```

本命令属于显式离线后处理，不由 GraphFramework Node 自动启动。

## 安全说明

- 录制会包含屏幕截图。开始前应关闭或遮挡敏感信息。
- renderer 只能打开当前 Projection 中的产物，不能传入任意文件路径。
- session ID 会净化为安全文件名，所有产物路径必须保持在当前 run 的录制目录内。
- run 停机时宿主会停止仍在运行的 PSR 录制源。
