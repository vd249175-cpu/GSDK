import { useCallback, useEffect, useState } from 'react'
import '@graphvideo/workbench/styles.css'
import './app.css'

declare global {
  interface Window {
    graph: {
      incrementCounter: () => Promise<{ count: number }>
      readCounter: () => Promise<{ count: number }>
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
    // 隐私模式等场景直接回退默认主题。
  }
  return 'dark'
}

export function App() {
  const [count, setCount] = useState<number | null>(null)
  const [theme, setTheme] = useState<ThemeValue>(readInitialTheme)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (theme === 'dark') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // 主题写入失败不影响计数主流程。
    }
  }, [theme])

  const refresh = useCallback(async () => {
    const state = await window.graph.readCounter()
    setCount(state.count)
  }, [])

  useEffect(() => {
    refresh().catch(() => setCount(null))
  }, [refresh])

  const increment = useCallback(async () => {
    setPending(true)
    try {
      await window.graph.incrementCounter()
      await refresh()
    } finally {
      setPending(false)
    }
  }, [refresh])

  const connected = typeof count === 'number'
  return (
    <div className="app-shell">
      <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
        <span className="app-title">Hello Counter</span>
        <span className="topbar-spacer" />
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
        {!isMac && window.shell && (
          <div className="window-controls">
            <button type="button" title="最小化" onClick={() => window.shell?.minimize()}>
              —
            </button>
            <button type="button" title="最大化/恢复" onClick={() => window.shell?.toggleMaximize()}>
              ▢
            </button>
            <button type="button" className="window-close" title="关闭" onClick={() => window.shell?.close()}>
              ✕
            </button>
          </div>
        )}
      </header>

      <main className="app-content">
        <section className="counter-card">
          <p className="counter-label">Projection 派生计数</p>
          <p className="count-value" data-testid="count">
            {connected ? count : '–'}
          </p>
          <button type="button" className="primary-button" disabled={!connected || pending} onClick={increment}>
            {pending ? '提交中…' : 'Increment'}
          </button>
          <p className="hint">
            {connected
              ? '写入经插件 rendererRoots 授权，读取走 Projection DTO。'
              : '主进程未连接（浏览器预览模式只看样式）。'}
            <br />
            因果用 <code>npm run diagnose -- change example.counter::IncrementInfo</code> 查看。
          </p>
        </section>
      </main>

      <footer className="app-footer">
        <span>
          <i className={`connection-dot${connected ? '' : ' is-offline'}`} />
          {connected ? 'State 已连接' : 'State 未连接'}
        </span>
        <span className="footer-spacer" />
        <span>local-app-template</span>
      </footer>
    </div>
  )
}
