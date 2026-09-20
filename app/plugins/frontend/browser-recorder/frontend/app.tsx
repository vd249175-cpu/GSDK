import { useState, useEffect, useCallback } from 'react'
import {
  Play,
  Square,
  Copy,
  Check,
  Globe,
  Radio,
  Terminal,
  Clock,
  Layers,
  Activity,
} from 'lucide-react'
import './app.css'

declare global {
  interface Window {
    recorder?: {
      readState: () => Promise<{
        status: 'idle' | 'recording'
        sessionId: string | null
        handle: string | null
        lastActions: string | null
        eventCount: number
        lastEvent: any
        lastError: string | null
        revision: number
      }>
      start: (sessionId?: string) => Promise<any>
      stop: () => Promise<any>
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

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

export function App() {
  const [status, setStatus] = useState<'idle' | 'recording'>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [handle, setHandle] = useState<string | null>(null)
  const [lastActions, setLastActions] = useState<string | null>(null)
  const [eventCount, setEventCount] = useState<number>(0)
  const [lastEvent, setLastEvent] = useState<any>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.recorder) return
    try {
      const state = await window.recorder.readState()
      setStatus(state.status ?? 'idle')
      setSessionId(state.sessionId ?? null)
      setHandle(state.handle ?? null)
      setLastActions(state.lastActions ?? null)
      setEventCount(state.eventCount ?? 0)
      setLastEvent(state.lastEvent ?? null)
      setLastError(state.lastError ?? null)
    } catch {
      // 容错处理
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 400)
    return () => clearInterval(timer)
  }, [refresh])

  const handleStart = async () => {
    if (!window.recorder || busy) return
    setBusy(true)
    setLastActions(null)
    setEventCount(0)
    try {
      const sId = `session-${Date.now().toString(36)}`
      await window.recorder.start(sId)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async () => {
    if (!window.recorder || busy) return
    setBusy(true)
    try {
      await window.recorder.stop()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleLaunchBrowser = async () => {
    if (!window.recorder || browserBusy) return
    setBrowserBusy(true)
    try {
      await window.recorder.launchBrowser()
    } finally {
      setBrowserBusy(false)
    }
  }

  const handleCopy = async () => {
    if (!lastActions || !window.recorder) return
    await window.recorder.copyToClipboard(lastActions)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isRecording = status === 'recording'

  return (
    <div className="recorder-shell">
      {/* 顶栏 */}
      <header className="recorder-topbar">
        <div className="brand-cluster">
          <span className="brand-glyph">⬡</span>
          <span className="app-title">GraphFramework · 浏览器原生录制</span>
          <div className={`status-badge${isRecording ? ' is-recording' : ''}`}>
            <span className="status-dot" />
            <span>{isRecording ? '录制中 (REC)' : '就绪 (IDLE)'}</span>
          </div>
        </div>

        <span className="topbar-spacer" />

        {/* 控制按钮群 */}
        <div className="topbar-actions">
          <button
            type="button"
            className="action-btn"
            disabled={browserBusy}
            onClick={handleLaunchBrowser}
            title="拉起或探活 9343 专用 Chrome"
          >
            <Globe size={13} />
            <span>{browserBusy ? '启动中…' : '打开专用浏览器'}</span>
          </button>

          {!isRecording ? (
            <button
              type="button"
              className="action-btn is-primary"
              disabled={busy}
              onClick={handleStart}
              title="向微内核下发 StartRecordingInfo 开始录制"
            >
              <Play size={13} />
              <span>{busy ? '启动中…' : '开始录制'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="action-btn is-danger"
              disabled={busy}
              onClick={handleStop}
              title="向微内核下发 StopRecordingInfo 停止录制并生成代码"
            >
              <Square size={13} />
              <span>{busy ? '正在结算…' : '停止录制'}</span>
            </button>
          )}

          {lastActions && (
            <button
              type="button"
              className="action-btn"
              onClick={handleCopy}
              title="复制录制生成的 Playwright 代码"
            >
              {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
              <span>{copied ? '已复制' : '复制代码'}</span>
            </button>
          )}
        </div>

        {/* 窗口控制三键 */}
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

      {/* 主界面 */}
      <main className="recorder-main">
        {/* 指标卡片 */}
        <div className="metrics-row">
          <div className="metric-card">
            <span className="metric-label">当前状态</span>
            <span className={`metric-value${isRecording ? ' is-accent' : ''}`}>
              {isRecording ? 'RECORDING' : 'IDLE'}
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">会话标识 (Session ID)</span>
            <span className="metric-value" title={sessionId ?? '-'}>
              {sessionId ?? '-'}
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">捕获事件数 (Events)</span>
            <span className="metric-value is-accent">
              {eventCount}
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">运行句柄 (Handle)</span>
            <span className="metric-value" title={handle ?? '-'}>
              {handle ?? '-'}
            </span>
          </div>
        </div>

        {/* 代码展示区 */}
        <div className="code-panel">
          <div className="code-panel-header">
            <div className="code-panel-title">
              <Terminal size={14} />
              <span>Playwright 原生录制产物 (Playwright Locator Script)</span>
            </div>
            {lastActions && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                代码长度: {lastActions.length} 字符
              </span>
            )}
          </div>

          <div className="code-panel-content">
            {lastActions ? (
              <pre>{lastActions}</pre>
            ) : (
              <div className="empty-state">
                <Radio className="empty-icon" />
                <div className="empty-text">
                  {isRecording ? (
                    <span>
                      正在录制中… 请在已打开的专用浏览器中执行点击、输入或跳转动作。
                      <br />
                      Playwright 原生动作代码将在此处实时流式显示。
                    </span>
                  ) : (
                    <span>
                      尚未开始录制。点击顶栏 <strong>“打开专用浏览器”</strong> 准备环境，再点击 <strong>“开始录制”</strong> 启动捕获。
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 底栏 */}
      <footer className="recorder-footer">
        <div className="footer-item">
          <Activity size={12} color={isRecording ? '#ef4444' : '#10b981'} />
          <span>微内核投影链路正常</span>
        </div>

        <div className="footer-item">
          <Layers size={12} />
          <span>端口: 9343 (专用 Chrome)</span>
        </div>

        {lastError && (
          <div className="footer-item" style={{ color: '#f87171' }}>
            <span>错误: {lastError}</span>
          </div>
        )}

        <span className="footer-spacer" />

        <div className="footer-item">
          <Clock size={12} />
          <span>Playwright Native Recorder</span>
        </div>
      </footer>
    </div>
  )
}
