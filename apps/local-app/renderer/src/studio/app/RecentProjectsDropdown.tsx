import { ChevronDown, Clock, Folder, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { RecentLocalProject } from '@graphvideo/client-sdk'

interface RecentProjectsDropdownProps {
  disabled?: boolean
  projects: RecentLocalProject[]
  currentProjectPath?: string
  onOpen(path: string): void
  onRemove(path: string): void | Promise<void>
}

export function RecentProjectsDropdown({
  disabled = false,
  projects,
  currentProjectPath,
  onOpen,
  onRemove,
}: RecentProjectsDropdownProps) {
  const [open, setOpen] = useState(false)
  const [menuDocument, setMenuDocument] = useState<Document>(document)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    menuDocument.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => menuDocument.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open, menuDocument])

  function toggleMenu() {
    if (disabled || projects.length === 0) return
    const trigger = triggerRef.current
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      const ownerDocument = trigger.ownerDocument
      setMenuDocument(ownerDocument)
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: 320,
      })
    }
    setOpen((current) => !current)
  }

  const hasProjects = projects.length > 0

  return (
    <div className="recent-projects-dropdown" ref={rootRef}>
      <button
        type="button"
        className={`topbar-btn recent-projects-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled || !hasProjects}
        ref={triggerRef}
        onClick={toggleMenu}
        title={hasProjects ? '查看最近打开的项目' : '暂无最近打开的项目'}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Clock size={13} />
        <span>{hasProjects ? '最近项目' : '无最近项目'}</span>
        <ChevronDown size={11} className={`trigger-chevron ${open ? 'is-open' : ''}`} />
      </button>

      {open && createPortal(
        <div
          className="recent-projects-menu"
          ref={menuRef}
          role="menu"
          style={menuPosition}
        >
          <div className="recent-projects-header">
            <span className="recent-header-title">最近项目</span>
            <span className="recent-header-count">{projects.length} 个</span>
          </div>

          <div className="recent-projects-list">
            {projects.map((project) => {
              const isCurrent = project.path === currentProjectPath
              return (
                <div
                  key={project.path}
                  className={`recent-project-item ${isCurrent ? 'is-current' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    onOpen(project.path)
                    setOpen(false)
                  }}
                  title={`打开：${project.path}`}
                >
                  <Folder size={15} className="recent-item-icon" />
                  <div className="recent-item-meta">
                    <div className="recent-item-name-row">
                      <strong className="recent-item-name">{project.name}</strong>
                      {isCurrent && <span className="recent-current-badge">当前打开</span>}
                    </div>
                    <span className="recent-item-path" title={project.path}>
                      {project.path}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="recent-item-remove-btn"
                    title="从列表中移除追踪（不删除本地文件）"
                    aria-label={`移除 ${project.name} 记录`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onRemove(project.path)
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="recent-projects-footer">
            <span>移除仅清除追踪记录，不会删除磁盘文件</span>
          </div>
        </div>,
        menuDocument.body,
      )}
    </div>
  )
}
