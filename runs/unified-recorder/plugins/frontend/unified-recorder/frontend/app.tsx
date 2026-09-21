import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  AppWindow,
  Bot,
  Check,
  Clock,
  Code2,
  Copy,
  FileCode2,
  FileText,
  FolderArchive,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Layers,
  MonitorDot,
  MousePointer2,
  Play,
  Square,
  Terminal,
} from 'lucide-react'
import './app.css'

type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'processing' | 'error'

type UnifiedEvent = {
  index: number
  time: string | null
  source: 'desktop' | 'browser'
  application: string | null
  windowTitle: string | null
  action: string | null
  description: string | null
  locator: string | null
  code: string | null
  text: string | null
  screenshotFile: string | null
}

type RecorderState = {
  status: RecorderStatus
  sessionId: string | null
  sources: Array<'desktop' | 'browser'>
  handles: { desktop: string | null; browser: string | null }
  eventCount: number
  events: UnifiedEvent[]
  applications: string[]
  artifactPath: string | null
  sessionDir: string | null
  agentTranscriptPath: string | null
  agentTranscriptContent: string | null
  screenshotsDirectory: string | null
  nativeExports: { browser: string | null; desktop: string | null }
  browserActions: string | null
  startedAt: string | null
  completedAt: string | null
  lastError: string | null
  revision: number
}

