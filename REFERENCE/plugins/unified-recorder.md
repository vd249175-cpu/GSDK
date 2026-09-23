---
type: Reference Manual
title: 统一双源录制插件
description: example.unified-recorder 的架构、消息、时间轴、声音字幕、产物与装配契约。
status: stable
---

# 统一双源录制插件

| 项目 | 值 |
| :--- | :--- |
| 插件 ID | `example.unified-recorder` |
| 后端 | [`app/plugins/backend/unified-recorder/`](../../app/plugins/backend/unified-recorder/) |
| 前端 | [`app/plugins/frontend/unified-recorder/`](../../app/plugins/frontend/unified-recorder/) |
| 主 run 数据 | `runs/main/.generated/data/recordings/` |

插件把 Windows 桌面、浏览器和麦克风合为同一录制会话，输出 Agent 可读操作记录、可回放脚本、截图、原生备份、独立声音轨道和字幕。

## 一图总览

```mermaid
mindmap
  root((统一录制))
    输入
      Windows 桌面
        PSR
        输入钩子
      浏览器
        Playwright 动作
        CDP 快照
      麦克风
        WebM 原音频
        WAV 转写副本
    核心
      Session
        状态唯一 Owner
        零 I/O
      Execution
        启停桌面与浏览器
      Observation
        轮询事件
        整理归档
    输出
      操作文字稿
      对齐时间轴
      回放脚本
      截图
      声音与字幕
      原生导出
    守护
      Renderer 白名单
      输入校验
      渲染错误边界
      启动恢复
      保存超时
```

## 架构边界

```mermaid
mindmap
  root((三节点))
    UnifiedSessionNode
      普通 Node
      唯一 State Owner
      合并事件与字幕
      只发 Info
    UnifiedCaptureNode
      ExecutionWorldNode
      调用 control adapters
      执行后立即结算
      不轮询
    UnifiedObserverNode
      ObservationWorldNode
      调用 observation adapters
      产生物理事实 Info
      不主动写外部状态
```

```mermaid
flowchart LR
    UI[Electron / React] -->|5 类 rendererRoots| S[Session]
    S -->|StartCaptureInfo<br/>StopCaptureInfo| E[Execution]
    E -->|RecordingStartedInfo<br/>RecordingStoppedInfo| S
    S -->|ObserveRecordingInfo| O[Observation]
    O -->|RecordingEventInfo<br/>RecordingObservedInfo| S
    E --> C[desktopControl<br/>browserControl]
    O --> A[desktopObservation<br/>desktopEvents<br/>browserEvents]
```

五个物理能力均由 run 宿主以 `EffectAdapter` 注入；插件不持有浏览器，也不直接驱动 PSR。

| Adapter 常量 | ID | 用途 |
| :--- | :--- | :--- |
| `DESKTOP_CONTROL_ADAPTER_ID` | `unified/desktop-control` | 启停桌面录制 |
| `BROWSER_CONTROL_ADAPTER_ID` | `unified/browser-control` | 启停浏览器录制 |
| `DESKTOP_OBSERVATION_ADAPTER_ID` | `unified/desktop-observation` | 解包 PSR/MHT、提取截图和权威轨迹 |
| `DESKTOP_EVENTS_ADAPTER_ID` | `unified/desktop-events` | 轮询桌面实时事件 |
| `BROWSER_EVENTS_ADAPTER_ID` | `unified/browser-events` | 轮询浏览器实时事件 |

## 工厂与公开入口

```js
import {
  createUnifiedRecorder,
  createUnifiedRecorderGraph,
} from '../../app/plugins/backend/unified-recorder/index.mjs'
```

| API | 返回值 | 说明 |
| :--- | :--- | :--- |
| `createUnifiedRecorder(ctx)` | `{ session, execution, observation }` | 自动绑定三个节点 ID；依赖从 `ctx.dependencies` 注入。 |
| `createUnifiedRecorderGraph(ctx)` | `Node[]` | 图工厂；本地 ID 为 `session`、`execution`、`observation`，无 required binding。 |

节点 ID 默认为 `example.unified-recorder/<localId>`；存在 `nodeIdFor()` 或 `instanceId` 时使用实例前缀。

### Renderer 白名单

五类消息均发往 `session`，并由 `validate()` 校验：

