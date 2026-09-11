import { useWorkbenchWorkspace } from '../context/WorkbenchHostContext'
import { Workspace } from '../dock/Workspace'

/**
 * 工作区页面容器：全部实例常驻、非激活隐藏。
 * 切页不卸载 Element，实例状态与资源随页面保留。
 */
export function WorkspacePages() {
  const workspaceIds = useWorkbenchWorkspace((state) => (
    Object.values(state.items)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((workspace) => workspace.id)
  ))
  const activeWorkspaceId = useWorkbenchWorkspace((state) => state.activeWorkspaceId)
  return (
    <div className="workspace-pages">
      {workspaceIds.map((workspaceId) => (
        <Workspace
          workspaceId={workspaceId}
          active={workspaceId === activeWorkspaceId}
          key={workspaceId}
        />
      ))}
    </div>
  )
}
