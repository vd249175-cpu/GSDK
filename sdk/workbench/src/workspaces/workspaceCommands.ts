import type { CommandRegistry } from '../commands/commandRegistry'
import type { WorkspaceRuntimeState } from '../dock/workspaceTypes'
import { saveActiveWorkspacePreference, saveWorkspaceDefault } from './layoutPreferences'

/** 工作区命令的目标：宿主提供工作区存储，工作台提供命令装配。 */
export interface WorkspaceCommandTarget {
  activate(workspaceId: string): void
  focus(workspaceId: string, areaId: string): void
  switchPanel(workspaceId: string, areaId: string, panelId: string): void
  splitArea(workspaceId: string, areaId: string, direction: 'horizontal' | 'vertical'): void
  closeArea(workspaceId: string, areaId: string): void
  resizeSplit(workspaceId: string, splitId: string, ratio: number, historyGroupId?: string): void
  swapAreas(workspaceId: string, sourceAreaId: string, targetAreaId: string): void
  toggleMaximize(workspaceId: string, areaId: string): void
  readWorkspace(workspaceId: string): WorkspaceRuntimeState | undefined
}

/** 注册工作区与 Dock 命令；布局偏好读写由工作台统一管理。 */
export function registerWorkspaceCommands(
  commands: CommandRegistry,
  target: WorkspaceCommandTarget,
  owner = 'core',
): void {
  commands.register<string>('workspace.activate', (workspaceId) => {
    target.activate(workspaceId)
    saveActiveWorkspacePreference(workspaceId)
  }, owner)
  commands.register<string>('workspace.layout.save-default', (workspaceId) => {
    const value = target.readWorkspace(workspaceId)
    if (!value) throw new Error(`工作区不存在：${workspaceId}`)
    saveWorkspaceDefault(value)
  }, owner)
  commands.register<{ workspaceId: string; areaId: string }>(
    'workspace.area.focus',
    ({ workspaceId, areaId }) => target.focus(workspaceId, areaId),
    owner,
  )
  commands.register<{ workspaceId: string; areaId: string; panelId: string }>(
    'workspace.panel.switch',
    ({ workspaceId, areaId, panelId }) => target.switchPanel(workspaceId, areaId, panelId),
    owner,
  )
  commands.register<{
    workspaceId: string
    areaId: string
    direction: 'horizontal' | 'vertical'
  }>(
    'workspace.area.split',
    ({ workspaceId, areaId, direction }) => target.splitArea(workspaceId, areaId, direction),
    owner,
  )
  commands.register<{ workspaceId: string; areaId: string }>(
    'workspace.area.close',
    ({ workspaceId, areaId }) => target.closeArea(workspaceId, areaId),
    owner,
  )
  commands.register<{
    workspaceId: string
    splitId: string
    ratio: number
    historyGroupId?: string
  }>(
    'workspace.split.resize',
    ({ workspaceId, splitId, ratio, historyGroupId }) => (
      target.resizeSplit(workspaceId, splitId, ratio, historyGroupId)
    ),
    owner,
  )
  commands.register<{
    workspaceId: string
    sourceAreaId: string
    targetAreaId: string
  }>(
    'workspace.area.swap',
    ({ workspaceId, sourceAreaId, targetAreaId }) => target.swapAreas(workspaceId, sourceAreaId, targetAreaId),
    owner,
  )
  commands.register<{ workspaceId: string; areaId: string }>(
    'workspace.area.maximize',
    ({ workspaceId, areaId }) => target.toggleMaximize(workspaceId, areaId),
    owner,
  )
}
