import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

const PAGE_TABS = [
  { key: 'editing', label: '工台分屏', icon: '◫', badge: 'Blender' },
  { key: 'astrolabe', label: '因果拓扑', icon: '☍' },
  { key: 'prophecy', label: '因果流变', icon: '☵' },
  { key: 'pantheon', label: '节点矩阵', icon: '▦' },
  { key: 'chronicle', label: '全域编年', icon: '☰' },
  { key: 'sandbox', label: '内核基石', icon: '⚡', badge: 'DTO' },
]

export function App() {
  const [workbenchAdapter] = useState(() => createDemoWorkbenchAdapter(DEMO_PANEL_DEFINITIONS))
  const [selectedCharId, setSelectedCharId] = useState<string>('demo.orders')
  const [viewingAct, setViewingAct] = useState<number>(0)
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => readThemePreference('dark'))
  const [typography, setTypography] = useState(() => readTypographyPreferences())
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const busyRef = useRef(false)

  // 监听当前激活的工作区 ID
  const activeWorkspaceId = workbenchAdapter.useWorkspaceState((state) => state.activeWorkspaceId)

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
          {/* 顶栏：无缝暗黑无边框（拖拽区 + 快捷控制 + 设置 + 窗口控制） */}
          <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
            <div className="brand-cluster">
              <span className="brand-glyph">⬡</span>
              <span className="app-title">GraphFramework · 达芬奇工作台</span>
              <IndustrialChip
                label={`PHASE ${snapshot?.phase ?? 0} / 5`}
                tone="accent"
                monospace
              />
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
                {busy && !playing ? '运转中…' : '⚡ 推进因果'}
              </button>
              <button
                type="button"
                className="action-btn"
                disabled={!snapshot || busy}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? '⏸ 暂停演进' : '▶ 连续演进'}
              </button>
              <button
                type="button"
                className="action-btn"
                disabled={!snapshot || busy}
                onClick={() => void runTopologyOp(() => window.demo.reset())}
              >
                ↺ 重溯
              </button>

              {/* 工业设置入口按钮 */}
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
    </DemoContext.Provider>
  )
}