| Info | 关键载荷 | 作用 |
| :--- | :--- | :--- |
| `StartRecordingInfo` | `sessionId?`, `sources?` | 从 `idle/error` 进入 `starting`。来源限 `desktop/browser`。 |
| `StopRecordingInfo` | 无 | 从 `recording` 进入 `stopping`。 |
| `AudioTranscribedInfo` | `sessionId`, `audioFile`, `startedAt`, `durationMs`, `segments[]` | 合并声音片段和字幕。 |
| `CorrectSubtitleInfo` | `id`, `text` | 修正字幕并同步持久化。 |
| `RestoreSubtitlesInfo` | `subtitles[]`, `audioClips[]` | 启动后恢复声音时间轴。 |

`StartCaptureInfo`、`StopCaptureInfo`、`RecordingStartedInfo`、`RecordingStoppedInfo`、`ObserveRecordingInfo`、`RecordingObservedInfo`、`RecordingEventInfo` 和 `PollUnifiedEventsInfo` 是内部消息，不向 renderer 开放。宿主只可经 `hostRoots` 向 observation 注入 `PollUnifiedEventsInfo`。

### 会话状态

| 分组 | 字段 |
| :--- | :--- |
| 生命周期 | `status`, `sessionId`, `sources`, `startedAt`, `completedAt`, `lastError` |
| 物理句柄 | `handles.desktop`, `handles.browser` |
| 操作轨迹 | `events[]`, `eventCount`, `lastEvent`, `applications[]`, `browserActions` |
| 产物 | `artifactPath`, `sessionDir`, `agentTranscriptPath`, `agentTranscriptContent`, `screenshotsDirectory`, `nativeExports` |
| 处理进度 | `progressLog[]` |
| 声音 | `narrationStartedAt`, `subtitles[]`, `audioClips[]` |

状态流转：

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> starting: StartRecordingInfo
    error --> starting: StartRecordingInfo
    starting --> recording: RecordingStartedInfo
    recording --> stopping: StopRecordingInfo
    recording --> error: RecordingFailedInfo
    stopping --> processing: RecordingStoppedInfo
    processing --> idle: RecordingObservedInfo
    starting --> error: RecordingFailedInfo
    stopping --> error: RecordingFailedInfo
    processing --> error: RecordingFailedInfo
```

`RecordingEventInfo` 在录制中追加标准事件；`RecordingProgressInfo` 更新处理进度。桌面归档完成后，权威桌面轨迹替换桌面预览，浏览器流保留。

标准事件字段为：

```text
index, time, timestamp, atMs, timeSource, source, application, windowTitle,
action, description, locator, code, text, screenshotFile
```

顶层工具函数：`normalizeDesktopEvent`、`normalizeBrowserEvent`、`normalizeEvent`、`renumberEvents`、`buildTranscript`、`buildReplayScript`、`plaintextOf`。个人系统中的 `fill/type` 明文保存在 `text/code`，不做脱敏。

## 声音、字幕与时间轴

```mermaid
flowchart LR
    M[选定麦克风] --> W[录制 WebM/Opus 原件]
    W --> P[本地检测发声与停顿]
    W --> V[生成单声道 16 kHz WAV]
    V --> R[OpenRouter 转写]
    R --> T[词级或片段时间]
    P --> S[按停顿拆分字幕]
    T --> S
    S --> C[人工修正]
    C --> F[subtitles.json / SRT / 解说文字稿]
    W --> F
    F --> U[合入最终会话目录]
```

- 前端可选择麦克风、查看电平，并试录 5 秒回放。
- 原始声音始终保留为 WebM；16 kHz 单声道 WAV 只用于转写。
- 宿主优先读取 `OPENROUTER_API_KEY`，其次读取仓库根目录未入 Git 的 `credentials.json` 中 `openrouter.apiKey`。
- 默认模型为 `microsoft/mai-transcribe-2`，可用 `OPENROUTER_STT_MODEL` 覆盖。OpenRouter 不保证中国区域路由。
- 请求 `verbose_json` 词级时间；提供方不接受时退回片段时间。
- 多句被合成单片段时，先用词级时间拆分；缺少词级时间时，按本地发声区间、最长停顿和句子数拆分；证据不足则保留原片段。
- 转写失败不丢声音。字幕可逐行修正，修正同步到索引、SRT 和解说文字稿。

### 统一时间基准

```mermaid
mindmap
  root((timeBase.startedAt))
    操作
      atMs
      timestamp
      timeSource
    解说
      startMs
      endMs
      timestamp
    交错索引
      timeline atMs
    展示
      UI 最新在前
      Agent 文本按原时序
      文本显示到秒
      浏览器未知时间留空
