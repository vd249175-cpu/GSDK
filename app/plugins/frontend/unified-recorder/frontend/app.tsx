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
  narrationStartedAt: string | null
  subtitles: Array<{ id: string; sessionId: string; startMs: number; endMs: number; text: string }>
  audioClips: Array<{ sessionId: string; audioFile: string; startMs: number; durationMs: number }>
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
  saveAudio: (payload: { sessionId: string; bytes: Uint8Array; mimeType: string; startedAt: string; durationMs: number; timeoutMs: number }) => Promise<{ ok: boolean; transcriptionError?: string | null }>
  correctSubtitle: (id: string, text: string) => Promise<{ ok: boolean }>
  readAudio: (sessionId: string) => Promise<string>
  openNarration: () => Promise<{ ok: boolean; error?: string }>
  pauseNotice: () => Promise<void>
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
  narrationStartedAt: null,
  subtitles: [],
  audioClips: [],
  browserAlive: false,
  revision: 0,
}

const normalizeRecorderState = (next: Partial<RecorderState>): RecorderState => ({
  ...emptyState,
  ...next,
  sources: Array.isArray(next.sources) ? next.sources : emptyState.sources,
  events: Array.isArray(next.events) ? next.events : [],
  applications: Array.isArray(next.applications) ? next.applications : [],
  progressLog: Array.isArray(next.progressLog) ? next.progressLog : [],
  subtitles: Array.isArray(next.subtitles) ? next.subtitles : [],
  audioClips: Array.isArray(next.audioClips) ? next.audioClips : [],
})

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const readSeconds = (key: string, fallback: number, min: number, max: number) => {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback
  } catch { return fallback }
}
const readPreference = (key: string) => {
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}

const PAGE_TABS = [
  { key: 'controls', label: '控制中枢', icon: '⬡', badge: 'REC' },
  { key: 'screenshots', label: '截图证据', icon: '🖼', badge: 'IMG' },
  { key: 'narration', label: '声音字幕', icon: '♫', badge: 'SRT' },
] as const

