import {
  Bot, Clapperboard, Film, FolderOpen, Minus, MonitorPlay, Sparkles, Square, X,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent } from 'react'
import type { RecentLocalProject } from '@graphvideo/client-sdk'

const WORKSPACE_ICONS: Record<string, typeof Film> = {
  editing: Film,
  generation: Sparkles,
  review: MonitorPlay,
  agent: Bot,
}
import { desktopElementSource } from './elementSource'
import { FloatingScrollbars, InlineSelect, Workspace } from '@graphvideo/workbench'
import {
  useAppState, useClientState, useProjectSelectionSync, useSelectedNodeId, useServices,
} from './AppContext'
import { isNestedFileDropTarget } from './fileDropTarget'
import {
  applyTypographyPreferences, readTypographyPreferences,
} from './typographyPreferences'
import { TopbarSettingsMenu, type ThemeName } from './TopbarSettingsMenu'
import { ProjectSnapshotsDialog } from './ProjectSnapshotsDialog'

function readInitialTheme(): ThemeName {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return 'dark'
  const saved = localStorage.getItem('graphvideo-theme')
  if (saved === 'light' || saved === 'xueqing' || saved === 'shiliuqun') return saved
  return 'dark'
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, [contenteditable="true"], [role="textbox"]'))
}

