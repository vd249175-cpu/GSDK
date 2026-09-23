---
type: package
title: Unified Recorder
description: 桌面与浏览器双源统一录制会话插件（canonical step + transcript + replay）
package_id: example.unified-recorder
package_version: 0.1.0
maintainer: example-team
update_policy: publisher-replace-only
downstream_modification: forbidden
---

# Unified Recorder

把桌面（PSR/hook 形状）与浏览器（playwright code/snapshot 形状）两路
事件归一化为一套 agent 可读的 canonical step，输出 transcript 与可回放
脚本。会话 Owner 还维护麦克风字幕与声音片段时间轴；声音采集、落盘及
OpenRouter 转写由桌面宿主完成。个人系统：输入明文直接保留在 `text`/`code`，不做脱敏。

明确不承担：不修改、不导入 `example.os-recorder` 与 `example.browser-recorder`
的内部实现；不持有浏览器、不直驱 PSR。桌面与浏览器捕获经 run 宿主注入的五个 Adapter；麦克风采集与声音文件存储由前端桌面宿主负责，会话 Node 只接收字幕 Info。

## 公开契约

- 目标 Node：`<instance>/session`（Owner）。
- 可接收 Info：
  - `StartRecordingInfo { sessionId?, sources?: ('desktop'|'browser')[] }` → `starting`，向 execution 发送 `StartCaptureInfo`；
  - `StopRecordingInfo {}` → `stopping`，向 execution 发送 `StopCaptureInfo`；
  - `RecordingStartedInfo` / `RecordingStoppedInfo`（仅 execution 发送）；
  - `RecordingEventInfo { sessionId, source?, event }`（仅 observation 发送，归一化后追加）；
  - `RecordingObservedInfo`（仅 observation 发送，权威桌面轨迹替换桌面预览、保留浏览器流）。
- `AudioTranscribedInfo { sessionId, audioFile, startedAt, durationMs, segments }` 将转写片段合入跨段字幕时间轴；`CorrectSubtitleInfo { id, text }` 修正字幕；`RestoreSubtitlesInfo` 在宿主重启后从已保存的字幕索引恢复状态。
- 字幕状态为 `subtitles[]`、`audioClips[]` 与 `narrationStartedAt`；每次新录制保留此前字幕。声音目录保存 WebM 原件、`subtitles.json` 与 `subtitles.srt`。
- 公开 Projection：`{ status, sessionId, sources, handles, eventCount, events, applications, artifactPath, browserActions, startedAt, completedAt, lastEvent, lastError }`。
- 对外发送：session → execution（`StartCaptureInfo`/`StopCaptureInfo`）；
  execution → session（`RecordingStartedInfo`/`RecordingStoppedInfo`/`RecordingFailedInfo`）；
  observation → session（`RecordingEventInfo`/`RecordingObservedInfo`/`RecordingFailedInfo`）。
- rendererRoots：`StartRecordingInfo`、`StopRecordingInfo`、`AudioTranscribedInfo`、`CorrectSubtitleInfo`、`RestoreSubtitlesInfo` → session，均带 `validate()`。
- 内部 Info（`StartCaptureInfo`、`StopCaptureInfo`、`RecordingStartedInfo`、
  `RecordingStoppedInfo`、`RecordingObservedInfo`、`RecordingEventInfo`、
  `ObserveRecordingInfo`、`PollUnifiedEventsInfo`）不得由 renderer/宿主直接注入；
  宿主只能经 `hostRoots` 向 observation 注入 `PollUnifiedEventsInfo`。

## 内部边界

- `UnifiedSessionNode`：纯领域，零 I/O，唯一 State Owner。
- `UnifiedCaptureNode`（execution）：经 `ctx.effectAdapter` 并发下发双源 start/stop，单源失败不丢另一源。
- `UnifiedObserverNode`（observation）：经 `ctx.effectAdapter` 并发轮询双源 live 事件 + 桌面权威 observe。
- canonical step：`{ index, time, source, application, windowTitle, action, description, locator, code, text, screenshotFile }`。
- 依赖：`@graphframework/sdk`；宿主注入 `desktopControl/browserControl/desktopObservation/desktopEvents/browserEvents`。
