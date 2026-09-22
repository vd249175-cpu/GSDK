import { createContext, useContext, useEffect, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  MonitorDot,
  Play,
  Sliders,
  Square,
  X,
} from 'lucide-react'
import type { PanelDefinition, PanelProps } from '@graphframework/workbench'
import { IndustrialChip, EmptyState } from '@graphframework/ui'
import type { RecorderState, UnifiedEvent } from './app'

/* ==========================================================================
   Recorder 状态与操作全局上下文
   ========================================================================== */
export interface RecorderContextValue {
  state: RecorderState
  busy: boolean
  browserBusy: boolean
  activeSources: Array<'desktop' | 'browser'>
  setActiveSources: (sources: Array<'desktop' | 'browser'>) => void
  copied: 'path' | 'script' | 'transcript' | null
  handleStart: () => Promise<void>
  handleStop: () => Promise<void>
  handleLaunchBrowser: () => Promise<void>
  handleOpenArtifact: () => Promise<void>
  handleOpenPath: (targetPath: string) => Promise<void>
  handleCopy: (type: 'path' | 'script' | 'transcript', text: string) => Promise<void>
}

export const RecorderContext = createContext<RecorderContextValue | null>(null)

export const useRecorder = () => {
  const ctx = useContext(RecorderContext)
  if (!ctx) throw new Error('useRecorder 必须在 RecorderContext.Provider 内使用')
  return ctx
}

const statusTone: Record<string, 'accent' | 'success' | 'warning' | 'danger' | 'muted'> = {
  idle: 'muted',
  starting: 'warning',
  recording: 'accent',
  stopping: 'warning',
  processing: 'warning',
  error: 'danger',
}

const statusLabelZh: Record<string, string> = {
  idle: '就绪 · 待命',
  starting: '启动中…',
  recording: '双源录制中 (REC)',
  stopping: '停止中…',
  processing: '数据清洗与提取',
  error: '运行异常',
}

/* ==========================================================================
   1. 控制中枢面板 (recorder.controls)
   ========================================================================== */
