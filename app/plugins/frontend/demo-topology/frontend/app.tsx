import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  WorkbenchHostContext,
  WorkspacePages,
} from '@graphframework/workbench'
import '@graphframework/workbench/styles/index.css'
import './app.css'
import {
  DemoContext,
  DEMO_PANEL_DEFINITIONS,
  CHARACTERS,
  type DemoSnapshot,
  type DemoContextValue,
} from './demoPanels'
import { createDemoWorkbenchAdapter } from './workbenchAdapter'

declare global {
  interface Window {
    graph: {
      incrementCounter: () => Promise<{ count: number }>
      readCounter: () => Promise<{ count: number }>
    }
    demo: {
      readState: () => Promise<DemoSnapshot>
      step: () => Promise<DemoSnapshot>
      reset: () => Promise<DemoSnapshot>
    }
    shell?: {
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
    }
  }
}

const THEMES = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'xueqing', label: '雪青' },
  { value: 'shiliuqun', label: '石榴裙' },
] as const

type ThemeValue = (typeof THEMES)[number]['value']

const THEME_STORAGE_KEY = 'example.theme'
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

function readInitialTheme(): ThemeValue {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (THEMES.some((entry) => entry.value === saved)) return saved as ThemeValue
  } catch {
    // 忽略异常
  }
  return 'dark'
}

const PAGE_TABS = [
  { key: 'editing', label: '万象工台', icon: '🪐', badge: 'Blender 分屏' },
  { key: 'astrolabe', label: '因果星盘', icon: '🌌' },
  { key: 'prophecy', label: '预言编织', icon: '📜' },
  { key: 'pantheon', label: '神格示波', icon: '⚖️' },
  { key: 'chronicle', label: '万象编年', icon: '🏛️' },
  { key: 'sandbox', label: '内核基石', icon: '⚡', badge: 'DTO' },
]

export function App() {
  const [workbenchAdapter] = useState(() => createDemoWorkbenchAdapter(DEMO_PANEL_DEFINITIONS))
  const [selectedCharId, setSelectedCharId] = useState<string>('demo.orders')
  const [viewingAct, setViewingAct] = useState<number>(0)
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [theme, setTheme] = useState<ThemeValue>(readInitialTheme)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const busyRef = useRef(false)

  // 监听当前激活的工作区 ID
  const activeWorkspaceId = workbenchAdapter.useWorkspaceState((state) => state.activeWorkspaceId)

  // 主题注入
  useEffect(() => {
    if (theme === 'dark') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // 忽略
    }
  }, [theme])

  // 刷新计数
  const refreshCounter = useCallback(async () => {
    try {
      const state = await window.graph.readCounter()
      setCount(state.count)
    } catch {
      setCount(null)
    }
  }, [])

  // 刷新拓扑演示
  const refreshDemo = useCallback(async () => {
    try {
      const s = await window.demo.readState()
      setSnapshot(s)
    } catch {
      setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    refreshCounter()
    refreshDemo()
    const timer = setInterval(() => {
      refreshDemo()
    }, 1000)
    return () => clearInterval(timer)
  }, [refreshCounter, refreshDemo])

  // 当 snapshot phase 改变时，同步当前查看幕次
  useEffect(() => {
    if (snapshot) {
      setViewingAct(snapshot.phase)
    }
  }, [snapshot?.phase])

  // 运行拓扑动作
  const runTopologyOp = useCallback(async (action: () => Promise<DemoSnapshot>) => {
    setBusy(true)
    busyRef.current = true
    try {
      const next = await action()
      setSnapshot(next)
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }, [])

  // 预言连续演进控制
  useEffect(() => {
    if (!playing) return
    if (snapshot && snapshot.phase >= 5) {
      setPlaying(false)
      return
    }
    const timer = setInterval(() => {
      if (busyRef.current) return
      runTopologyOp(() => window.demo.step()).catch(() => setPlaying(false))
    }, 3800)
    return () => clearInterval(timer)
  }, [playing, snapshot, runTopologyOp])

  const connected = typeof count === 'number'
  const selectedCharMeta = CHARACTERS[selectedCharId] ?? CHARACTERS['demo.orders']

  const demoContextValue = useMemo<DemoContextValue>(
    () => ({
      snapshot,
      selectedCharId,
      setSelectedCharId,
      viewingAct,
      setViewingAct,
      busy,
      playing,
      setPlaying,
      runTopologyOp,
    }),
    [snapshot, selectedCharId, viewingAct, busy, playing, runTopologyOp],
  )

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      void workbenchAdapter.services.commands.execute('workspace.activate', workspaceId)
    },
    [workbenchAdapter],
  )

  return (
    <DemoContext.Provider value={demoContextValue}>
      <WorkbenchHostContext.Provider value={workbenchAdapter}>
        <div className="app-shell">
          {/* 顶栏：无缝暗黑无边框（拖拽区 + 快捷控制 + 主题 + 窗口控制） */}
          <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
            <div className="brand-cluster">
              <span className="brand-glyph">🪐</span>
              <span className="app-title">星辰因果仪 · 达芬奇工作台</span>
              <span className="topbar-phase-badge">
                <i className="topbar-phase-dot" />
                第 {snapshot ? snapshot.phase : 0} 幕 / 5
              </span>
            </div>

            <span className="topbar-spacer" />

            {/* 全局因果推进快捷工具组 */}
            <div className="topbar-actions" role="toolbar" aria-label="推演控制">
              <button
                type="button"
                className="action-btn is-primary"
                disabled={!snapshot || busy || playing}
                onClick={() => void runTopologyOp(() => window.demo.step())}
                title="驱动因果流转进入下一幕"
              >
                {busy && !playing ? '应验中…' : '⚡ 应验此言'}
              </button>
              <button
                type="button"
                className="action-btn"
                disabled={!snapshot || busy}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? '⏸ 暂停演进' : '▶ 宣讲预言'}
              </button>
              <button
                type="button"
                className="action-btn"
                disabled={!snapshot || busy}
                onClick={() => void runTopologyOp(() => window.demo.reset())}
              >
                ↺ 重溯
              </button>
            </div>

            {/* 主题切换 */}
            <div className="theme-switch" role="group" aria-label="主题">
              {THEMES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={theme === entry.value}
                  onClick={() => setTheme(entry.value)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {/* 窗口三键（Windows/Linux 下由达芬奇顶栏接管） */}
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

          {/* 工作区主内容区：由 Workbench 二叉树 Dock 系统完全接管 */}
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

          {/* 极客底栏：因果状态与焦点神格 */}
          <footer className="app-footer">
            <span>
              <i className={`connection-dot${connected ? '' : ' is-offline'}`} />
              {connected ? 'RuleSpace 状态已连接' : 'State 未连接'}
            </span>
            <span className="footer-meta-tag">
              Rev: <code>{snapshot?.revision ?? 0}</code>
            </span>
            <span className="footer-meta-tag">
              焦点神格: <code>{selectedCharMeta.name}</code>
            </span>
            <span className="footer-meta-tag" style={{ marginLeft: '12px' }}>
              快捷键: <code>Ctrl+Space</code> 最大化当前面板
            </span>
            <span className="footer-spacer" />
            <span>GraphFramework · DaVinci & Blender Dock Suite</span>
          </footer>
        </div>
      </WorkbenchHostContext.Provider>
    </DemoContext.Provider>
  )
}
