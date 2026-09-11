import { useWorkbenchServices, useWorkbenchWorkspace } from '../context/WorkbenchHostContext'

/** 工作区标签导航：读工作区列表与激活态，经 `workspace.activate` 命令切换。 */
export function WorkspaceTabs() {
  const { commands } = useWorkbenchServices()
  const tabs = useWorkbenchWorkspace((state) => (
    Object.values(state.items).sort((left, right) => (
      left.order - right.order || left.id.localeCompare(right.id)
    ))
  ))
  const activeWorkspaceId = useWorkbenchWorkspace((state) => state.activeWorkspaceId)
  return (
    <nav className="workspace-tabs" aria-label="工作区">
      {tabs.map((workspace) => (
        <button
          className={workspace.id === activeWorkspaceId ? 'is-active' : ''}
          type="button"
          key={workspace.id}
          onClick={() => void commands.execute('workspace.activate', workspace.id)}
        >{workspace.name}</button>
      ))}
    </nav>
  )
}
