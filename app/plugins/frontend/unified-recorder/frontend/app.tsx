import { useCallback, useEffect, useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import {
  WorkbenchHostContext,
  WorkspacePages,
  readThemePreference,
  applyThemePreference,
  type ThemeName,
  readTypographyPreferences,
  applyTypographyPreferences,
  type InterfaceFont,
  type InterfaceFontSize,
  saveWorkspaceDefault,
  saveActiveWorkspacePreference,
} from '@graphframework/workbench'
import '@graphframework/workbench/styles/index.css'
import {
  SettingsDialog,
  IndustrialChip,
} from '@graphframework/ui'
import './app.css'
import {
  RECORDER_PANEL_DEFINITIONS,
  RecorderContext,
  type RecorderContextValue,
} from './recorderPanels'
import { createRecorderWorkbenchAdapter } from './workbenchAdapter'

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

export type RecorderProgressEntry = {
  at: string
  stage: string
  count?: number | null
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
  progressLog: RecorderProgressEntry[]
  browserAlive: boolean
  revision: number
}

export interface UnifiedRecorderBridge {
  readState: () => Promise<RecorderState>
  start: (sessionId?: string, sources?: Array<'desktop' | 'browser'>) => Promise<RecorderState>
  stop: () => Promise<RecorderState>
  openArtifact: () => Promise<{ ok: boolean; error?: string }>
  openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>
  launchBrowser: () => Promise<{ ok: boolean; alive?: boolean; output?: string; error?: string }>
  copyToClipboard: (text: string) => Promise<{ ok: boolean }>
  readImage?: (targetPath: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
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
  progressLog: [],
  browserAlive: false,
  revision: 0,
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

const PAGE_TABS = [
  { key: 'controls', label: '控制中枢', icon: '⬡', badge: 'REC' },
  { key: 'screenshots', label: '截图证据', icon: '🖼', badge: 'IMG' },
] as const

export function App() {
  const [workbenchAdapter] = useState(() => createRecorderWorkbenchAdapter(RECORDER_PANEL_DEFINITIONS))
  const [state, setState] = useState<RecorderState>(emptyState)
  const [busy, setBusy] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  const [copied, setCopied] = useState<'path' | 'script' | 'transcript' | null>(null)
  const [activeSources, setActiveSources] = useState<Array<'desktop' | 'browser'>>(['desktop', 'browser'])
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => readThemePreference('dark'))
  const [typography, setTypography] = useState(() => readTypographyPreferences())

  // 监听当前激活的工作区 ID (达芬奇底部坞)
  const activeWorkspaceId = workbenchAdapter.useWorkspaceState((s) => s.activeWorkspaceId)

  // 主题与排版偏好初始化与广播
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

  const handleSaveWorkspaceDefault = useCallback(() => {
    const snapshot = workbenchAdapter.getWorkspaceSnapshot()
    const ws = snapshot.items[activeWorkspaceId]
    if (ws) {
      saveWorkspaceDefault(ws)
      saveActiveWorkspacePreference(activeWorkspaceId)
    }
  }, [workbenchAdapter, activeWorkspaceId])

  const handleResetWorkspaceDefault = useCallback(() => {
    void workbenchAdapter.services.commands.execute('workspace.resetLayout', activeWorkspaceId)
  }, [workbenchAdapter, activeWorkspaceId])

  // 轮询微内核与宿主状态
  const refreshState = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge) return
    try {
      const next = await bridge.readState()
      setState(next)
    } catch {
      // 优雅降级
    }
  }, [])

  useEffect(() => {
    refreshState()
    const timer = setInterval(() => {
      refreshState()
    }, 1200)
    return () => clearInterval(timer)
  }, [refreshState])

  // 开始录制
  const handleStart = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge || busy) return
    setBusy(true)
    try {
      const next = await bridge.start(undefined, activeSources)
      setState(next)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, lastError: message, status: 'error' }))
    } finally {
      setBusy(false)
    }
  }, [busy, activeSources])

  // 停止录制
  const handleStop = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge || busy) return
    setBusy(true)
    try {
      const next = await bridge.stop()
      setState(next)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, lastError: message, status: 'error' }))
    } finally {
      setBusy(false)
    }
  }, [busy])

  // 快捷打开专用浏览器 (9343)
  const handleLaunchBrowser = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge || browserBusy) return
    setBrowserBusy(true)
    try {
      const res = await bridge.launchBrowser()
      if (!res?.ok) {
        setState((prev) => ({
          ...prev,
          lastError: `打开专用浏览器失败: ${res?.error ?? '未响应'}`,
        }))
      } else {
        setState((prev) => ({
          ...prev,
          browserAlive: true,
          lastError: null,
        }))
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, lastError: `打开专用浏览器异常: ${message}` }))
    } finally {
      setBrowserBusy(false)
    }
  }, [browserBusy])

  // 打开产物目录
  const handleOpenArtifact = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge) return
    try {
      await bridge.openArtifact()
    } catch {}
  }, [])

  // 打开任意路径
  const handleOpenPath = useCallback(async (targetPath: string) => {
    const bridge = getBridge()
    if (!bridge || !targetPath) return
    try {
      await bridge.openPath(targetPath)
    } catch {}
  }, [])

  // 剪贴板复制
  const handleCopy = useCallback(async (type: 'path' | 'script' | 'transcript', text: string) => {
    const bridge = getBridge()
    if (!text) return
    if (bridge?.copyToClipboard) {
      await bridge.copyToClipboard(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  // 达芬奇工作区切换
  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      void workbenchAdapter.services.commands.execute('workspace.activate', workspaceId)
    },
    [workbenchAdapter],
  )

  const recorderContextValue = useMemo<RecorderContextValue>(
    () => ({
      state,
      busy,
      browserBusy,
      activeSources,
      setActiveSources,
      copied,
      handleStart,
      handleStop,
      handleLaunchBrowser,
      handleOpenArtifact,
      handleOpenPath,
      handleCopy,
    }),
    [
      state,
      busy,
      browserBusy,
      activeSources,
      copied,
      handleStart,
      handleStop,
      handleLaunchBrowser,
      handleOpenArtifact,
      handleOpenPath,
      handleCopy,
    ],
  )

  return (
    <RecorderContext.Provider value={recorderContextValue}>
      <WorkbenchHostContext.Provider value={workbenchAdapter}>
        <div className="app-shell">
          {/* 顶栏：无缝暗黑无边框（品牌集群 + 快捷控制 + 设置入口 + 窗口控制） */}
          <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
            <div className="brand-cluster">
              <span className="brand-glyph">⬡</span>
              <span className="app-title">GraphFramework · 统一录制</span>
              <IndustrialChip
                label={state.status.toUpperCase()}
                tone={
                  state.status === 'recording'
                    ? 'accent'
                    : state.status === 'error'
                      ? 'danger'
                      : state.status === 'processing'
                        ? 'warning'
                        : 'muted'
                }
                monospace
              />
              {state.eventCount > 0 && (
                <IndustrialChip
                  label={`${state.eventCount} EVENTS`}
                  tone="accent"
                  monospace
                />
              )}
            </div>

            <span className="topbar-spacer" />

            {/* 工业设置入口按钮 */}
            <div className="topbar-actions" role="toolbar" aria-label="工作台设置">
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

            {/* 窗口三键（Windows/Linux 由自定义顶栏接管） */}
            {!isMac && window.shell && (
              <div className="window-controls">
                <button type="button" title="最小化" onClick={() => window.shell?.minimize()}>
                  —
                </button>
                <button
                  type="button"
                  title="最大化/恢复"
                  onClick={() => window.shell?.toggleMaximize()}
                >
                  ▢
                </button>
                <button
                  type="button"
                  className="window-close"
                  title="关闭"
                  onClick={() => window.shell?.close()}
                >
                  ✕
                </button>
              </div>
            )}
          </header>

          {/* 工作区主内容区：由 Workbench 二叉树 Dock 系统完全接管（支持左上角自由页面切换、切分、调整大小、拖拽与拖出窗口） */}
          <main className="app-content">
            <WorkspacePages />
          </main>

          {/* 达芬奇风格底部工作区导航坞 */}
          <nav className="davinci-dock" aria-label="工作区分页">
            {PAGE_TABS.map((tab) => {
              const isActive = activeWorkspaceId === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`dock-item${isActive ? ' is-active' : ''}`}
                  onClick={() => switchWorkspace(tab.key)}
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

          {/* 极简底栏：因果状态 + 双页指引 */}
          <footer className="app-footer">
            <span>
              <i className={`connection-dot ${state.status !== 'error' ? '' : 'is-offline'}`} />
              {state.status !== 'error' ? 'RuleSpace 微内核协同中' : '服务通信异常'}
            </span>
            <span className="footer-meta-tag">
              会话: <code>{state.sessionId ?? 'IDLE'}</code>
            </span>
            <span className="footer-spacer" />
            <span>控制中枢 · 截图证据</span>
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
            activeWorkspaceId={activeWorkspaceId}
            onSaveWorkspaceDefault={handleSaveWorkspaceDefault}
            onResetWorkspaceDefault={handleResetWorkspaceDefault}
          />
        </div>
      </WorkbenchHostContext.Provider>
    </RecorderContext.Provider>
  )
}
