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
  ObserverContext,
  OBSERVER_PANEL_DEFINITIONS,
} from './observerPanels'
import { createObserverWorkbenchAdapter } from './workbenchAdapter'

export interface ObserverNodeView {
  nodeId: string
  state: Record<string, unknown>
}

export interface PendingConfirmation {
  nodeId: string
  step: string
  requestId: string
  docName?: string | null
  text?: string | null
  prompt?: string | null
}

export interface ObserverSnapshot {
  revision: number
  graph: string | null
  nodes: ObserverNodeView[]
  watchedFields: Array<{ label: string; nodeId: string; path: string; value: unknown }>
  watchedInfos: Array<{ cursor: number; kind: string; infoType: string; nodeId?: string; targetNodeId?: string }>
  infoHistoryTruncated: boolean
  pendingConfirmation: PendingConfirmation | null
  sessionStatus: string | null
  lastError?: string | null
}

interface ObserverBridge {
  readState: () => Promise<ObserverSnapshot>
}

const getBridge = (): ObserverBridge | undefined =>
  (window as unknown as { observer?: ObserverBridge }).observer

declare global {
  interface Window {
    shell?: {
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
    }
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

const PAGE_TABS = [
  { key: 'main', label: '工作流观察', icon: '◉', badge: 'LIVE' },
]

const emptySnapshot: ObserverSnapshot = {
  revision: 0,
  graph: null,
  nodes: [],
  watchedFields: [],
  watchedInfos: [],
  infoHistoryTruncated: false,
  pendingConfirmation: null,
  sessionStatus: null,
}

export function App() {
  const [workbenchAdapter] = useState(() => createObserverWorkbenchAdapter(OBSERVER_PANEL_DEFINITIONS))
  const [snapshot, setSnapshot] = useState<ObserverSnapshot>(emptySnapshot)
  const [connected, setConnected] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => readThemePreference('dark'))
  const [typography, setTypography] = useState(() => readTypographyPreferences())

  const activeWorkspaceId = workbenchAdapter.useWorkspaceState((state) => state.activeWorkspaceId)

  useEffect(() => {
    applyThemePreference(theme)
    applyTypographyPreferences(typography)
  }, [])

  const refresh = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge) {
      setConnected(false)
      return
    }
    try {
      const next = await bridge.readState()
      setSnapshot(next)
      setConnected(true)
    } catch {
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [refresh])

  const sessionState = useMemo(() => {
    const session = snapshot.nodes.find((n) => n.nodeId.endsWith('/session'))
    return (session?.state ?? {}) as Record<string, unknown>
  }, [snapshot])
  const status = typeof sessionState.status === 'string' ? sessionState.status : (snapshot.sessionStatus ?? 'unknown')
  const statusTone = status === 'error' ? 'danger' : status === 'done' ? 'success' : status === 'awaiting-confirmation' ? 'warning' : 'accent'

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      void workbenchAdapter.services.commands.execute('workspace.activate', workspaceId)
    },
    [workbenchAdapter],
  )

  const observerContextValue = useMemo(() => ({ snapshot }), [snapshot])

  return (
    <ObserverContext.Provider value={observerContextValue}>
      <WorkbenchHostContext.Provider value={workbenchAdapter}>
        <div className="app-shell">
          <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
            <div className="brand-cluster">
              <span className="brand-glyph">◉</span>
              <span className="app-title">GraphFramework · 工作流观察</span>
              <IndustrialChip label={status} tone={statusTone} monospace />
            </div>
            <span className="topbar-spacer" />
            <div className="topbar-actions" role="toolbar" aria-label="观察控制">
              <button type="button" className="action-btn" onClick={() => void refresh()} title="刷新投影快照">
                ↻ 刷新
              </button>
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
            {!isMac && window.shell && (
              <div className="window-controls">
                <button type="button" title="最小化" onClick={() => window.shell?.minimize()}>—</button>
                <button type="button" title="最大化/恢复" onClick={() => window.shell?.toggleMaximize()}>▢</button>
                <button type="button" className="window-close" title="关闭" onClick={() => window.shell?.close()}>✕</button>
              </div>
            )}
          </header>

          <main className="app-content">
            <WorkspacePages />
          </main>

          <nav className="davinci-dock" aria-label="工作区分页">
            {PAGE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`dock-item${activeWorkspaceId === tab.key ? ' is-active' : ''}`}
                onClick={() => switchWorkspace(tab.key)}
              >
                <span className="dock-icon">{tab.icon}</span>
                <span className="dock-label">
                  {tab.label}
                  {tab.badge && <span className="dock-badge">{tab.badge}</span>}
                </span>
              </button>
            ))}
          </nav>

          <footer className="app-footer">
            <span>
              <i className={`connection-dot${connected ? '' : ' is-offline'}`} />
              {connected ? 'Projection 已连接' : 'Projection 未连接'}
            </span>
            <span className="footer-meta-tag">
              Rev: <code>{snapshot.revision}</code>
            </span>
            <span className="footer-meta-tag">
              会话: <code>{typeof sessionState.requestId === 'string' ? sessionState.requestId : '–'}</code>
            </span>
            <span className="footer-meta-tag" style={{ marginLeft: '12px' }}>
              快捷键: <code>Ctrl+Space</code> 最大化当前面板
            </span>
            <span className="footer-spacer" />
            <span>GraphFramework · Workflow Observer</span>
          </footer>

          <SettingsDialog
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            currentTheme={theme}
            onThemeChange={(next: ThemeName) => { setTheme(next); applyThemePreference(next) }}
            currentFont={typography.font}
            onFontChange={(font: InterfaceFont) => {
              setTypography((prev) => {
                const next = { ...prev, font }
                applyTypographyPreferences(next)
                return next
              })
            }}
            currentDensity={typography.size}
            onDensityChange={(size: InterfaceFontSize) => {
              setTypography((prev) => {
                const next = { ...prev, size }
                applyTypographyPreferences(next)
                return next
              })
            }}
            activeWorkspaceId={activeWorkspaceId}
            onSaveWorkspaceDefault={() => {
              const ws = workbenchAdapter.getWorkspaceSnapshot().items[activeWorkspaceId]
              if (ws) {
                saveWorkspaceDefault(ws)
                saveActiveWorkspacePreference(activeWorkspaceId)
              }
            }}
            onResetWorkspaceDefault={() => {
              void workbenchAdapter.services.commands.execute('workspace.resetLayout', activeWorkspaceId)
            }}
          />

        </div>
      </WorkbenchHostContext.Provider>
    </ObserverContext.Provider>
  )
}