```

同一会话以 `unified-events.json.timeBase.startedAt` 为零点。内部排序和播放保留毫秒；`agent-transcript.md`、`narration-transcript.md`、`aligned-timeline.md` 只显示到秒。SRT 按格式保留毫秒并按时间正序；前端字幕按数值时间倒序，最新项在最前。

桌面输入钩子提供毫秒时间。PSR 只有钟表秒，能匹配钩子时标记 `hook-correlated`。浏览器步骤没有可靠时间时留空，不推算。旧录制只有秒级事实时，补写过程不能恢复毫秒精度。

## 产物

```mermaid
mindmap
  root((会话目录))
    Agent
      agent-transcript.md
      aligned-timeline.md
      narration-transcript.md
    结构化数据
      unified-events.json
      subtitles.srt
    回放与证据
      replay.js
      screenshots
      native
    声音
      audio/narration.webm
```

| 路径 | 内容 |
| :--- | :--- |
| `agent-transcript.md` | 只含操作步骤，便于单独读取。 |
| `narration-transcript.md` | 带真实时间与相对时间的解说。 |
| `aligned-timeline.md` | 操作、浏览器观察与解说的交错时间线。 |
| `unified-events.json` | 事件、`timeBase`、`timeline[]` 与 `narration` 关联。 |
| `audio/narration.webm` | 当前片段的独立原始声音轨道。 |
| `subtitles.srt` | 播放字幕。 |
| `native/`, `screenshots/`, `replay.js` | 原生导出、抽离截图与回放脚本。 |

声音暂存于 `recordings/narration/`，结算时复制进对应会话。`unified-events.json.narration` 保存 `audioClips`、`subtitles` 和 `transcriptFile`；即使转写失败，也写入声音关联。宿主启动后会为旧会话补写缺失的解说或对齐文字稿，并移除旧版嵌入操作文字稿的整段解说。

目录名使用宿主本地时间：

```text
录制中  YYYY-MM-DD_HH-mm-ss_recording_<sessionId>
已完成  YYYY-MM-DD_HH-mm-ss__YYYY-MM-DD_HH-mm-ss_<sessionId>
```

结束日期单独记录，跨午夜不丢日期；历史目录不改名。只录浏览器时也使用独立会话目录。

## 前端可靠性与分段录制

```mermaid
mindmap
  root((轻量工作台))
    界面
      深浅主题
      状态徽章
      打开产物目录
      复制代码
    输入防护
      IPC 快照运行时校验
      缺失列表归一为空数组
    渲染防护
      React 错误边界
      故障页
      重试界面
      渲染日志
    恢复
      等待 run running
      等待 session Projection
      注入字幕索引
      失败后下次读取重试
    分段
      设置录制间隔
      到时弹窗暂停操作
      等待操作与声音结算
      保存后自动续录
      超时或转写失败停止续录
```

正常快照与错误快照共用字段映射。状态读取失败时界面保持可见、显示错误并继续轮询。

`window.recorder` 桥接提供状态读取、启停与结算、暂停提示、打开产物或指定路径、启动专用浏览器、复制文本、读取截图或声音、保存声音、修正字幕和打开声音目录；页面不直接访问 Node 或文件系统。

“录制间隔”决定每段时长；“保存等待上限”覆盖停止录制、操作归档和音频转写。到时先弹出阻塞提示，再保存当前片段；全部完成后开始下一段。超时或转写失败时停止自动续录，已落盘内容仍可检查。

## 装配与运行

`runs/<name>/assembly.mjs`：

```js
export default {
  id: 'main.assembly',
  contribute(run) {
    run.backendPlugin({ id: 'example.unified-recorder', path: '../../app/plugins/backend/unified-recorder' })
    run.frontendPlugin({ id: 'example.unified-recorder', path: '../../app/plugins/frontend/unified-recorder' })
    run.graph({ id: 'recorder', plugin: 'example.unified-recorder', factory: 'createUnifiedRecorderGraph' })
    run.frontend({ id: 'main-ui', plugin: 'example.unified-recorder', graph: 'recorder' })
    run.requireNode('recorder/session')
  },
}
```

`runs/<name>/run.config.json` 中的宿主依赖：

```json
{
  "version": 2,
  "name": "main",
  "assembly": { "modules": ["assembly.mjs"] },
  "backend": {
    "host": "host.mjs",
    "dependencies": {
      "cdpUrl": "http://127.0.0.1:9343",
      "recordingBackend": "windows-steps-recorder",
      "ufoDirectory": "../../packages/ufo",
      "pythonExecutable": "python.exe"
    }
  }
}
```

唯一启动入口：

```bash
bash ./run.sh start runs/main/run.config.json
```
