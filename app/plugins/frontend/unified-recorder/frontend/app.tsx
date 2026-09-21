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
  Maximize2,
  Minimize2,
  MonitorDot,
  MousePointer2,
  Play,
  Settings,
  Square,
  Terminal,
} from 'lucide-react'
import {
  readThemePreference,
  applyThemePreference,
  type ThemeName,
  readTypographyPreferences,
  applyTypographyPreferences,
  type InterfaceFont,
  type InterfaceFontSize,
} from '@graphframework/workbench'
import '@graphframework/workbench/styles/index.css'
import {
  SettingsDialog,
  IndustrialChip,
} from '@graphframework/ui'
import './app.css'

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'processing' | 'error'

export type UnifiedEvent = {
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

export type RecorderState = {
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

export interface UnifiedRecorderBridge {
  readState: () => Promise<RecorderState>
  start: (sessionId?: string, sources?: Array<'desktop' | 'browser'>) => Promise<RecorderState>
  stop: () => Promise<RecorderState>
  openArtifact: () => Promise<{ ok: boolean; error?: string }>
  openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>
  launchBrowser: () => Promise<{ ok: boolean; output?: string; error?: string }>
  copyToClipboard: (text: string) => Promise<{ ok: boolean }>
}

const getBridge = (): UnifiedRecorderBridge | undefined =>
  (window as unknown as { recorder?: UnifiedRecorderBridge }).recorder

declare global {
  interface Window {
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

const PAGE_TABS = [
  { key: 'editing', label: '工台分屏', icon: '◫', badge: 'Blender' },
  { key: 'timeline', label: '实时轨迹', icon: '☍', badge: 'Live' },
  { key: 'agent', label: 'Agent文字版', icon: '🤖', badge: 'Clean' },
  { key: 'screenshots', label: '截图索引', icon: '🖼', badge: 'IMG' },
  { key: 'native', label: '原生回放', icon: '☰', badge: 'Raw' },
] as const

type ViewMode = typeof PAGE_TABS[number]['key']

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
  const [view, setView] = useState<ViewMode>('editing')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => readThemePreference('dark'))
  const [typography, setTypography] = useState(() => readTypographyPreferences())
  const timelineEndRef = useRef<HTMLDivElement>(null)

  // 主题与排版偏好初始化
  useEffect(() => {
    applyThemePreference(theme)
    applyTypographyPreferences(typography)
  }, [])

  const handleThemeChange = useCallback((newTheme: ThemeName) => {
    setTheme(newTheme)
    applyThemePreference(newTheme)
  }, [])

  const handleFontChange = useCallback((font: InterfaceFont) => {
    setTypography((prev) => {
      const next = { ...prev, font }
      applyTypographyPreferences(next)
      return next
    })
  }, [])

  const handleDensityChange = useCallback((size: InterfaceFontSize) => {
    setTypography((prev) => {
      const next = { ...prev, size }
      applyTypographyPreferences(next)
      return next
    })
  }, [])

  // Blender 风格全局快捷键 Ctrl+Space 最大化/恢复分屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        setView((current) => (current === 'editing' ? 'timeline' : 'editing'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleLaunchBrowser = async () => {
    const bridge = getBridge()
    if (!bridge || browserBusy) return
    setBrowserBusy(true)
    try {
      await bridge.launchBrowser()
    } catch (err) {
      console.error('Failed to launch browser:', err)
    } finally {
      setBrowserBusy(false)
    }
  }

  const refresh = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge) return
    try {
      setState(await bridge.readState())
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
    const bridge = getBridge()
    if (!bridge || busy) return
    setBusy(true)
    try {
      const sessionId = `unified-${Date.now().toString(36)}`
      setState(await bridge.start(sessionId, activeSources))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    const bridge = getBridge()
    if (!bridge || busy) return
    setBusy(true)
    try {
      setState(await bridge.stop())
    } finally {
      setBusy(false)
    }
  }

  const copyText = async (kind: 'path' | 'script' | 'transcript', text: string | null) => {
    const bridge = getBridge()
    if (!bridge || !text) return
    await bridge.copyToClipboard(text)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1800)
  }

  const openPath = async (targetPath: string | null) => {
    const bridge = getBridge()
    if (!bridge || !targetPath) return
    await bridge.openPath(targetPath)
  }

  const isRecording = state.status === 'recording'
  const isTransitioning = ['starting', 'stopping', 'processing'].includes(state.status)
  const script = replayScript(state.events)
  const visibleEvents = state.events.filter((event) => activeSources.includes(event.source))
  const screenshotEvents = state.events.filter((e) => e.screenshotFile)

  // ================= 渲染各独立面板 =================

  // 1. 实时流式时间线
  const renderTimeline = (isSplit = false) => (
    <div className={`panel-surface timeline-panel-box${isSplit ? ' is-split' : ''}`}>
      <div className="panel-box-header">
        <div className="panel-box-title">
          <MousePointer2 size={13} />
          <span>实时流式时间线 ({visibleEvents.length})</span>
        </div>
        <div className="panel-box-actions">
          {isSplit ? (
            <button type="button" className="box-action-btn" title="全屏查看 (Ctrl+Space)" onClick={() => setView('timeline')}>
              <Maximize2 size={11} />
            </button>
          ) : (
            <button type="button" className="box-action-btn" title="返回分屏工台" onClick={() => setView('editing')}>
              <Minimize2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="panel-box-content timeline-scroll-area">
        {visibleEvents.length > 0 ? (
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
        )}
        <div ref={timelineEndRef} />
      </div>
    </div>
  )

  // 2. Agent 纯文字版 (无 Base64)
  const renderAgentTranscript = (isSplit = false) => (
    <div className={`panel-surface agent-panel-box${isSplit ? ' is-split' : ''}`}>
      <div className="panel-box-header">
        <div className="panel-box-title">
          <Bot size={13} />
          <span>Agent 纯文字版 (纯净上下文 / 相对截图路径)</span>
        </div>
        <div className="panel-box-actions">
          <button
            type="button"
            className="action-btn is-accent"
            disabled={!state.agentTranscriptContent}
            onClick={() => copyText('transcript', state.agentTranscriptContent)}
            title="一键复制给 Agent"
          >
            {copied === 'transcript' ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
            <span>{copied === 'transcript' ? '已复制' : '复制全文'}</span>
          </button>
          {state.agentTranscriptPath && (
            <button
              type="button"
              className="action-btn"
              onClick={() => openPath(state.agentTranscriptPath)}
              title="打开 agent-transcript.md"
            >
              <FolderOpen size={11} />
              <span>定位</span>
            </button>
          )}
          {isSplit ? (
            <button type="button" className="box-action-btn" title="全屏查看" onClick={() => setView('agent')}>
              <Maximize2 size={11} />
            </button>
          ) : (
            <button type="button" className="box-action-btn" title="返回分屏工台" onClick={() => setView('editing')}>
              <Minimize2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="panel-box-content agent-scroll-area">
        <pre className="text-view agent-transcript-box">
          {state.agentTranscriptContent || (
            state.events.length > 0
              ? '正在生成 agent-transcript.md… 请稍候'
              : '录制完成后将在此自动生成结构化 Agent 纯文字版本。'
          )}
        </pre>
      </div>
    </div>
  )

  // 3. 截图索引与取证
  const renderScreenshots = (isSplit = false) => (
    <div className={`panel-surface screenshots-panel-box${isSplit ? ' is-split' : ''}`}>
      <div className="panel-box-header">
        <div className="panel-box-title">
          <ImageIcon size={13} />
          <span>截图索引与取证 ({screenshotEvents.length} 张)</span>
        </div>
        <div className="panel-box-actions">
          {state.screenshotsDirectory && (
            <button
              type="button"
              className="action-btn"
              onClick={() => openPath(state.screenshotsDirectory)}
              title="在资源管理器中打开截图目录"
            >
              <FolderOpen size={11} />
              <span>打开目录</span>
            </button>
          )}
          {isSplit ? (
            <button type="button" className="box-action-btn" title="全屏查看" onClick={() => setView('screenshots')}>
              <Maximize2 size={11} />
            </button>
          ) : (
            <button type="button" className="box-action-btn" title="返回分屏工台" onClick={() => setView('editing')}>
              <Minimize2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="panel-box-content screenshots-scroll-area">
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
              当前会话暂无截图文件。在 Windows 上操作时截图自动提取解压至 screenshots/ 目录。
            </span>
          </div>
        )}
      </div>
    </div>
  )

  // 4. 原生导出与回放
  const renderNativeExports = (isSplit = false) => (
    <div className={`panel-surface native-panel-box${isSplit ? ' is-split' : ''}`}>
      <div className="panel-box-header">
        <div className="panel-box-title">
          <FileCode2 size={13} />
          <span>原生产物与 Playwright 回放</span>
        </div>
        <div className="panel-box-actions">
          {isSplit ? (
            <button type="button" className="box-action-btn" title="全屏查看" onClick={() => setView('native')}>
              <Maximize2 size={11} />
            </button>
          ) : (
            <button type="button" className="box-action-btn" title="返回分屏工台" onClick={() => setView('editing')}>
              <Minimize2 size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="panel-box-content native-scroll-area">
        <div className="native-cards-row">
          <div className="native-card">
            <div className="card-header">
              <Terminal size={13} />
              <span>浏览器原生 Playwright 导出</span>
            </div>
            <div className="card-body">
              <pre className="code-box">{state.browserActions || '// 暂无浏览器原生动作'}</pre>
              {state.nativeExports.browser && (
                <div className="card-footer">
                  <button type="button" className="action-btn" onClick={() => openPath(state.nativeExports.browser)}>
                    <FolderOpen size={11} />
                    <span>打开 playwright-actions.js</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="native-card">
            <div className="card-header">
              <FolderArchive size={13} />
              <span>桌面原生 Steps Recorder 导出 (ZIP/MHT)</span>
            </div>
            <div className="card-body">
              <p className="card-desc">Windows Steps Recorder (PSR) 原生归档压缩包：</p>
              <div className="meta-row">
                <span className="meta-label">归档文件：</span>
                <span className="meta-value" title={state.nativeExports.desktop ?? '未就绪'}>
                  {state.nativeExports.desktop ? state.nativeExports.desktop.split('\\').pop() : '未就绪'}
                </span>
              </div>
              {state.nativeExports.desktop && (
                <div className="card-footer">
                  <button type="button" className="action-btn" onClick={() => openPath(state.nativeExports.desktop)}>
                    <FolderOpen size={11} />
                    <span>定位桌面 ZIP 归档</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      {/* 顶部栏：包含品牌、状态、录制动作、全局设置与窗口控制 */}
      <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
        <div className="brand-cluster">
          <span className="brand-glyph">⬡</span>
          <span className="app-title">GraphFramework · 统一全态录制工作台</span>
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
            <Globe size={12} />
            <span>{browserBusy ? '启动中…' : '打开专用浏览器'}</span>
          </button>

          <button
            type="button"
            className={`action-btn${activeSources.includes('desktop') ? ' is-active' : ''}`}
            disabled={isRecording || busy}
            onClick={() => toggleSource('desktop')}
            title="录制桌面 PSR / LL-Hook 轨迹"
          >
            <MonitorDot size={12} />
            <span>桌面</span>
          </button>

          <button
            type="button"
            className={`action-btn${activeSources.includes('browser') ? ' is-active' : ''}`}
            disabled={isRecording || busy}
            onClick={() => toggleSource('browser')}
            title="录制 9343 专用浏览器 Playwright 动作"
          >
            <Globe size={12} />
            <span>浏览器</span>
          </button>

          {!isRecording ? (
            <button type="button" className="action-btn is-primary" disabled={busy || isTransitioning} onClick={start}>
              <Play size={12} />
              <span>{busy || state.status === 'starting' ? '启动中…' : '开始统一录制'}</span>
            </button>
          ) : (
            <button type="button" className="action-btn is-danger" disabled={busy} onClick={stop}>
              <Square size={12} />
              <span>{busy ? '正在清洗与导出…' : '停止并生成记录'}</span>
            </button>
          )}

          {state.artifactPath && !isRecording && (
            <button type="button" className="action-btn" onClick={() => getBridge()?.openArtifact()} title="在文件夹中打开会话产物">
              <FolderOpen size={12} />
              <span>打开产物目录</span>
            </button>
          )}

          {/* 全局设置弹窗入口 */}
          <button
            type="button"
            className="action-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="工作台全局偏好设置 (主题 / 字体 / 布局)"
          >
            <Settings size={12} />
            <span>设置</span>
          </button>
        </div>

        {/* 窗口三键（Windows/Linux） */}
        {!isMac && window.shell && (
          <div className="window-controls">
            <button type="button" title="最小化" onClick={() => window.shell?.minimize()}>—</button>
            <button type="button" title="最大化/恢复" onClick={() => window.shell?.toggleMaximize()}>▢</button>
            <button type="button" className="window-close" title="关闭" onClick={() => window.shell?.close()}>✕</button>
          </div>
        )}
      </header>

      {/* 主工作区：支持 Blender 风格分屏或达芬奇单页聚焦 */}
      <main className="app-content">
        {/* 指标概要条 */}
        <div className="metrics-row">
          <div className="metric-card">
            <span className="metric-label">当前状态</span>
            <span className={`metric-value${isRecording ? ' is-danger' : ''}`}>{state.status.toUpperCase()}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">会话标识</span>
            <span className="metric-value is-mono" title={state.sessionId ?? '-'}>{state.sessionId ?? '-'}</span>
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

        {/* 核心视图切换 */}
        <div className="workspace-viewport">
          {view === 'editing' && (
            <div className="blender-split-layout">
              {/* 左栏：实时流式时间线 */}
              <div className="split-column left-column">
                {renderTimeline(true)}
              </div>
              {/* 右栏：Agent 纯文本 + 截图索引 + 原生回放 */}
              <div className="split-column right-column">
                <div className="split-row top-row">
                  {renderAgentTranscript(true)}
                </div>
                <div className="split-row bottom-row">
                  {renderScreenshots(true)}
                </div>
              </div>
            </div>
          )}

          {view === 'timeline' && renderTimeline(false)}
          {view === 'agent' && renderAgentTranscript(false)}
          {view === 'screenshots' && renderScreenshots(false)}
          {view === 'native' && renderNativeExports(false)}
        </div>
      </main>

      {/* 达芬奇风格底部工作区导航坞 */}
      <nav className="davinci-dock" aria-label="工作区分页">
        {PAGE_TABS.map((tab) => {
          const isActive = view === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              className={`dock-item${isActive ? ' is-active' : ''}`}
              onClick={() => setView(tab.key)}
            >
              <span className="dock-icon">{tab.icon}</span>
              <span className="dock-label">
                {tab.label}
                {tab.badge && <span className="dock-badge">{tab.badge}</span>}
              </span>
            </button>
          )
        })}
      </nav>

      {/* 极客底栏：因果状态与快捷键提示 */}
      <footer className="app-footer">
        <span>
          <i className={`connection-dot${state.status === 'error' ? ' is-offline' : ''}`} />
          {state.status === 'error' ? '微内核异常' : 'RuleSpace 状态已连接'}
        </span>
        <span className="footer-meta-tag">
          Rev: <code>{state.revision}</code>
        </span>
        <span className="footer-meta-tag">
          会话: <code>{state.sessionId ?? '未启动'}</code>
        </span>
        <span className="footer-meta-tag">
          步骤: <code>{state.eventCount}</code>
        </span>
        <span className="footer-meta-tag" style={{ marginLeft: '12px' }}>
          快捷键: <code>Ctrl+Space</code> 切换分屏工台与聚焦
        </span>
        <span className="footer-spacer" />
        <span>GraphFramework · DaVinci & Blender Dock Suite</span>
      </footer>

      {/* 全局偏好设置弹窗 */}
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentTheme={theme}
        onThemeChange={handleThemeChange}
        currentFont={typography.font}
        onFontChange={handleFontChange}
        currentDensity={typography.size}
        onDensityChange={handleDensityChange}
        activeWorkspaceId={view}
        onSaveWorkspaceDefault={() => {}}
        onResetWorkspaceDefault={() => setView('editing')}
      />
    </div>
  )
}