export function App() {
  const { applicationClient, commands, elements, history, shell } = useServices()
  useProjectSelectionSync()
  const [openError, setOpenError] = useState<string | null>(null)
  const [openingProject, setOpeningProject] = useState(false)
  const [recentProjects, setRecentProjects] = useState<RecentLocalProject[]>([])
  const [dropActive, setDropActive] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const [layoutSaved, setLayoutSaved] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(readInitialTheme)
  const [typography, setTypography] = useState(readTypographyPreferences)
  const dragDepth = useRef(0)
  useSyncExternalStore(elements.subscribe, elements.getSnapshot)
  const source = useSyncExternalStore(desktopElementSource.subscribe, desktopElementSource.getSnapshot)
  const historyState = useSyncExternalStore(history.subscribe, history.getSnapshot)
  const selectedNodeId = useSelectedNodeId()
  const { activeWorkspaceId, workspaces } = useClientState((state) => ({
    activeWorkspaceId: state.workspace.activeWorkspaceId,
    workspaces: Object.values(state.workspace.items).sort((left, right) => (
      left.order - right.order || left.id.localeCompare(right.id)
    )),
  }))
  const {
    pending, runtimeError, activeBackgroundTasks, taskGraphs,
    projectNodes, projectName, projectPath,
  } = useAppState((state) => ({
    pending: state.runtime.pendingTasks,
    runtimeError: state.runtime.lastError,
    activeBackgroundTasks: state.runtime.activeBackgroundTasks,
    taskGraphs: state.runtime.taskGraphs,
    projectNodes: state.project.nodes,
    projectName: state.project.name,
    projectPath: state.project.localPath,
  }))
  const selectedNode = selectedNodeId ? projectNodes[selectedNodeId] : undefined
  const backgroundProgress = Object.values(taskGraphs)
    .filter((graph) => graph.mode === 'background'
      && (graph.status === 'queued' || graph.status === 'running' || graph.status === 'completing'))
    .reduce((sum, graph) => sum + graph.progress, 0) / Math.max(1, activeBackgroundTasks)
  const elementError = elements.listErrors()[0] ?? source.error

  useEffect(() => {
    document.title = projectPath ? `${projectName} (${projectPath}) — GraphVideo` : 'GraphVideo'
  }, [projectName, projectPath])

  useEffect(() => {
    let active = true
    void applicationClient.project.listRecent()
      .then((projects) => { if (active) setRecentProjects(projects) })
      .catch((error: unknown) => {
        if (active) setOpenError(error instanceof Error ? error.message : '无法读取最近项目')
      })
    return () => { active = false }
  }, [applicationClient, projectPath])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem('graphvideo-theme', theme)
    }
    window.dispatchEvent(new Event('graphvideo-theme-change'))
  }, [theme])

  useEffect(() => {
    applyTypographyPreferences(typography)
  }, [typography])

  useEffect(() => {
    function onHistoryKeyDown(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || isTextEditingTarget(event.target)) return
      const key = event.key.toLowerCase()
      const redo = key === 'y' || (key === 'z' && event.shiftKey)
      const undo = key === 'z' && !event.shiftKey
      if (!undo && !redo) return
      event.preventDefault()
      void (redo ? history.redo() : history.undo())
    }
    window.addEventListener('keydown', onHistoryKeyDown)
    return () => window.removeEventListener('keydown', onHistoryKeyDown)
  }, [history])

  async function saveDefaultLayout() {
    setOpenError(null)
    try {
      await commands.execute('workspace.layout.save-default', activeWorkspaceId)
      setLayoutSaved(true)
      window.setTimeout(() => setLayoutSaved(false), 1800)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : '无法保存默认布局')
    }
  }

  async function openProject(path?: string) {
    setOpeningProject(true)
    setOpenError(null)
    try {
      await applicationClient.project.open(path)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : '无法打开项目')
    } finally {
      try {
        setRecentProjects(await applicationClient.project.listRecent())
      } catch {}
      setOpeningProject(false)
    }
  }

  function carriesFiles(event: ReactDragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function hasNestedFileDropTarget(event: ReactDragEvent<HTMLElement>) {
    return isNestedFileDropTarget(event.target)
  }

  function enterFileDrop(event: ReactDragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return
    if (hasNestedFileDropTarget(event)) {
      dragDepth.current = 0
      setDropActive(false)
      return
    }
    event.preventDefault()
    dragDepth.current += 1
    setDropActive(true)
    setDropError(null)
  }

  function leaveFileDrop(event: ReactDragEvent<HTMLElement>) {
    if (hasNestedFileDropTarget(event)) {
      dragDepth.current = 0
      setDropActive(false)
      return
    }
    if (dragDepth.current === 0) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }

  function allowFileDrop(event: ReactDragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return
    if (hasNestedFileDropTarget(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = selectedNode && !pending ? 'copy' : 'none'
  }

  async function importDroppedFile(event: ReactDragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return
    if (hasNestedFileDropTarget(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDropActive(false)
    const files = Array.from(event.dataTransfer.files)
    if (!selectedNode) {
      setDropError('请先选择要导入文件的节点')
      return
    }
    if (pending) {
      setDropError('当前任务完成后再导入文件')
      return
    }
    if (files.length !== 1) {
      setDropError('每次请拖入一个文件')
      return
    }
    setDropError(null)
    try {
      const [sourceRef] = shell.files.resolveDroppedPaths(files)
      if (!sourceRef) throw new Error('无法解析拖入文件的本地路径')
      await applicationClient.project.importVersion(selectedNode.id, sourceRef)
    } catch (error) {
      setDropError(error instanceof Error ? error.message : '无法导入拖入的文件')
    }
  }

  const isMac = shell.platform === 'darwin'

  return (
    <>
      <FloatingScrollbars />
      <main
        className="app-shell"
        data-platform={shell.platform}
        onDragEnter={enterFileDrop}
        onDragLeave={leaveFileDrop}
        onDragOver={allowFileDrop}
        onDrop={(event) => void importDroppedFile(event)}
      >
      {dropActive && (
        <div className={`file-drop-overlay ${selectedNode && !pending ? '' : 'is-disabled'}`}>
          <FolderOpen size={36} />
          <strong>{selectedNode ? `导入到“${selectedNode.title}”` : '请先选择一个节点'}</strong>
          <span>{selectedNode
            ? `松开即可作为当前${selectedNode.type === 'style' ? '风格文本' : selectedNode.type === 'text' ? '文本' : selectedNode.type === 'image' ? '图片' : selectedNode.type === 'video' ? '视频' : '音频'}版本导入`
            : '文件需要导入到对应的文本、图片、视频或音频节点'}</span>
        </div>
      )}
      <header className={`app-topbar ${isMac ? 'is-mac' : ''}`}>
        <div className="brand-mark"><Clapperboard size={17} /></div>
        <strong className="brand-name">GraphVideo</strong>
        <button
          className="project-open-button"
          type="button"
          disabled={openingProject || pending > 0}
          title={pending > 0 ? '当前任务完成后再打开其他项目' : '打开已有项目，或用空目录创建最小项目'}
          onClick={() => void openProject()}
        >
          <FolderOpen size={14} />
          <span>{openingProject ? '打开中…' : '打开项目'}</span>
        </button>
        <div className="topbar-project-history" title="选择最近打开过的项目">
          <InlineSelect
            ariaLabel="选择最近项目"
            disabled={openingProject || pending > 0 || recentProjects.length === 0}
            className="topbar-project-inline-select"
            menuClassName="topbar-project-menu"
            options={[
              { value: '', label: recentProjects.length ? '最近项目' : '无最近项目' },
              ...recentProjects.map((project) => ({
                value: project.path,
                label: `${project.name} — ${project.path}${project.path === projectPath ? '（当前）' : ''}`,
              })),
            ]}
            value=""
            onChange={(value) => { if (value) void openProject(value) }}
          />
        </div>
        {projectPath && (
          <div className="topbar-project-info" title={`${projectName}\n路径: ${projectPath}`}>
            <span className="topbar-project-name">{projectName}</span>
            <span className="topbar-project-path">{projectPath}</span>
          </div>
        )}
        <div className="topbar-drag-spacer" />
        <div className="app-actions">
          <ProjectSnapshotsDialog
            client={applicationClient.project}
            disabled={!projectPath || pending > 0}
            projectName={projectName}
          />
          <TopbarSettingsMenu
            canRedo={historyState.canRedo}
            canSaveLayout={Boolean(activeWorkspaceId)}
            canUndo={historyState.canUndo}
            isMac={isMac}
            layoutSaved={layoutSaved}
            redoLabel={historyState.redoLabel}
            refreshing={source.refreshing}
            theme={theme}
            typography={typography}
            undoLabel={historyState.undoLabel}
            onRedo={() => history.redo()}
            onRefreshComponents={() => desktopElementSource.refresh()}
            onReloadApplication={() => shell.window.reload()}
            onSaveDefaultLayout={saveDefaultLayout}
            onThemeChange={setTheme}
            onTypographyChange={setTypography}
            onUndo={() => history.undo()}
          />
          {(openError || dropError || runtimeError || elementError) && (
            <span className="open-error" title={openError ?? dropError ?? runtimeError ?? elementError ?? ''}>
              {openError ?? dropError ?? runtimeError ?? elementError}
            </span>
          )}
        </div>
        {!isMac && (
          <div className="window-controls">
            <button type="button" title="最小化" onClick={() => shell.window.minimize()}><Minus size={15} /></button>
            <button type="button" title="最大化/恢复" onClick={() => shell.window.toggleMaximize()}><Square size={12} /></button>
            <button className="window-close" type="button" title="关闭" onClick={() => shell.window.close()}><X size={15} /></button>
          </div>
        )}
      </header>
      <div className="workspace-pages">
        {workspaces.map((workspace) => (
          <Workspace
            workspaceId={workspace.id}
            active={workspace.id === activeWorkspaceId}
            key={workspace.id}
          />
        ))}
      </div>
      <footer className="app-footer davinci-dock-bar">
        <div className="dock-status-group">
          <span className="dock-status-item">
            <i className="connection-dot" />
            <span>State 已连接</span>
          </span>
          <span className="dock-status-item dock-subtle-tag">
            Markdown Logic + Flat Node Store
          </span>
          {activeBackgroundTasks > 0 && (
            <span className="dock-status-item dock-task-pill">
              后台任务 {activeBackgroundTasks} · {Math.round(backgroundProgress * 100)}%
            </span>
          )}
        </div>

        <nav className="workspace-tabs davinci-workspace-dock" aria-label="达芬奇工作区分页">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId
            const IconComponent = WORKSPACE_ICONS[workspace.id] ?? Film
            return (
              <button
                key={workspace.id}
                type="button"
                className={`davinci-dock-item ${isActive ? 'is-active' : ''}`}
                onClick={() => void commands.execute('workspace.activate', workspace.id)}
                title={workspace.name}
              >
                <span className="davinci-dock-icon">
                  <IconComponent size={15} />
                </span>
                <span className="davinci-dock-label">{workspace.name}</span>
              </button>
            )
          })}
        </nav>

        <div className="dock-meta-group">
          <span className="dock-shortcut-hint">{isMac ? '⌘+Space 最大化区域' : 'Ctrl+Space 最大化区域'}</span>
          <span className="dock-version-badge">GraphVideo v0.1</span>
        </div>
      </footer>
      </main>
    </>
  )
}
