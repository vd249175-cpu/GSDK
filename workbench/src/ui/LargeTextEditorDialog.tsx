import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface LargeTextEditorDialogProps {
  busy?: boolean
  label?: string
  onChange(value: string): void
  onClose(): void
  onSave?: () => void | Promise<void>
  placeholder?: string
  readOnly?: boolean
  saveDisabled?: boolean
  saveLabel?: string
  title: string
  value: string
}

export function LargeTextEditorDialog({
  busy = false,
  label = '文本内容',
  onChange,
  onClose,
  onSave,
  placeholder,
  readOnly = false,
  saveDisabled = false,
  saveLabel = '保存',
  title,
  value,
}: LargeTextEditorDialogProps) {
  const titleId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(busy)
  const onCloseRef = useRef(onClose)
  const hostDocument = typeof document === 'undefined' ? null : document
  busyRef.current = busy
  onCloseRef.current = onClose

  useEffect(() => {
    if (!hostDocument) return undefined
    const previousFocus = hostDocument.activeElement as HTMLElement | null
    textareaRef.current?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busyRef.current) return
      event.preventDefault()
      onCloseRef.current()
    }
    hostDocument.addEventListener('keydown', closeOnEscape)
    return () => {
      hostDocument.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [hostDocument])

  if (!hostDocument) return null

  const canSave = Boolean(onSave) && !readOnly && !busy && !saveDisabled
  return createPortal(
    <div
      className="large-text-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <form
        className="large-text-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSave) {
            event.preventDefault()
            void onSave?.()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) void onSave?.()
        }}
      >
        <header>
          <strong id={titleId} title={title}>{title}</strong>
          <button type="button" title="关闭" aria-label="关闭" disabled={busy} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <label>
          <span>{label}</span>
          <textarea
            ref={textareaRef}
            spellCheck={false}
            readOnly={readOnly}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <footer>
          {readOnly || !onSave ? (
            <button type="button" onClick={onClose}>关闭</button>
          ) : (
            <>
              <span>Ctrl / ⌘ + Enter 保存</span>
              <button type="button" disabled={busy} onClick={onClose}>取消</button>
              <button className="is-primary" type="submit" disabled={!canSave}>{saveLabel}</button>
            </>
          )}
        </footer>
      </form>
    </div>,
    hostDocument.body,
  )
}
