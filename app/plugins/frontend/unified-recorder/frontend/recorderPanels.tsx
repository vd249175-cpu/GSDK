import { createContext, useContext, useEffect, useState } from 'react'
import {
  Activity,
  Bot,
  Check,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Layers,
  MonitorDot,
  MousePointer2,
  Play,
  Sliders,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import type { PanelDefinition, PanelProps } from '@graphframework/workbench'
import { IndustrialChip, EmptyState } from '@graphframework/ui'
import type { RecorderState, UnifiedEvent } from './app'

/* ==========================================================================
   Recorder 状态与操作全局上下文
   ========================================================================== */
export interface RecorderContextValue {
  state: RecorderState
  busy: boolean
  browserBusy: boolean
  activeSources: Array<'desktop' | 'browser'>
  setActiveSources: (sources: Array<'desktop' | 'browser'>) => void
  copied: 'path' | 'script' | 'transcript' | null
  handleStart: () => Promise<void>
  handleStop: () => Promise<void>
  handleLaunchBrowser: () => Promise<void>
  handleOpenArtifact: () => Promise<void>
  handleOpenPath: (targetPath: string) => Promise<void>
  handleCopy: (type: 'path' | 'script' | 'transcript', text: string) => Promise<void>
}

export const RecorderContext = createContext<RecorderContextValue | null>(null)

export const useRecorder = () => {
  const ctx = useContext(RecorderContext)
  if (!ctx) throw new Error('useRecorder 必须在 RecorderContext.Provider 内使用')
  return ctx
}

const statusTone: Record<string, 'accent' | 'success' | 'warning' | 'danger' | 'muted'> = {
  idle: 'muted',
  starting: 'warning',
  recording: 'accent',
  stopping: 'warning',
  processing: 'warning',
  error: 'danger',
}

const statusLabelZh: Record<string, string> = {
  idle: '就绪 · 待命',
  starting: '启动中…',
  recording: '双源录制中 (REC)',
  stopping: '停止中…',
  processing: '数据清洗与提取',
  error: '运行异常',
}

/* ==========================================================================
   1. 控制中枢面板 (recorder.controls)
   ========================================================================== */
export function ControlsPanel(_props: PanelProps) {
  const {
    state,
    busy,
    browserBusy,
    activeSources,
    setActiveSources,
    handleStart,
    handleStop,
    handleLaunchBrowser,
    handleOpenArtifact,
    handleCopy,
    copied,
  } = useRecorder()

  const isRecording = state.status === 'recording' || state.status === 'starting'

  const toggleSource = (source: 'desktop' | 'browser') => {
    if (isRecording) return
    setActiveSources(
      activeSources.includes(source)
        ? activeSources.filter((s) => s !== source)
        : [...activeSources, source],
    )
  }

  return (
    <div className="panel-container controls-panel-content">
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">录制控制核心</span>
          <IndustrialChip
            label={statusLabelZh[state.status] ?? state.status}
            tone={statusTone[state.status] ?? 'muted'}
            monospace
          />
        </div>

        {/* 录制源配置 */}
        <div className="controls-box">
          <div className="box-label">双源捕获配置</div>
          <div className="source-checkbox-group">
            <label className={`source-checkbox-item ${activeSources.includes('desktop') ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={activeSources.includes('desktop')}
                disabled={isRecording}
                onChange={() => toggleSource('desktop')}
              />
              <MonitorDot size={14} />
              <span>Windows 原生键盘鼠标 (桌面底层钩子)</span>
            </label>
            <label className={`source-checkbox-item ${activeSources.includes('browser') ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={activeSources.includes('browser')}
                disabled={isRecording}
                onChange={() => toggleSource('browser')}
              />
              <Globe size={14} />
              <span>专用 Chrome 浏览器 (CDP 9343 Playwright)</span>
            </label>
          </div>
        </div>

        {/* 主动作按钮 */}
        <div className="primary-actions-group">
          {!isRecording ? (
            <button
              type="button"
              className="action-btn is-primary is-hero"
              disabled={busy || activeSources.length === 0}
              onClick={() => void handleStart()}
            >
              <Play size={14} />
              <span>{busy ? '启动微内核…' : '开始统一录制'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="action-btn is-danger is-hero"
              disabled={busy}
              onClick={() => void handleStop()}
            >
              <Square size={14} />
              <span>{busy ? '正在清洗结算…' : '停止并清洗导出'}</span>
            </button>
          )}

          <button
            type="button"
            className={`action-btn is-hero ${state.browserAlive ? 'is-accent' : 'is-secondary'}`}
            disabled={browserBusy}
            onClick={() => void handleLaunchBrowser()}
            title="以 9343 端口与 Profile 1 独立目录启动或连接专用 Chrome"
          >
            <Globe size={13} />
            <span>
              {browserBusy
                ? '正在启动/连接浏览器…'
                : state.browserAlive
                  ? '● 专用浏览器已就绪 (9343 点击置顶)'
                  : '○ 打开专用浏览器 (9343)'}
            </span>
          </button>
        </div>
      </div>

      {/* 会话信息与产物概览 */}
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">会话指标与产物</span>
          <span className="session-id-tag">ID: {state.sessionId ?? '未启动'}</span>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">事件计数</div>
            <div className="metric-value">{state.eventCount}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">关联应用</div>
            <div className="metric-value">{state.applications.length || 1}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">时序版本 (Rev)</div>
            <div className="metric-value is-mono">{state.revision}</div>
          </div>
        </div>

        {state.artifactPath && (
          <div className="artifact-banner">
            <div className="artifact-info">
              <FolderOpen size={14} className="artifact-icon" />
              <div className="artifact-path is-mono" title={state.artifactPath}>
                {state.artifactPath}
              </div>
            </div>
            <div className="artifact-actions">
              <button
                type="button"
                className="action-btn is-small"
                onClick={() => void handleOpenArtifact()}
              >
                <ExternalLink size={12} />
                <span>打开文件夹</span>
              </button>
              <button
                type="button"
                className="action-btn is-small"
                onClick={() => void handleCopy('path', state.artifactPath ?? '')}
              >
                {copied === 'path' ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied === 'path' ? '已复制' : '复制路径'}</span>
              </button>
            </div>
          </div>
        )}

        {state.lastError && (
          <div className="error-callout">
            <div className="error-title">最后异常告警:</div>
            <div className="error-text is-mono">{state.lastError}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   2. 实时轨迹面板 (recorder.timeline)
   ========================================================================== */
export function TimelinePanel(_props: PanelProps) {
  const { state } = useRecorder()
  const [filter, setFilter] = useState<'all' | 'desktop' | 'browser'>('all')

  const filteredEvents = state.events.filter((e) => (filter === 'all' ? true : e.source === filter))

  return (
    <div className="panel-container timeline-panel-content">
      <div className="panel-filter-bar">
        <span className="filter-title">动作事件流 ({filteredEvents.length})</span>
        <div className="filter-tabs">
          <button
            type="button"
            className={`filter-tab ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部 ({state.events.length})
          </button>
          <button
            type="button"
            className={`filter-tab ${filter === 'desktop' ? 'is-active' : ''}`}
            onClick={() => setFilter('desktop')}
          >
            桌面 ({state.events.filter((e) => e.source === 'desktop').length})
          </button>
          <button
            type="button"
            className={`filter-tab ${filter === 'browser' ? 'is-active' : ''}`}
            onClick={() => setFilter('browser')}
          >
            浏览器 ({state.events.filter((e) => e.source === 'browser').length})
          </button>
        </div>
      </div>

      <div className="timeline-scroll-box">
        {filteredEvents.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={state.status === 'recording' ? '正在监听输入与操作…' : '暂无事件记录'}
            description="点击控制面板的“开始统一录制”，在屏幕或浏览器中操作即可实时产生事件流。"
          />
        ) : (
          <div className="timeline-events-list">
            {filteredEvents.map((event) => {
              const isBrowser = event.source === 'browser'
              return (
                <div key={`${event.source}-${event.index}`} className={`timeline-event-card is-${event.source}`}>
                  <div className="event-card-header">
                    <span className="event-index is-mono">#{String(event.index).padStart(2, '0')}</span>
                    <span className={`event-source-badge is-${event.source}`}>
                      {isBrowser ? <Globe size={11} /> : <MonitorDot size={11} />}
                      <span>{isBrowser ? '浏览器' : '桌面'}</span>
                    </span>
                    {event.application && <span className="event-app-badge">{event.application}</span>}
                    <span className="event-spacer" />
                    {event.time && <span className="event-time is-mono"><Clock size={10} /> {event.time}</span>}
                  </div>

                  <div className="event-card-body">
                    <div className="event-action-line">
                      <span className="action-tag">{event.action ?? 'Action'}</span>
                      <span className="action-desc">{event.description ?? '-'}</span>
                    </div>

                    {event.code && (
                      <div className="event-code-snippet is-mono">
                        <code>{event.code}</code>
                      </div>
                    )}

                    {event.text && (
                      <div className="event-text-snippet">
                        <span className="text-label">输入文本:</span>
                        <span className="text-val">"{event.text}"</span>
                      </div>
                    )}

                    {event.screenshotFile && (
                      <div className="event-screenshot-ref is-mono">
                        <ImageIcon size={11} />
                        <span>{event.screenshotFile}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   3. Agent 纯文字版面板 (recorder.agent)
   ========================================================================== */
export function AgentTranscriptPanel(_props: PanelProps) {
  const { state, handleCopy, copied } = useRecorder()

  const transcript = state.agentTranscriptContent || (
    state.events.length > 0
      ? `# Unified Recording Transcript: ${state.sessionId ?? 'session'}\n` +
        `- Started: ${state.startedAt ?? '-'}\n` +
        `- Total Steps: ${state.events.length}\n\n` +
        `## Operations\n` +
        state.events.map((e) => `### Step ${String(e.index).padStart(2, '0')} [${e.source}]\n- Action: ${e.action}\n- Description: ${e.description}`).join('\n\n')
      : ''
  )

  return (
    <div className="panel-container agent-panel-content">
      <div className="panel-filter-bar">
        <div className="panel-bar-title">
          <Bot size={14} />
          <span>专供 LLM / Agent 纯文字语义记录 (agent-transcript.md)</span>
        </div>
        <div className="panel-bar-actions">
          <button
            type="button"
            className="action-btn is-small"
            disabled={!transcript}
            onClick={() => void handleCopy('transcript', transcript)}
          >
            {copied === 'transcript' ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied === 'transcript' ? '已复制' : '复制全文'}</span>
          </button>
        </div>
      </div>

      <div className="agent-text-view">
        {!transcript ? (
          <EmptyState
            icon={Bot}
            title="尚未生成 Agent 纯文字版"
            description="完成录制并停止后，系统将自动抽离 Base64 截图并编译出专供 LLM 与 Agent 调用的语义 Markdown。"
          />
        ) : (
          <pre className="transcript-markdown is-mono">{transcript}</pre>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   4. 截图与证据面板 (recorder.screenshots)
   ========================================================================== */
function ScreenshotCard({
  event,
  sessionDir,
  onOpenPath,
  onZoom,
}: {
  event: UnifiedEvent
  sessionDir: string | null
  onOpenPath: (path: string) => void
  onZoom: (dataUrl: string, title: string) => void
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let canceled = false
    const load = async () => {
      if (!event.screenshotFile) return
      const fullPath = sessionDir
        ? `${sessionDir.replace(/[/\\]+$/, '')}/${event.screenshotFile.replace(/^[/\\]+/, '')}`
        : event.screenshotFile
      const bridge = (window as unknown as { recorder?: { readImage?: (p: string) => Promise<{ ok: boolean; dataUrl?: string }> } }).recorder
      if (!bridge?.readImage) return
      setLoading(true)
      try {
        const res = await bridge.readImage(fullPath)
        if (!canceled && res.ok && res.dataUrl) {
          setDataUrl(res.dataUrl)
        }
      } catch {}
      if (!canceled) setLoading(false)
    }
    void load()
    return () => { canceled = true }
  }, [event.screenshotFile, sessionDir])

  const fullPath = sessionDir && event.screenshotFile
    ? `${sessionDir.replace(/[/\\]+$/, '')}/${event.screenshotFile.replace(/^[/\\]+/, '')}`
    : (event.screenshotFile ?? '')

  return (
    <div className="screenshot-card">
      <div className="screenshot-header is-mono">
        <span>Step {String(event.index).padStart(2, '0')}</span>
        <span>{event.application ?? event.source}</span>
      </div>
      <div
        className="screenshot-preview-container"
        onClick={() => dataUrl && onZoom(dataUrl, `Step ${String(event.index).padStart(2, '0')} · ${event.action ?? ''}`)}
      >
        {dataUrl ? (
          <img src={dataUrl} alt={event.description ?? 'screenshot'} className="screenshot-img" />
        ) : (
          <div className="screenshot-preview-placeholder">
            <ImageIcon size={24} />
            <span className="file-name is-mono">{loading ? '加载中…' : event.screenshotFile}</span>
          </div>
        )}
        {dataUrl && (
          <div className="screenshot-hover-overlay">
            <span className="overlay-zoom-text">点击放大</span>
          </div>
        )}
      </div>
      <div className="screenshot-footer">
        <div className="screenshot-desc" title={event.description ?? ''}>{event.description}</div>
        <button
          type="button"
          className="action-btn is-micro"
          title="在资源管理器中定位"
          onClick={(e) => {
            e.stopPropagation()
            onOpenPath(fullPath)
          }}
        >
          <FolderOpen size={10} />
          <span>定位</span>
        </button>
      </div>
    </div>
  )
}

export function ScreenshotsPanel(_props: PanelProps) {
  const { state, handleOpenPath } = useRecorder()
  const [zoomImage, setZoomImage] = useState<{ url: string; title: string } | null>(null)

  const screenshotEvents = state.events.filter((e) => Boolean(e.screenshotFile))

  return (
    <div className="panel-container screenshots-panel-content">
      <div className="panel-filter-bar">
        <div className="panel-bar-title">
          <ImageIcon size={14} />
          <span>截图索引与关键帧证据 ({screenshotEvents.length})</span>
        </div>
        {state.screenshotsDirectory && (
          <button
            type="button"
            className="action-btn is-small"
            onClick={() => void handleOpenPath(state.screenshotsDirectory ?? '')}
          >
            <FolderOpen size={12} />
            <span>打开截图目录</span>
          </button>
        )}
      </div>

      <div className="screenshots-scroll-box">
        {screenshotEvents.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="暂无独立截图"
            description="录制过程中的关键界面变迁或由步骤记录器捕获的截屏将以相对路径归档在 screenshots/ 目录并在此展示。"
          />
        ) : (
          <div className="screenshots-grid">
            {screenshotEvents.map((e) => (
              <ScreenshotCard
                key={e.index}
                event={e}
                sessionDir={state.sessionDir}
                onOpenPath={(targetPath) => void handleOpenPath(targetPath)}
                onZoom={(url, title) => setZoomImage({ url, title })}
              />
            ))}
          </div>
        )}
      </div>

      {zoomImage && (
        <div className="screenshot-modal-backdrop" onClick={() => setZoomImage(null)}>
          <div className="screenshot-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="screenshot-modal-header">
              <span className="is-mono">{zoomImage.title}</span>
              <button type="button" className="action-btn is-micro" onClick={() => setZoomImage(null)}>
                <X size={12} />
              </button>
            </div>
            <div className="screenshot-modal-body">
              <img src={zoomImage.url} alt="zoom preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ==========================================================================
   5. 原生代码回放面板 (recorder.native)
   ========================================================================== */
export function NativeReplayPanel(_props: PanelProps) {
  const { state, handleCopy, copied } = useRecorder()

  const browserCode = state.browserActions ?? state.nativeExports.browser ?? ''
  const fullReplay = state.events.map((event) => {
    if (event.source === 'browser' && event.code) return event.code
    return `// DESKTOP ${event.index}: [${event.application ?? '-'}] ${event.action ?? '-'} — ${event.description ?? ''}`
  }).join('\n')

  return (
    <div className="panel-container native-panel-content">
      <div className="panel-filter-bar">
        <div className="panel-bar-title">
          <Code2 size={14} />
          <span>原生自动化回放脚本 (Playwright / replay.js)</span>
        </div>
        <div className="panel-bar-actions">
          <button
            type="button"
            className="action-btn is-small"
            disabled={!fullReplay}
            onClick={() => void handleCopy('script', fullReplay)}
          >
            {copied === 'script' ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied === 'script' ? '已复制' : '复制完整脚本'}</span>
          </button>
        </div>
      </div>

      <div className="code-view-container">
        {!fullReplay && !browserCode ? (
          <EmptyState
            icon={Code2}
            title="暂无回放脚本"
            description="浏览器操作将自动编译为 Playwright 精准调用（goto/click/fill），桌面操作将编译为动作时序。"
          />
        ) : (
          <pre className="code-snippet-box is-mono">
            <code>{fullReplay || browserCode}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 注册表：导出标准 PanelDefinition
   ========================================================================== */
export const RECORDER_PANEL_DEFINITIONS: PanelDefinition[] = [
  {
    id: 'recorder.controls',
    title: '控制中枢',
    icon: Sliders,
    component: ControlsPanel,
  },
  {
    id: 'recorder.timeline',
    title: '实时轨迹',
    icon: Activity,
    component: TimelinePanel,
  },
  {
    id: 'recorder.agent',
    title: 'Agent文字版',
    icon: Bot,
    component: AgentTranscriptPanel,
  },
  {
    id: 'recorder.screenshots',
    title: '截图证据',
    icon: ImageIcon,
    component: ScreenshotsPanel,
  },
  {
    id: 'recorder.native',
    title: '原生回放',
    icon: Code2,
    component: NativeReplayPanel,
  },
]