declare global {
  interface Window {
    recorder?: {
      readState: () => Promise<RecorderState>
      start: (sessionId?: string, sources?: Array<'desktop' | 'browser'>) => Promise<RecorderState>
      stop: () => Promise<RecorderState>
      openArtifact: () => Promise<{ ok: boolean; error?: string }>
      openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>
      launchBrowser: () => Promise<{ ok: boolean; output?: string; error?: string }>
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
  sources: ['desktop', 'browser'],
  handles: { desktop: null, browser: null },
  eventCount: 0,
  events: [],
  applications: [],
  artifactPath: null,
  sessionDir: null,
  agentTranscriptPath: null,
  agentTranscriptContent: null,
  screenshotsDirectory: null,
  nativeExports: { browser: null, desktop: null },
  browserActions: null,
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
  processing: '数据清洗中 (PROCESSING)',
  error: '异常 (ERROR)',
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

const replayScript = (events: UnifiedEvent[]) => events.map((event) => {
  if (event.source === 'browser' && event.code) return event.code
  return `// DESKTOP ${event.index}: [${event.application ?? '-'}] ${event.action ?? '-'} — ${event.description ?? ''}`
}).join('\n')

export function App() {
  const [state, setState] = useState<RecorderState>(emptyState)
  const [busy, setBusy] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  const [copied, setCopied] = useState<'path' | 'script' | 'transcript' | null>(null)
  const [activeSources, setActiveSources] = useState<Array<'desktop' | 'browser'>>(['desktop', 'browser'])
  const [view, setView] = useState<'timeline' | 'agent' | 'screenshots' | 'native'>('timeline')
  const timelineEndRef = useRef<HTMLDivElement>(null)

  const handleLaunchBrowser = async () => {
    if (!window.recorder || browserBusy) return
    setBrowserBusy(true)
    try {
      await window.recorder.launchBrowser()
    } catch (err) {
      console.error('Failed to launch browser:', err)
    } finally {
      setBrowserBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    if (!window.recorder) return
    try {
      setState(await window.recorder.readState())
    } catch {
      // 容错重试
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

  const toggleSource = (source: 'desktop' | 'browser') => {
    setActiveSources((current) => {
      if (current.includes(source)) {
        const next = current.filter((item) => item !== source)
        return next.length > 0 ? next : current
      }
      return source === 'desktop' ? ['desktop', ...current.filter((item) => item !== 'desktop')] : [...current, source]
    })
  }

  const start = async () => {
    if (!window.recorder || busy) return
    setBusy(true)
    try {
      const sessionId = `unified-${Date.now().toString(36)}`
      setState(await window.recorder.start(sessionId, activeSources))
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

  const copyText = async (kind: 'path' | 'script' | 'transcript', text: string | null) => {
    if (!window.recorder || !text) return
    await window.recorder.copyToClipboard(text)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1800)
  }

  const openPath = async (targetPath: string | null) => {
    if (!window.recorder || !targetPath) return
    await window.recorder.openPath(targetPath)
  }

  const isRecording = state.status === 'recording'
  const isTransitioning = ['starting', 'stopping', 'processing'].includes(state.status)
  const script = replayScript(state.events)
  const visibleEvents = state.events.filter((event) => activeSources.includes(event.source))

  const screenshotEvents = state.events.filter((e) => e.screenshotFile)

  return (
    <div className="recorder-shell">
      <header className="recorder-topbar">
        <div className="brand-cluster">
          <span className="brand-glyph">⬡</span>
          <span className="app-title">GraphFramework · 统一录制 (桌面 + 浏览器)</span>
          <div className={`status-badge status-${state.status}`}>
            <span className="status-dot" />
            <span>{statusLabel[state.status]}</span>
          </div>
        </div>

        <span className="topbar-spacer" />
        <div className="topbar-actions">
          <button
            type="button"
            className="action-btn"
            disabled={browserBusy}
            onClick={handleLaunchBrowser}
            title="拉起或探活 9343 专用 Chrome (Profile 1 会话)"
          >
            <Globe size={13} />
            <span>{browserBusy ? '启动中…' : '打开专用浏览器'}</span>
          </button>

          <button
            type="button"
            className={`action-btn${activeSources.includes('desktop') ? ' is-active' : ''}`}
            disabled={isRecording || busy}
            onClick={() => toggleSource('desktop')}
            title="录制桌面 PSR / LL-Hook 轨迹"
          >
            <MonitorDot size={13} />
            <span>桌面</span>
          </button>
          <button
            type="button"
            className={`action-btn${activeSources.includes('browser') ? ' is-active' : ''}`}
            disabled={isRecording || busy}
            onClick={() => toggleSource('browser')}
            title="录制 9343 专用浏览器 Playwright 动作"
          >
            <Globe size={13} />
            <span>浏览器</span>
          </button>
          {!isRecording ? (
            <button type="button" className="action-btn is-primary" disabled={busy || isTransitioning} onClick={start}>
              <Play size={13} />
              <span>{busy || state.status === 'starting' ? '启动中…' : '开始统一录制'}</span>
            </button>
          ) : (
            <button type="button" className="action-btn is-danger" disabled={busy} onClick={stop}>
              <Square size={13} />
              <span>{busy ? '正在清洗与导出…' : '停止并生成记录'}</span>
            </button>
          )}

          {state.artifactPath && !isRecording && (
            <button type="button" className="action-btn" onClick={() => window.recorder?.openArtifact()} title="在文件夹中打开会话产物">
              <FolderOpen size={13} />
              <span>打开产物目录</span>
            </button>
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
            <span className="metric-label">统一步骤</span>
            <span className="metric-value is-accent">{state.eventCount}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">涉及应用</span>
            <span className="metric-value is-accent">{state.applications.length}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">提取截图</span>
            <span className="metric-value is-accent">{screenshotEvents.length}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Agent 纯文本</span>
            <span className="metric-value" title={state.agentTranscriptPath ? '已生成' : '待生成'}>
              {state.agentTranscriptContent ? '✓ 就绪' : '-'}
            </span>
          </div>
        </div>

        <section className="timeline-panel">
          <div className="panel-header">
            <div className="panel-title">
              <Layers size={14} />
              <span>双源合流工作区</span>
            </div>
            <div className="view-tabs">
              <button
                type="button"
                className={`view-tab${view === 'timeline' ? ' is-active' : ''}`}
                onClick={() => setView('timeline')}
              >
                <MousePointer2 size={12} />
                <span>实时流式时间线 ({visibleEvents.length})</span>
              </button>
              <button
                type="button"
                className={`view-tab${view === 'agent' ? ' is-active' : ''}`}
                onClick={() => setView('agent')}
              >
                <Bot size={12} />
                <span>Agent 纯文字版 (无 Base64)</span>
              </button>
              <button
                type="button"
                className={`view-tab${view === 'screenshots' ? ' is-active' : ''}`}
                onClick={() => setView('screenshots')}
              >
                <ImageIcon size={12} />
                <span>截图索引 ({screenshotEvents.length})</span>
              </button>
              <button
                type="button"
                className={`view-tab${view === 'native' ? ' is-active' : ''}`}
                onClick={() => setView('native')}
              >
                <FileCode2 size={12} />
                <span>原生导出与回放</span>
              </button>
            </div>
          </div>

          <div className="timeline-content">
            {view === 'timeline' && (
              visibleEvents.length > 0 ? (
                visibleEvents.map((event) => (
                  <article className="event-row" key={`${event.index}-${event.source}-${event.time ?? ''}`}>
                    <div className="event-index">{String(event.index).padStart(2, '0')}</div>
                    <div className="event-body">
                      <div className="event-heading">
                        <span className={`source-tag source-${event.source}`}>
                          {event.source === 'browser' ? <Globe size={11} /> : <MonitorDot size={11} />}
                          {event.source.toUpperCase()}
                        </span>
                        <span className="event-action">{event.action ?? '-'}</span>
                        <span className="event-app"><AppWindow size={11} /> {event.application ?? '-'}</span>
                        {event.time && <span className="event-time"><Clock size={11} /> {event.time}</span>}
                      </div>
                      <p className="event-desc">{event.description ?? ''}</p>
                      {event.code && (
                        <div className="code-block">
                          <Code2 size={12} className="code-icon" />
                          <code>{event.code}</code>
                        </div>
                      )}
                      {event.text && <p className="event-text">输入文本：<span className="text-highlight">{event.text}</span></p>}
                      {event.screenshotFile && (
                        <div className="event-shot-ref">
                          <ImageIcon size={11} />
                          <span>截图：{event.screenshotFile}</span>
                        </div>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <span className="empty-text">
                    {isRecording
                      ? '正在实时捕获桌面鼠标/按键与浏览器快照动作；停止后自动导出原生产物并清洗合并。'
                      : '点击上方“开始统一录制”，即可在 Windows 任意桌面应用和 9343 专用浏览器中操作。'}
                  </span>
                </div>
              )
            )}

            {view === 'agent' && (
              <div className="agent-view">
                <div className="section-toolbar">
                  <div className="toolbar-info">
                    <FileText size={13} />
                    <span>专供 LLM Agent 阅读的纯 Markdown 文本（附相对截图文件路径，绝不包含 Base64 塞爆上下文）</span>
                  </div>
                  <div className="toolbar-actions">
                    <button
                      type="button"
                      className="action-btn"
                      disabled={!state.agentTranscriptContent}
                      onClick={() => copyText('transcript', state.agentTranscriptContent)}
                    >
                      {copied === 'transcript' ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                      <span>{copied === 'transcript' ? '已复制到剪贴板' : '一键复制给 Agent'}</span>
                    </button>
                    {state.agentTranscriptPath && (
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => openPath(state.agentTranscriptPath)}
                        title="打开 agent-transcript.md"
                      >
                        <FolderOpen size={13} />
                        <span>定位文件</span>
                      </button>
                    )}
                  </div>
                </div>
                <pre className="text-view agent-transcript-box">
                  {state.agentTranscriptContent || (
                    state.events.length > 0
                      ? '正在生成 agent-transcript.md… 请稍候'
                      : '录制完成后将在此自动生成结构化 Agent 纯文字版本。'
                  )}
                </pre>
              </div>
            )}

            {view === 'screenshots' && (
              <div className="screenshots-view">
                <div className="section-toolbar">
                  <div className="toolbar-info">
                    <ImageIcon size={13} />
                    <span>从录制产物解出并落盘的真实截图文件 ({screenshotEvents.length} 张)</span>
                  </div>
                  {state.screenshotsDirectory && (
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => openPath(state.screenshotsDirectory)}
                    >
                      <FolderOpen size={13} />
                      <span>打开截图文件夹</span>
                    </button>
                  )}
                </div>
                {screenshotEvents.length > 0 ? (
                  <div className="screenshots-grid">
                    {screenshotEvents.map((event) => (
                      <div className="screenshot-card" key={`shot-${event.index}`}>
                        <div className="shot-header">
                          <span className="shot-step">步骤 #{event.index}</span>
                          <span className="shot-app">{event.application ?? '-'}</span>
                        </div>
                        <div className="shot-body">
                          <p className="shot-action">{event.action}</p>
                          <div className="shot-file-tag">
                            <ImageIcon size={11} />
                            <code>{event.screenshotFile}</code>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="empty-text">
                      当前会话暂无截图文件。在 Windows 上启用 PSR 时，操作截图将自动解压至 screenshots/ 目录。
                    </span>
                  </div>
                )}
              </div>
            )}

            {view === 'native' && (
              <div className="native-view">
                <div className="native-cards-row">
                  <div className="native-card">
                    <div className="card-header">
                      <Terminal size={14} />
                      <span>浏览器原生 Playwright 导出</span>
                    </div>
                    <div className="card-body">
                      <p className="card-desc">Playwright CLI 原生生成的端到端代码：</p>
                      <pre className="code-box">{state.browserActions || '// 暂无浏览器原生动作'}</pre>
                      {state.nativeExports.browser && (
                        <div className="card-footer">
                          <button
                            type="button"
                            className="action-btn"
                            onClick={() => openPath(state.nativeExports.browser)}
                          >
                            <FolderOpen size={12} />
                            <span>定位 browser-playwright.js</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="native-card">
                    <div className="card-header">
                      <FolderArchive size={14} />
                      <span>桌面原生 PSR 导出</span>
                    </div>
                    <div className="card-body">
                      <p className="card-desc">Windows Steps Recorder 原生打包的 ZIP / MHT 压缩包：</p>
                      <div className="file-info-box">
                        <span className="label">产物路径：</span>
                        <code className="path">{state.nativeExports.desktop ?? state.artifactPath ?? '无'}</code>
                      </div>
                      {state.nativeExports.desktop && (
                        <div className="card-footer">
                          <button
                            type="button"
                            className="action-btn"
                            onClick={() => openPath(state.nativeExports.desktop)}
                          >
                            <FolderOpen size={12} />
                            <span>定位 desktop-psr.zip</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="replay-section">
                  <div className="section-toolbar">
                    <div className="toolbar-info">
                      <Code2 size={13} />
                      <span>清洗合并后的完整回放脚本 (replay.js)</span>
                    </div>
                    <button type="button" className="action-btn" onClick={() => copyText('script', script)}>
                      {copied === 'script' ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                      <span>{copied === 'script' ? '已复制' : '复制回放脚本'}</span>
                    </button>
                  </div>
                  <pre className="text-view">{script || '// 暂无回放脚本'}</pre>
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
          <span>微内核因果投影</span>
        </div>
        <div className="footer-item">
          <MonitorDot size={12} />
          <span>桌面输入流 + 浏览器快照流</span>
        </div>
        <div className="footer-item">
          <FileText size={12} />
          <span>原生双导出 + Agent 纯文字 Transcript</span>
        </div>
        {state.lastError && <div className="footer-error">错误: {state.lastError}</div>}
        <span className="footer-spacer" />
        <div className="footer-item"><span>Unified Canonical Step Engine</span></div>
      </footer>
    </div>
  )
}
