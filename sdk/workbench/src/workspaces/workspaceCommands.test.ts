import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../commands/commandRegistry'
import { loadActiveWorkspacePreference, loadWorkspaceDefault } from './layoutPreferences'
import {
  registerWorkspaceCommands, type WorkspaceCommandTarget,
} from './workspaceCommands'
import type { WorkspaceRuntimeState } from '../dock/workspaceTypes'

const layout = {
  kind: 'area', id: 'main', activePanelId: 'panel',
  panelHistory: ['panel'], panelInstanceIds: { panel: 'panel-1' },
} as const

function fixture(): WorkspaceRuntimeState {
  return {
    id: 'editing', name: 'Editing', order: 0,
    layout: { ...layout, panelHistory: [...layout.panelHistory] },
    focusedAreaId: 'main', maximizedAreaId: null,
  }
}

function setup() {
  const commands = new CommandRegistry()
  const stored = fixture()
  const target: WorkspaceCommandTarget = {
    activate: vi.fn(),
    focus: vi.fn(),
    switchPanel: vi.fn(),
    splitArea: vi.fn(),
    closeArea: vi.fn(),
    resizeSplit: vi.fn(),
    swapAreas: vi.fn(),
    toggleMaximize: vi.fn(),
    readWorkspace: (workspaceId: string) => (workspaceId === stored.id ? stored : undefined),
  }
  registerWorkspaceCommands(commands, target)
  return { commands, target, stored }
}

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  })
})

describe('registerWorkspaceCommands', () => {
  it('将区域操作委托给宿主目标', () => {
    const { commands, target } = setup()
    commands.execute('workspace.area.focus', { workspaceId: 'editing', areaId: 'main' })
    commands.execute('workspace.panel.switch', { workspaceId: 'editing', areaId: 'main', panelId: 'panel' })
    commands.execute('workspace.area.split', { workspaceId: 'editing', areaId: 'main', direction: 'horizontal' })
    commands.execute('workspace.area.close', { workspaceId: 'editing', areaId: 'main' })
    commands.execute('workspace.split.resize', { workspaceId: 'editing', splitId: 's', ratio: 0.4 })
    commands.execute('workspace.area.swap', { workspaceId: 'editing', sourceAreaId: 'a', targetAreaId: 'b' })
    commands.execute('workspace.area.maximize', { workspaceId: 'editing', areaId: 'main' })
    expect(target.focus).toHaveBeenCalledWith('editing', 'main')
    expect(target.switchPanel).toHaveBeenCalledWith('editing', 'main', 'panel')
    expect(target.splitArea).toHaveBeenCalledWith('editing', 'main', 'horizontal')
    expect(target.closeArea).toHaveBeenCalledWith('editing', 'main')
    expect(target.resizeSplit).toHaveBeenCalledWith('editing', 's', 0.4, undefined)
    expect(target.swapAreas).toHaveBeenCalledWith('editing', 'a', 'b')
    expect(target.toggleMaximize).toHaveBeenCalledWith('editing', 'main')
  })

  it('激活工作区后持久化偏好', () => {
    const { commands, target } = setup()
    commands.execute('workspace.activate', 'editing')
    expect(target.activate).toHaveBeenCalledWith('editing')
    expect(loadActiveWorkspacePreference()).toBe('editing')
  })

  it('保存默认布局并在未知工作区报错', () => {
    const { commands, stored } = setup()
    commands.execute('workspace.layout.save-default', stored.id)
    expect(loadWorkspaceDefault(stored.id)?.focusedAreaId).toBe('main')
    expect(() => commands.execute('workspace.layout.save-default', 'missing'))
      .toThrow('工作区不存在：missing')
  })
})
