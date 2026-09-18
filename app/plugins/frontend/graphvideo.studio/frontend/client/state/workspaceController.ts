import {
  canCloseArea, closeArea, listAreas, resizeSplit, splitArea, swapAreaPanels, switchAreaPanel,
} from '@graphvideo/workbench'
import type { ClientStateStore } from './clientStateStore'
import type { ClientWorkspaceHistory } from './clientWorkspaceHistory'
import type { WorkspaceRuntimeState } from './workspaceTypes'

let dockSequence = 0

function dockId(prefix: string) {
  dockSequence += 1
  return `${prefix}-${Date.now()}-${dockSequence}`
}

export class ClientWorkspaceController {
  constructor(
    private readonly state: ClientStateStore,
    private readonly history: ClientWorkspaceHistory,
  ) {}

  activate(workspaceId: string) {
    this.state.activateWorkspace(workspaceId)
  }

  focus(workspaceId: string, areaId: string) {
    this.replace(workspaceId, '聚焦工作区区域', (workspace) => (
      workspace.focusedAreaId === areaId ? workspace : { ...workspace, focusedAreaId: areaId }
    ), undefined, false)
  }

  switchPanel(workspaceId: string, areaId: string, panelId: string) {
    this.replace(workspaceId, '切换面板', (workspace) => ({
      ...workspace,
      layout: switchAreaPanel(workspace.layout, areaId, panelId, dockId('panel')),
    }))
  }

  splitArea(workspaceId: string, areaId: string, direction: 'horizontal' | 'vertical') {
    this.replace(workspaceId, '拆分工作区', (workspace) => {
      const newAreaId = dockId('area')
      return {
        ...workspace,
        layout: splitArea(workspace.layout, areaId, direction, {
          areaId: newAreaId,
          splitId: dockId('split'),
          panelInstanceId: dockId('panel'),
        }),
        focusedAreaId: newAreaId,
      }
    })
  }

  closeArea(workspaceId: string, areaId: string) {
    this.replace(workspaceId, '关闭工作区区域', (workspace) => {
      if (!canCloseArea(workspace.layout, areaId)) return workspace
      const layout = closeArea(workspace.layout, areaId)
      return {
        ...workspace,
        layout,
        focusedAreaId: workspace.focusedAreaId === areaId
          ? listAreas(layout)[0].id
          : workspace.focusedAreaId,
        maximizedAreaId: workspace.maximizedAreaId === areaId ? null : workspace.maximizedAreaId,
      }
    })
  }

  resizeSplit(workspaceId: string, splitId: string, ratio: number, historyGroupId?: string) {
    this.replace(workspaceId, '调整工作区尺寸', (workspace) => {
      const layout = resizeSplit(workspace.layout, splitId, ratio)
      return layout === workspace.layout ? workspace : { ...workspace, layout }
    }, historyGroupId)
  }

  swapAreas(workspaceId: string, sourceAreaId: string, targetAreaId: string) {
    this.replace(workspaceId, '交换工作区区域', (workspace) => {
      const layout = swapAreaPanels(workspace.layout, sourceAreaId, targetAreaId)
      return layout === workspace.layout ? workspace : { ...workspace, layout }
    })
  }

  toggleMaximize(workspaceId: string, areaId: string) {
    this.replace(workspaceId, '切换区域最大化', (workspace) => ({
      ...workspace,
      maximizedAreaId: workspace.maximizedAreaId === areaId ? null : areaId,
    }))
  }

  private replace(
    workspaceId: string,
    label: string,
    update: (workspace: WorkspaceRuntimeState) => WorkspaceRuntimeState,
    mergeKey?: string,
    record = true,
  ) {
    const before = this.state.read().workspace
    this.state.updateWorkspace(workspaceId, update)
    const after = this.state.read().workspace
    if (record) this.history.record(label, before, after, mergeKey)
  }
}