export function ControlsPanel(_props: PanelProps) {
  const {
    state,
    busy,
    browserBusy,
    activeSources,
    setActiveSources,
    handleStart,
    handleStop,
    handleLaunchBrowser,
    handleOpenArtifact,
    handleCopy,
    copied,
  } = useRecorder()

  const isRecording = state.status === 'recording' || state.status === 'starting'

  const toggleSource = (source: 'desktop' | 'browser') => {
    if (isRecording) return
    setActiveSources(
      activeSources.includes(source)
        ? activeSources.filter((s) => s !== source)
        : [...activeSources, source],
    )
  }

  return (
    <div className="panel-container controls-panel-content">
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">录制控制核心</span>
          <IndustrialChip
            label={statusLabelZh[state.status] ?? state.status}
            tone={statusTone[state.status] ?? 'muted'}
            monospace
          />
        </div>

        {/* 录制源配置 */}
        <div className="controls-box">
          <div className="box-label">双源捕获配置</div>
          <div className="source-checkbox-group">
            <label className={`source-checkbox-item ${activeSources.includes('desktop') ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={activeSources.includes('desktop')}
                disabled={isRecording}
                onChange={() => toggleSource('desktop')}
              />
              <MonitorDot size={14} />
              <span>Windows 原生键盘鼠标 (桌面底层钩子)</span>
            </label>
            <label className={`source-checkbox-item ${activeSources.includes('browser') ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={activeSources.includes('browser')}
                disabled={isRecording}
                onChange={() => toggleSource('browser')}
              />
              <Globe size={14} />
              <span>专用 Chrome 浏览器 (CDP 9343 Playwright)</span>
            </label>
          </div>
        </div>

        {/* 主动作按钮 */}
        <div className="primary-actions-group">
          {!isRecording ? (
            <button
              type="button"
              className="action-btn is-primary is-hero"
              disabled={busy || activeSources.length === 0}
              onClick={() => void handleStart()}
            >
              <Play size={14} />
              <span>{busy ? '启动微内核…' : '开始统一录制'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="action-btn is-danger is-hero"
              disabled={busy}
              onClick={() => void handleStop()}
            >
              <Square size={14} />
              <span>{busy ? '正在清洗结算…' : '停止并清洗导出'}</span>
            </button>
          )}

          <button
            type="button"
            className={`action-btn is-hero ${state.browserAlive ? 'is-accent' : 'is-secondary'}`}
            disabled={browserBusy}
            onClick={() => void handleLaunchBrowser()}
            title="以 9343 端口与 Profile 1 独立目录启动或连接专用 Chrome"
          >
            <Globe size={13} />
            <span>
              {browserBusy
                ? '正在启动/连接浏览器…'
                : state.browserAlive
                  ? '● 专用浏览器已就绪 (9343 点击置顶)'
                  : '○ 打开专用浏览器 (9343)'}
            </span>
          </button>
        </div>
      </div>

      {/* 会话信息与产物概览 */}
      <div className="panel-section">
        <div className="section-header">
          <span className="section-title">会话指标与产物</span>
          <span className="session-id-tag">ID: {state.sessionId ?? '未启动'}</span>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">事件计数</div>
            <div className="metric-value">{state.eventCount}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">关联应用</div>
            <div className="metric-value">{state.applications.length || 1}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">时序版本 (Rev)</div>
            <div className="metric-value is-mono">{state.revision}</div>
          </div>
        </div>

        {state.artifactPath && (
          <div className="artifact-banner">
            <div className="artifact-info">
              <FolderOpen size={14} className="artifact-icon" />
              <div className="artifact-path is-mono" title={state.artifactPath}>
                {state.artifactPath}
              </div>
            </div>
            <div className="artifact-actions">
              <button
                type="button"
                className="action-btn is-small"
                onClick={() => void handleOpenArtifact()}
              >
                <ExternalLink size={12} />
                <span>打开文件夹</span>
              </button>
              <button
                type="button"
                className="action-btn is-small"
                onClick={() => void handleCopy('path', state.artifactPath ?? '')}
              >
                {copied === 'path' ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied === 'path' ? '已复制' : '复制路径'}</span>
              </button>
            </div>
          </div>
        )}

        {state.lastError && (
          <div className="error-callout">
            <div className="error-title">最后异常告警:</div>
            <div className="error-text is-mono">{state.lastError}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ==========================================================================
   2. 截图与证据面板 (recorder.screenshots)
   ========================================================================== */
function ScreenshotCard({
  event,
  sessionDir,
  onOpenPath,
  onZoom,
}: {
  event: UnifiedEvent
  sessionDir: string | null
  onOpenPath: (path: string) => void
  onZoom: (dataUrl: string, title: string) => void
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let canceled = false
    const load = async () => {
      if (!event.screenshotFile) return
      const fullPath = sessionDir
        ? `${sessionDir.replace(/[/\\]+$/, '')}/${event.screenshotFile.replace(/^[/\\]+/, '')}`
        : event.screenshotFile
      const bridge = (window as unknown as { recorder?: { readImage?: (p: string) => Promise<{ ok: boolean; dataUrl?: string }> } }).recorder
      if (!bridge?.readImage) return
      setLoading(true)
      try {
        const res = await bridge.readImage(fullPath)
        if (!canceled && res.ok && res.dataUrl) {
          setDataUrl(res.dataUrl)
        }
      } catch {}
      if (!canceled) setLoading(false)
    }
    void load()
    return () => { canceled = true }
  }, [event.screenshotFile, sessionDir])

  const fullPath = sessionDir && event.screenshotFile
    ? `${sessionDir.replace(/[/\\]+$/, '')}/${event.screenshotFile.replace(/^[/\\]+/, '')}`
    : (event.screenshotFile ?? '')

  return (
    <div className="screenshot-card">
      <div className="screenshot-header is-mono">
        <span>Step {String(event.index).padStart(2, '0')}</span>
        <span>{event.application ?? event.source}</span>
      </div>
      <div
        className="screenshot-preview-container"
        onClick={() => dataUrl && onZoom(dataUrl, `Step ${String(event.index).padStart(2, '0')} · ${event.action ?? ''}`)}
      >
        {dataUrl ? (
          <img src={dataUrl} alt={event.description ?? 'screenshot'} className="screenshot-img" />
        ) : (
          <div className="screenshot-preview-placeholder">
            <ImageIcon size={24} />
            <span className="file-name is-mono">{loading ? '加载中…' : event.screenshotFile}</span>
          </div>
        )}
        {dataUrl && (
          <div className="screenshot-hover-overlay">
            <span className="overlay-zoom-text">点击放大</span>
          </div>
        )}
      </div>
      <div className="screenshot-footer">
        <div className="screenshot-desc" title={event.description ?? ''}>{event.description}</div>
        <button
          type="button"
          className="action-btn is-micro"
          title="在资源管理器中定位"
          onClick={(e) => {
            e.stopPropagation()
            onOpenPath(fullPath)
          }}
        >
          <FolderOpen size={10} />
          <span>定位</span>
        </button>
      </div>
    </div>
  )
}

export function ScreenshotsPanel(_props: PanelProps) {
  const { state, handleOpenPath } = useRecorder()
  const [zoomImage, setZoomImage] = useState<{ url: string; title: string } | null>(null)

  const screenshotEvents = state.events.filter((e) => Boolean(e.screenshotFile))

  return (
    <div className="panel-container screenshots-panel-content">
      <div className="panel-filter-bar">
        <div className="panel-bar-title">
          <ImageIcon size={14} />
          <span>截图索引与关键帧证据 ({screenshotEvents.length})</span>
        </div>
        {state.screenshotsDirectory && (
          <button
            type="button"
            className="action-btn is-small"
            onClick={() => void handleOpenPath(state.screenshotsDirectory ?? '')}
          >
            <FolderOpen size={12} />
            <span>打开截图目录</span>
          </button>
        )}
      </div>

      <div className="screenshots-scroll-box">
        {screenshotEvents.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="暂无独立截图"
            description="录制过程中的关键界面变迁或由步骤记录器捕获的截屏将以相对路径归档在 screenshots/ 目录并在此展示。"
          />
        ) : (
          <div className="screenshots-grid">
            {screenshotEvents.map((e) => (
              <ScreenshotCard
                key={e.index}
                event={e}
                sessionDir={state.sessionDir}
                onOpenPath={(targetPath) => void handleOpenPath(targetPath)}
                onZoom={(url, title) => setZoomImage({ url, title })}
              />
            ))}
          </div>
        )}
      </div>

      {zoomImage && (
        <div className="screenshot-modal-backdrop" onClick={() => setZoomImage(null)}>
          <div className="screenshot-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="screenshot-modal-header">
              <span className="is-mono">{zoomImage.title}</span>
              <button type="button" className="action-btn is-micro" onClick={() => setZoomImage(null)}>
                <X size={12} />
              </button>
            </div>
            <div className="screenshot-modal-body">
              <img src={zoomImage.url} alt="zoom preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const RECORDER_PANEL_DEFINITIONS: PanelDefinition[] = [
  {
    id: 'recorder.controls',
    title: '控制中枢',
    icon: Sliders,
    component: ControlsPanel,
  },
  {
    id: 'recorder.screenshots',
    title: '截图证据',
    icon: ImageIcon,
    component: ScreenshotsPanel,
  },
]
