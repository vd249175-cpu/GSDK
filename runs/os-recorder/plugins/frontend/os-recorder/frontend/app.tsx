import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  AppWindow,
  Check,
  Clock,
  Copy,
  FolderOpen,
  MonitorDot,
  MousePointer2,
  Play,
  Radio,
  Square,
} from 'lucide-react'
import './app.css'

type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'processing' | 'error'

type RecordedEvent = {
  index: number
  time: string | null
  application: string | null
  applicationDescription: string | null
  action: string | null
  description: string | null
  screenshotFile: string | null
}

type RecorderState = {
  status: RecorderStatus
  sessionId: string | null
  handle: string | null
  eventCount: number
  events: RecordedEvent[]
  applications: string[]
  artifactPath: string | null
  recorder: string
  startedAt: string | null
  completedAt: string | null
  lastError: string | null
  revision: number
}

declare global {
  interface Window {
    recorder?: {
      readState: () => Promise<RecorderState>
      start: (sessionId?: string) => Promise<RecorderState>
      stop: () => Promise<RecorderState>
      openArtifact: () => Promise<{ ok: boolean; error?: string }>
      copyToClipboard: (text: string) => Promise<{ ok: boolean }>
    }
    shell?: {
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
    }
  }
}

const emptyState: RecorderState = {
  status: 'idle',
  sessionId: null,
  handle: null,
  eventCount: 0,
  events: [],
  applications: [],
  artifactPath: null,
  recorder: 'Microsoft UFO / Windows Steps Recorder',
  startedAt: null,
  completedAt: null,
  lastError: null,
  revision: 0,
}

const statusLabel: Record<RecorderStatus, string> = {
  idle: '就绪 (IDLE)',
  starting: '启动中',
  recording: '录制中 (REC)',
  stopping: '停止中',
  processing: '解析中',
  error: '异常 (ERROR)',
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

export function App() {
  const [state, setState] = useState<RecorderState>(emptyState)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const timelineEndRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    if (!window.recorder) return
    try {
      setState(await window.recorder.readState())
    } catch {
      // The next projection refresh will retry.
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 500)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.eventCount])

  const start = async () => {
    if (!window.recorder || busy) return
    setBusy(true)
    try {
      const sessionId = `desktop-${Date.now().toString(36)}`
      setState(await window.recorder.start(sessionId))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!window.recorder || busy) return
    setBusy(true)
    try {
      setState(await window.recorder.stop())
    } finally {
      setBusy(false)
    }
  }

  const copyArtifact = async () => {
    if (!window.recorder || !state.artifactPath) return
    await window.recorder.copyToClipboard(state.artifactPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const isRecording = state.status === 'recording'
  const isTransitioning = ['starting', 'stopping', 'processing'].includes(state.status)

  return (
    <div className="recorder-shell">
      <header className="recorder-topbar">
        <div className="brand-cluster">
          <span className="brand-glyph">⬡</span>
          <span className="app-title">GraphFramework · 全电脑操作录制</span>
          <div className={`status-badge status-${state.status}`}>
            <span className="status-dot" />
            <span>{statusLabel[state.status]}</span>
          </div>
        </div>

        <span className="topbar-spacer" />
        <div className="topbar-actions">
          {!isRecording ? (
            <button type="button" className="action-btn is-primary" disabled={busy || isTransitioning} onClick={start}>
              <Play size={13} />
              <span>{busy || state.status === 'starting' ? '启动中…' : '开始全桌面录制'}</span>
            </button>
          ) : (
            <button type="button" className="action-btn is-danger" disabled={busy} onClick={stop}>
              <Square size={13} />
              <span>{busy ? '正在结算…' : '停止并生成记录'}</span>
            </button>
          )}

          {state.artifactPath && !isRecording && (
            <>
              <button type="button" className="action-btn" onClick={() => window.recorder?.openArtifact()}>
                <FolderOpen size={13} />
                <span>打开产物</span>
              </button>
              <button type="button" className="action-btn" onClick={copyArtifact}>
                {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                <span>{copied ? '已复制' : '复制路径'}</span>
              </button>
            </>
          )}
        </div>

        {!isMac && window.shell && (
          <div className="window-controls">
            <button type="button" title="最小化" onClick={() => window.shell?.minimize()}>—</button>
            <button type="button" title="最大化/恢复" onClick={() => window.shell?.toggleMaximize()}>▢</button>
            <button type="button" className="window-close" title="关闭" onClick={() => window.shell?.close()}>✕</button>
          </div>
        )}
      </header>

      <main className="recorder-main">
        <div className="metrics-row">
          <div className="metric-card">
            <span className="metric-label">当前状态</span>
            <span className={`metric-value${isRecording ? ' is-danger' : ''}`}>{state.status.toUpperCase()}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">会话标识</span>
            <span className="metric-value" title={state.sessionId ?? '-'}>{state.sessionId ?? '-'}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">实时记录动作</span>
            <span className="metric-value is-accent">{state.eventCount}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">涉及应用</span>
            <span className="metric-value is-accent">{state.applications.length}</span>
          </div>
        </div>

        <section className="timeline-panel">
          <div className="panel-header">
            <div className="panel-title">
              <MousePointer2 size={14} />
              <span>UFO 用户演示轨迹 (Desktop Action Timeline)</span>
            </div>
            <span className="panel-meta">{state.artifactPath ?? '等待录制产物'}</span>
          </div>

          <div className="timeline-content">
            {state.events.length > 0 ? (
              state.events.map((event) => (
                <article className="event-row" key={`${event.index}-${event.time ?? ''}`}>
                  <div className="event-index">{String(event.index).padStart(2, '0')}</div>
                  <div className="event-body">
                    <div className="event-heading">
                      <span className="event-action">{event.action ?? 'Desktop Action'}</span>
                      <span className="event-app"><AppWindow size={11} /> {event.application ?? 'Windows'}</span>
                      {event.time && <span className="event-time"><Clock size={11} /> {event.time}</span>}
                    </div>
                    <p>{event.description ?? 'Recorded desktop interaction'}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Radio className={`empty-icon${isRecording ? ' is-live' : ''}`} />
                <div className="empty-text">
                  {isRecording ? (
                    <span>正在捕获整个 Windows 桌面的跨应用操作；每一步会实时显示在这里，停止后再以 UFO 权威轨迹结算。</span>
                  ) : state.status === 'processing' ? (
                    <span>正在解析 Windows Steps Recorder 产物…</span>
                  ) : (
                    <span>点击“开始全桌面录制”，随后可切换到任意 Windows 应用执行操作。录制结果保存为 UFO 可处理的 ZIP/MHT 演示文件。</span>
                  )}
                </div>
              </div>
            )}
            <div ref={timelineEndRef} />
          </div>
        </section>
      </main>

      <footer className="recorder-footer">
        <div className="footer-item">
          <Activity size={12} color={state.status === 'error' ? '#ef4444' : '#10b981'} />
          <span>微内核投影链路</span>
        </div>
        <div className="footer-item">
          <MonitorDot size={12} />
          <span>Windows Desktop · PSR</span>
        </div>
        {state.lastError && <div className="footer-error">错误: {state.lastError}</div>}
        <span className="footer-spacer" />
        <div className="footer-item"><span>Microsoft UFO Demonstration Format</span></div>
      </footer>
    </div>
  )
}
