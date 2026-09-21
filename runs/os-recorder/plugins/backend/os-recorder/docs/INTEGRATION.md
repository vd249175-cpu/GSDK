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
- 录制期间，`windows-input-observer.py` 使用 Windows 低级输入 Hook 输出 NDJSON
  Observation。它记录鼠标点击、滚轮、键盘活动类别、前台应用和窗口标题，但不
  记录键值或输入文本。前端宿主每 500ms 注入一次获授权的
  `PollRecordingEventsInfo`，观察节点再用 `RecordingEventInfo` 逐步更新 Owner。

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
  -> host PollRecordingEventsInfo
  -> recorder/observation (ObservationWorldNode)
  -> ufo/desktop-capture-events EffectAdapter
  -> RecordingEventInfo (streaming)
  -> recorder/session

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

## 语言无关实现边界

Node 是由 `Info → change → State patch + send` 定义的协议角色，不等同于
JavaScript class。当前 `index.mjs` 使用 JS worker 是本 run 的一种宿主实现，
不是 GraphFramework 的语言限制。Python、Rust、Go 或其他语言可以通过
`graphframework-kernel-daemon` 的 UTF-8 JSON Lines 协议实现相同 Node：

1. `claim` 目标 Node 并用 `poll` 取得 Info 与只读 State 快照；
2. 在目标语言中执行 change；
3. 用一次 `commit` 原子提交 State patch 与下游 Info；
4. WorldNode 通过声明的 effect capability 请求外部操作，物理 provider 用
   `pollEffect` / `completeEffect` 返回 Observation；
5. 语言桥必须把未捕获异常转换成错误 Info，不能击穿 daemon。

State、Info 与 Observation 只使用便携 DTO/`EncodedValue`，不能携带 Python
pickle、JS 闭包或其他语言私有对象。静态因果分析事实同样使用 portable facts，
由目标语言适配层生成。权威协议见
`DOCUMENTS/protocols/kernel-daemon-protocol.md`，接入步骤见
`DOCUMENTS/goals/add-language-runtime.md`。

因此后续若用 Python 编写 Windows UI Automation Node，不需要先包装成 JS
业务 Node；只需遵守同一 daemon worker/provider、Info、State Owner 与
Execution/Observation 物理分离契约。当前 `windows-input-observer.py` 只是物理
Observation helper，还不是一个独立 Python Node worker。

## 运行约束与排障准则

| 现象 | 原因 | 当前准则 |
| :--- | :--- | :--- |
| `spawn ... psr.exe EACCES` | 某些 Windows 环境允许 ShellExecute，但拒绝 Node 直接 CreateProcess；文件存在、签名和 ACL 正常也不能排除该情况 | 先直启；仅对 `EACCES` 回退到 `%WINDIR%\\System32\\rundll32.exe shell32.dll,ShellExec_RunDLL` |
| `cmd.exe start` 启动后挂起或出现假成功 | `start` 在 Node 子进程与管道继承语义下可能等待目标进程，单看 cmd 的 spawn 事件也不能证明 PSR 已启动 | 不以 `cmd start` 作为桥；ShellExecute helper 必须正常退出，现场还要核对 PSR 进程与图中 `RecordingStartedInfo` |
| `tar: Cannot connect to C:` | Git Bash 的 GNU tar 抢占裸 `tar.exe`，把 `C:\\...` 解释为远程主机路径 | Windows 系统工具全部固定到 `%WINDIR%\\System32`，不依赖 PATH 顺序 |
| stop 后没有 ZIP | PSR 空会话可能不落盘；启动成功不等于已有可结算动作 | 端到端测试必须产生至少一个真实键鼠步骤，再检查 ZIP 非空和 MHT 可解析 |
| 录制中没有逐步时间线 | PSR 只在 stop 后生成 ZIP/MHT，本身没有流式事件接口 | 并行运行只读 Windows Hook Observation source；停止后用 PSR 权威轨迹替换实时预览 |
| 切换到其他应用后流速变慢 | Electron 默认节流被遮挡或最小化页面的定时器 | recorder 窗口设置 `backgroundThrottling: false`；Poll 仍由获授权的 host root 注入 |
| 键盘内容存在泄露风险 | 全局低级键盘 Hook 能看到所有应用输入 | helper 不输出 virtual key、scan code 或字符，只输出“Keyboard Input”、应用和窗口标题；PSR 最终轨迹同样不保存明文键值 |
| stop/启动重试后观察进程残留 | 物理 helper 生命周期未与 run/session 对称绑定 | start 失败立即关闭 helper；stop 与 run eviction 在 `finally` 中关闭 stdin，超时才终止子进程 |

排障时不能只看 UI 状态。必须同时核对：物理进程/产物、`agentInspect` 中的
Info 因果序列、`pendingEffects`、Projection、ZIP/MHT 解析结果。所有启动、停止、
状态与分析仍只通过根目录 `run.sh`。

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
- 实时观察包含前台窗口标题；开始前仍需关闭或遮挡敏感窗口。