export function App() {
  const [workbenchAdapter] = useState(() => createRecorderWorkbenchAdapter(RECORDER_PANEL_DEFINITIONS))
  const [state, setState] = useState<RecorderState>(emptyState)
  const [busy, setBusy] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  const [copied, setCopied] = useState<'path' | 'script' | 'transcript' | null>(null)
  const [activeSources, setActiveSources] = useState<Array<'desktop' | 'browser'>>(['desktop', 'browser'])
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [microphones, setMicrophones] = useState<Array<{ id: string; label: string }>>([])
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState(() => readPreference('recorder.microphoneId'))
  const [micTesting, setMicTesting] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [micPreviewUrl, setMicPreviewUrl] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const micTestStopRef = useRef<(() => void) | null>(null)
  const micTestStartingRef = useRef(false)
  const [recordIntervalSec, setRecordIntervalSec] = useState(() => readSeconds('recorder.intervalSec', 60, 10, 3600))
  const [saveTimeoutSec, setSaveTimeoutSec] = useState(() => readSeconds('recorder.saveTimeoutSec', 120, 5, 600))
  const [saveNotice, setSaveNotice] = useState<{ title: string; detail: string } | null>(null)
  const mediaRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; sessionId: string; startedAt: string } | null>(null)
  const rotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const operationRef = useRef(false)
  const finishRef = useRef<(automatic: boolean) => Promise<void>>(async () => {})
  const startRef = useRef<() => Promise<void>>(async () => {})
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

  useEffect(() => {
    try {
      window.localStorage.setItem('recorder.intervalSec', String(recordIntervalSec))
      window.localStorage.setItem('recorder.saveTimeoutSec', String(saveTimeoutSec))
      window.localStorage.setItem('recorder.microphoneId', selectedMicrophoneId)
    } catch {}
  }, [recordIntervalSec, saveTimeoutSec, selectedMicrophoneId])

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicError('当前环境无法列出麦克风设备')
      return
    }
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')
      setMicrophones(inputs.map((device, index) => ({ id: device.deviceId, label: device.label || `麦克风 ${index + 1}（授权后显示名称）` })))
      setSelectedMicrophoneId((current) => current && !inputs.some((device) => device.deviceId === current) ? '' : current)
    } catch (error) {
      setMicError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refreshMicrophones()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicrophones)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMicrophones)
  }, [refreshMicrophones])

  useEffect(() => () => { if (micPreviewUrl) URL.revokeObjectURL(micPreviewUrl) }, [micPreviewUrl])

  const handleTestMicrophone = useCallback(async () => {
    if (micTestStopRef.current) { micTestStopRef.current(); return }
    if (micTestStartingRef.current || operationRef.current || state.status === 'recording' || state.status === 'starting') return
    micTestStartingRef.current = true
    setMicTesting(true)
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let meterTimer: ReturnType<typeof setInterval> | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null
    try {
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw new Error('当前环境不支持 WebM/Opus 试录')
      stream = await navigator.mediaDevices.getUserMedia({ audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true })
      void refreshMicrophones()
      context = new AudioContext()
      const analyser = context.createAnalyser()
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      meterTimer = setInterval(() => {
        analyser.getByteTimeDomainData(samples)
        let power = 0
        for (const sample of samples) power += ((sample - 128) / 128) ** 2
        setMicLevel(Math.min(100, Math.round(Math.sqrt(power / samples.length) * 280)))
      }, 100)
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      const capturedStream = stream
      const capturedContext = context
      const cleanup = () => {
        if (meterTimer) clearInterval(meterTimer)
        if (stopTimer) clearTimeout(stopTimer)
        capturedStream.getTracks().forEach((track) => track.stop())
        void capturedContext.close()
        micTestStopRef.current = null
        setMicTesting(false)
        setMicLevel(0)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType })
        if (blob.size) setMicPreviewUrl(URL.createObjectURL(blob))
        cleanup()
      }
      recorder.onerror = () => { setMicError('麦克风试录中断'); cleanup() }
      micTestStopRef.current = () => { if (recorder.state === 'recording') recorder.stop() }
      micTestStartingRef.current = false
      setMicError(null)
      setMicPreviewUrl(null)
      recorder.start(250)
      stopTimer = setTimeout(() => micTestStopRef.current?.(), 5000)
    } catch (error) {
      if (meterTimer) clearInterval(meterTimer)
      if (stopTimer) clearTimeout(stopTimer)
      stream?.getTracks().forEach((track) => track.stop())
      if (context) void context.close()
      micTestStopRef.current = null
      micTestStartingRef.current = false
      setMicTesting(false)
      setMicLevel(0)
      setMicError(error instanceof Error ? error.message : String(error))
    }
  }, [refreshMicrophones, selectedMicrophoneId, state.status])

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
      setState(normalizeRecorderState(next))
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

  const waitForIdle = useCallback(async (bridge: UnifiedRecorderBridge, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const next = await bridge.readState()
      setState(normalizeRecorderState(next))
      if (next.status === 'idle') return
      if (next.status === 'error') throw new Error(next.lastError ?? '录制保存失败')
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    throw new Error('保存等待已超过设定时间')
  }, [])

  const handleStart = useCallback(async () => {
    const bridge = getBridge()
    if (!bridge || operationRef.current || micTestStopRef.current) return
    operationRef.current = true
    setBusy(true)
    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    try {
      const chunks: Blob[] = []
      if (audioEnabled) {
        if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw new Error('当前环境不支持 WebM/Opus 声音录制')
        stream = await navigator.mediaDevices.getUserMedia({ audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true })
        void refreshMicrophones()
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      }
      const next = await bridge.start(undefined, activeSources)
      setState(normalizeRecorderState(next))
      if (!next.sessionId || next.status !== 'recording') throw new Error(next.lastError ?? '录制启动失败')
      if (recorder && stream) {
        recorder.start(1000)
        mediaRef.current = { recorder, stream, chunks, sessionId: next.sessionId, startedAt: new Date().toISOString() }
      }
      setSaveNotice(null)
      rotationTimerRef.current = setTimeout(() => { void finishRef.current(true) }, Math.max(10, recordIntervalSec) * 1000)
    } catch (err: unknown) {
      if (recorder?.state === 'recording') recorder.stop()
      if (stream) stream.getTracks().forEach((track) => track.stop())
      const message = err instanceof Error ? err.message : String(err)
      setSaveNotice({ title: '录制未能启动', detail: message })
    } finally {
      operationRef.current = false
      setBusy(false)
    }
  }, [activeSources, audioEnabled, recordIntervalSec, refreshMicrophones, selectedMicrophoneId])
  startRef.current = handleStart

  const finishSegment = useCallback(async (automatic: boolean) => {
    const bridge = getBridge()
    if (!bridge || operationRef.current) return
    operationRef.current = true
    if (rotationTimerRef.current) clearTimeout(rotationTimerRef.current)
    rotationTimerRef.current = null
    setBusy(true)
    setSaveNotice({ title: automatic ? '已到录制间隔，请暂停操作' : '正在保存录制', detail: '请等待操作记录与声音保存完成…' })
    const deadline = Date.now() + saveTimeoutSec * 1000
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    try {
      if (automatic) await bridge.pauseNotice()
      const media = mediaRef.current
      mediaRef.current = null
      let audioTask: Promise<unknown> | null = null
      if (media) {
        const blobTask = new Promise<Blob>((resolve, reject) => {
          if (media.recorder.state === 'inactive') {
            resolve(new Blob(media.chunks, { type: media.recorder.mimeType }))
            return
          }
          media.recorder.onstop = () => resolve(new Blob(media.chunks, { type: media.recorder.mimeType }))
          media.recorder.onerror = () => reject(new Error('声音录制器停止失败'))
          media.recorder.stop()
        })
        media.stream.getTracks().forEach((track) => track.stop())
        audioTask = blobTask.then(async (blob) => {
          const audio = { sessionId: media.sessionId, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: media.recorder.mimeType, startedAt: media.startedAt, durationMs: Date.now() - Date.parse(media.startedAt), timeoutMs: Math.max(1000, deadline - Date.now()) }
          const result = await bridge.saveAudio(audio)
          if (result.transcriptionError) throw new Error(result.transcriptionError)
        })
      }
      const stopTask = bridge.stop().then(() => waitForIdle(bridge, Math.max(1, deadline - Date.now())))
      const tasks: Promise<unknown>[] = [stopTask]
      if (audioTask) tasks.push(audioTask)
      await Promise.race([
        Promise.all(tasks),
        new Promise((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error('保存等待已超过设定时间，已停止自动续录')), Math.max(1, deadline - Date.now())) }),
      ])
      await refreshState()
      if (automatic) {
        setSaveNotice({ title: '保存完成，正在开始下一段', detail: '请继续暂停操作，等待录制状态恢复…' })
        setTimeout(() => { void startRef.current() }, 100)
      } else setSaveNotice(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setSaveNotice({ title: '保存或转写未完成，自动续录已停止', detail: message })
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      operationRef.current = false
      setBusy(false)
    }
  }, [refreshState, saveTimeoutSec, waitForIdle])
  finishRef.current = finishSegment
  const handleStop = useCallback(async () => finishSegment(false), [finishSegment])

  const handleCorrectSubtitle = useCallback(async (id: string, value: string) => {
    const bridge = getBridge()
    if (!bridge) return
    await bridge.correctSubtitle(id, value)
    await refreshState()
  }, [refreshState])

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
      audioEnabled,
      setAudioEnabled,
      microphones,
      selectedMicrophoneId,
      setSelectedMicrophoneId,
      micTesting,
      micLevel,
      micPreviewUrl,
      micError,
      handleTestMicrophone,
      refreshMicrophones,
      recordIntervalSec,
      setRecordIntervalSec,
      saveTimeoutSec,
      setSaveTimeoutSec,
      handleCorrectSubtitle,
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
      audioEnabled,
      microphones,
      selectedMicrophoneId,
      micTesting,
      micLevel,
      micPreviewUrl,
      micError,
      handleTestMicrophone,
      refreshMicrophones,
      recordIntervalSec,
      saveTimeoutSec,
      copied,
      handleStart,
      handleStop,
      handleLaunchBrowser,
      handleOpenArtifact,
      handleOpenPath,
      handleCopy,
      handleCorrectSubtitle,
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
            <span>控制中枢 · 截图证据 · 声音字幕</span>
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
          {saveNotice && (
            <div className="recording-pause-backdrop" role="alertdialog" aria-modal="true" aria-label={saveNotice.title}>
              <div className="recording-pause-dialog">
                <h2>{saveNotice.title}</h2>
                <p>{saveNotice.detail}</p>
                <p>请暂停演示操作，等待当前片段结算。</p>
                {!busy && <button type="button" className="action-btn" onClick={() => setSaveNotice(null)}>关闭提示</button>}
              </div>
            </div>
          )}
        </div>
      </WorkbenchHostContext.Provider>
    </RecorderContext.Provider>
  )
}
