import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

export interface InlineSelectOption {
  value: string
  label: string
}

interface InlineSelectProps {
  align?: 'start' | 'end'
  ariaLabel: string
  className?: string
  disabled?: boolean
  menuClassName?: string
  onChange(value: string): void
  options: InlineSelectOption[]
  value: string
}

export function InlineSelect({ align = 'start', ariaLabel, className = '', disabled = false, menuClassName = '', onChange, options, value }: InlineSelectProps) {
  const [open, setOpen] = useState(false)
  const [menuDocument, setMenuDocument] = useState<Document>(document)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    menuDocument.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => menuDocument.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open, menuDocument])

  if (!selected) return null

  function toggleMenu() {
    const trigger = triggerRef.current
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      const ownerDocument = trigger.ownerDocument
      const ownerWindow = ownerDocument.defaultView ?? window
      setMenuDocument(ownerDocument)
      setMenuPosition(align === 'end'
        ? { top: rect.bottom + 3, right: ownerWindow.innerWidth - rect.right }
        : { top: rect.bottom + 3, left: rect.left, minWidth: rect.width })
    }
    setOpen((current) => !current)
  }

  return (
    <div className={`inline-select ${className}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="inline-select-trigger"
        disabled={disabled}
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
      >
        <span>{selected.label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div aria-label={ariaLabel} className={`inline-select-menu ${menuClassName}`} ref={menuRef} role="listbox" style={menuPosition}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : ''}
              key={option.value}
              role="option"
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >{option.label}</button>
          ))}
        </div>,
        menuDocument.body,
      )}
    </div>
  )
}
