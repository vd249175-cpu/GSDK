---
type: package
title: OS Recorder
description: 基于 Microsoft UFO 用户演示格式的 Windows 全桌面操作录制插件
package_id: example.os-recorder
package_version: 1.0.0
maintainer: example-team
update_policy: publisher-replace-only
downstream_modification: forbidden
---

# OS Recorder

本插件维护跨应用桌面录制会话的权威 State。物理层采用 Microsoft UFO 官方用户
演示工作流所支持的 Windows Steps Recorder，输出 ZIP/MHT；产物可以继续交给
`packages/ufo/record_processor` 处理。

## 公开契约

- renderer 只可向 `<instance>/session` 发送：
  - `StartRecordingInfo { sessionId? }`
  - `StopRecordingInfo {}`
- Projection 包含：`status`、`sessionId`、`eventCount`、`events`、
  `applications`、`artifactPath`、`startedAt`、`completedAt` 与 `lastError`。
- 物理结果均经内部 Info 回到 Owner；renderer 不可直接调用 execution 或
  observation 节点。
- 录制期间由宿主授权的 `PollRecordingEventsInfo` 驱动 ObservationWorldNode，
  每批增量步骤经 `RecordingEventInfo` 流式回到 Owner；该 Info 不属于 renderer
  公开契约。

## 物理边界

- `RecordingCaptureNode` 是 ExecutionWorldNode，只负责启动/停止 PSR。
- `RecordingObserverNode` 是 ObservationWorldNode，只读取并解析已完成的录制产物。
- `RecordingSessionNode` 是纯领域 Owner，不访问进程、文件或 Windows API。
- Adapter 位于 `app/plugins/backend/os-recorder/bridge/`，UFO 上游源码固定在 `packages/ufo/`。
