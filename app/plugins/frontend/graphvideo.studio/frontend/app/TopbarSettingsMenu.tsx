import {
  Palette, Redo2, RefreshCcw, RefreshCw, Save, Settings2, Type, Undo2, X,
} from 'lucide-react'
import {
  useEffect, useRef, useState, type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { InlineSelect } from '@graphvideo/workbench'
import {
  interfaceFontOptions, interfaceFontSizeOptions,
  type InterfaceFont, type InterfaceFontSize, type TypographyPreferences,
} from './typographyPreferences'

export type ThemeName = 'dark' | 'light' | 'xueqing' | 'shiliuqun'

interface TopbarSettingsMenuProps {
  canRedo: boolean
  canSaveLayout: boolean
  canUndo: boolean
  isMac: boolean
  layoutSaved: boolean
  redoLabel?: string | null
  refreshing: boolean
  theme: ThemeName
  typography: TypographyPreferences
  undoLabel?: string | null
  onRedo(): void | Promise<void>
  onRefreshComponents(): void | Promise<void>
  onReloadApplication(): void
  onSaveDefaultLayout(): void | Promise<void>
  onThemeChange(theme: ThemeName): void
  onTypographyChange(preferences: TypographyPreferences): void
  onUndo(): void | Promise<void>
}

export function TopbarSettingsMenu({
  canRedo,
  canSaveLayout,
  canUndo,
  isMac,
  layoutSaved,
  redoLabel,
  refreshing,
  theme,
  typography,
  undoLabel,
  onRedo,
  onRefreshComponents,
  onReloadApplication,
  onSaveDefaultLayout,
  onThemeChange,
  onTypographyChange,
  onUndo,
}: TopbarSettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [menuDocument, setMenuDocument] = useState<Document>(document)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const trigger = triggerRef.current
    if (!trigger) return undefined
    const triggerElement = trigger
    const ownerDocument = trigger.ownerDocument
    const ownerWindow = ownerDocument.defaultView ?? window

    function placePanel() {
      const rect = triggerElement.getBoundingClientRect()
      const width = Math.min(320, ownerWindow.innerWidth - 16)
      setPanelStyle({
        top: rect.bottom + 5,
        left: Math.max(8, Math.min(rect.right - width, ownerWindow.innerWidth - width - 8)),
        width,
      })
    }

    setMenuDocument(ownerDocument)
    placePanel()
    ownerWindow.addEventListener('resize', placePanel)
    panelRef.current?.focus()
    return () => ownerWindow.removeEventListener('resize', placePanel)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    menuDocument.addEventListener('keydown', closeOnEscape)
    return () => menuDocument.removeEventListener('keydown', closeOnEscape)
  }, [menuDocument, open])

  function runAndClose(action: () => void | Promise<void>) {
    setOpen(false)
    void action()
  }

  return (
    <div className="topbar-settings">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="打开应用设置"
        className={`topbar-settings-trigger ${open ? 'is-open' : ''}`}
        ref={triggerRef}
        type="button"
        title="应用设置"
        onClick={() => setOpen((current) => !current)}
      >
        <Settings2 size={14} aria-hidden="true" />
        <span>设置</span>
      </button>
      {open && createPortal(
        <div
          className="topbar-settings-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            aria-label="应用设置"
            aria-modal="true"
            className="topbar-settings-panel"
            ref={panelRef}
            role="dialog"
            style={panelStyle}
            tabIndex={-1}
          >
            <header>
              <div>
                <Settings2 size={15} aria-hidden="true" />
                <strong>应用设置</strong>
              </div>
              <button aria-label="关闭设置" type="button" onClick={() => setOpen(false)}>
                <X size={14} aria-hidden="true" />
              </button>
            </header>

            <section aria-labelledby="settings-history-title">
              <h2 id="settings-history-title">历史与布局</h2>
              <div className="topbar-settings-actions">
                <button
                  disabled={!canUndo}
                  title={undoLabel ? `撤回：${undoLabel} (${isMac ? '⌘Z' : 'Ctrl+Z'})` : '没有可撤回的操作'}
                  type="button"
                  onClick={() => runAndClose(onUndo)}
                ><Undo2 size={14} aria-hidden="true" /><span>撤回</span></button>
                <button
                  disabled={!canRedo}
                  title={redoLabel ? `重做：${redoLabel} (${isMac ? '⌘⇧Z' : 'Ctrl+Shift+Z'})` : '没有可重做的操作'}
                  type="button"
                  onClick={() => runAndClose(onRedo)}
                ><Redo2 size={14} aria-hidden="true" /><span>重做</span></button>
                <button
                  className="is-wide"
                  disabled={!canSaveLayout}
                  type="button"
                  onClick={() => runAndClose(onSaveDefaultLayout)}
                ><Save size={14} aria-hidden="true" /><span>{layoutSaved ? '布局已保存' : '保存默认布局'}</span></button>
              </div>
            </section>

            <section aria-labelledby="settings-appearance-title">
              <h2 id="settings-appearance-title">外观</h2>
              <label className="topbar-settings-field">
                <span><Palette size={14} aria-hidden="true" />主题</span>
                <InlineSelect
                  align="end"
                  ariaLabel="界面主题"
                  className="topbar-settings-select"
                  menuClassName="topbar-settings-inline-menu"
                  options={[
                    { value: 'dark', label: '深色' },
                    { value: 'light', label: '浅色' },
                    { value: 'xueqing', label: '雪青·紫罗兰' },
                    { value: 'shiliuqun', label: '明月·石榴裙' },
                  ]}
                  value={theme}
                  onChange={(value) => onThemeChange(value as ThemeName)}
                />
              </label>
              <label className="topbar-settings-field">
                <span><Type size={14} aria-hidden="true" />界面字体</span>
                <InlineSelect
                  align="end"
                  ariaLabel="界面字体"
                  className="topbar-settings-select"
                  menuClassName="topbar-settings-inline-menu"
                  options={interfaceFontOptions}
                  value={typography.font}
                  onChange={(value) => onTypographyChange({
                    ...typography,
                    font: value as InterfaceFont,
                  })}
                />
              </label>
              <label className="topbar-settings-field">
                <span><Type size={14} aria-hidden="true" />界面字号</span>
                <InlineSelect
                  align="end"
                  ariaLabel="界面字号"
                  className="topbar-settings-select"
                  menuClassName="topbar-settings-inline-menu"
                  options={interfaceFontSizeOptions}
                  value={typography.size}
                  onChange={(value) => onTypographyChange({
                    ...typography,
                    size: value as InterfaceFontSize,
                  })}
                />
              </label>
            </section>

            <section aria-labelledby="settings-maintenance-title">
              <h2 id="settings-maintenance-title">维护</h2>
              <div className="topbar-settings-actions">
                <button
                  disabled={refreshing}
                  type="button"
                  onClick={() => runAndClose(onRefreshComponents)}
                >
                  <RefreshCw className={refreshing ? 'is-spinning' : ''} size={14} aria-hidden="true" />
                  <span>{refreshing ? '刷新中…' : '刷新组件'}</span>
                </button>
                <button type="button" onClick={() => runAndClose(onReloadApplication)}>
                  <RefreshCcw size={14} aria-hidden="true" /><span>全局刷新</span>
                </button>
              </div>
            </section>
          </div>
        </div>,
        menuDocument.body,
      )}
    </div>
  )
}
