---
type: package
title: Browser Recorder
description: 浏览器操作录制会话插件（Playwright/MCP 浏览器链路经 EffectAdapter 接入）
package_id: example.browser-recorder
package_version: 1.0.0
maintainer: example-team
update_policy: publisher-replace-only
downstream_modification: forbidden
---

# Browser Recorder

唯一职责：维护浏览器操作录制会话 State（开始/停止/事件计数），执行与观察
物理分离，浏览器本体（Playwright 启动的浏览器或用户已打开的浏览器）永远
在 Node 之外、只经 EffectAdapter 接入。

明确不承担：Playwright 浏览器安装与启动编排、MCP 服务部署、真实页面抓取
与录制自动化策略（策略归未来的独立 `recording-automation` 插件）、前端
（本插件 backend-only，无用户操作面之外的 Element/Workspace）。

## 公开契约

- 目标 Node：`<instance>/session`（Owner，心智：`example.browser-recorder/session`）。
- 可接收 Info：
  - `StartRecordingInfo { sessionId? }` → 进入 `recording`，向 execution 发送 `StartCaptureInfo`；
  - `StopRecordingInfo {}` → 回到 `idle`，向 execution 发送 `StopCaptureInfo`；
  - `RecordingStatusInfo { status, sessionId, handle?, actions? }`（仅 execution 发送；stop 时 `actions` 为录制代码文本，回填 `lastActions`）；
  - `RecordingEventInfo { sessionId, event }`（仅 observation 发送，快照事件 `kind: 'snapshot'`）。
- 公开 Projection：`{ status, sessionId, handle, lastActions, eventCount, lastEvent, lastError }`。
- 对外发送：session → execution（`StartCaptureInfo`/`StopCaptureInfo`）；
  execution → session（`RecordingStatusInfo`）；observation → session（`RecordingEventInfo`）。
- rendererRoots（用户意图仅此两项，均带 `validate()`）：
  `StartRecordingInfo`、`StopRecordingInfo` → session。
- 内部 Info（`StartCaptureInfo`、`StopCaptureInfo`、`RecordingStatusInfo`、
  `RecordingEventInfo`、`PollRecordingEventsInfo`）不得由 renderer/宿主直接注入。

## 内部边界

- `RecordingSessionNode`：纯领域，零 I/O，唯一 State Owner。
- `BrowserCaptureNode`（execution）：只调 `browser/capture-control` 下发 start/stop，不监听。
- `BrowserObserverNode`（observation）：只调 `browser/capture-events` 轮询并转发，不下发动作。
- 依赖：`@graphframework/sdk`（Node/WorldNode/Info/Context），宿主注入
  `captureControl` / `captureEvents` Adapter；最低 GraphFramework：run config v2 + apiVersion 2。
- 前端：无（backend-only）。需要录制按钮时由消费方 run 经 rendererRoots 注入，不在本包加前端。

## 升级影响

- SemVer；正式更新为整体替换。generation 替换刻意丢弃旧 backlog 并以初始
  State 启动；录制中升级会丢失会话，需上层用显式 Info 重建。
- 污染判定：本目录出现 `node_modules`、构建缓存、密钥、用户数据或包外定制
  代码即视为污染；团队定制必须迁入独立插件。

## 反馈与完整性

- 发布者：example-team；问题反馈走插件发布通道。
- 安装/升级前核对本包 SHA-256（发布时附带），`graphframework.plugin.json`、
  `package.json` 与本文件头 `package_id`/`package_version` 必须一致（均为 `1.0.0`）。
