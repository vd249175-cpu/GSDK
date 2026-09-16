import { describe, expect, it } from 'vitest'
import { ClientStateStore } from './clientStateStore'
import { ClientWorkspaceHistory } from './clientWorkspaceHistory'
import { ClientWorkspaceController } from './workspaceController'

function setup() {
  const state = new ClientStateStore()
  state.replaceWorkspaces({
    activeWorkspaceId: 'editing',
    items: {
      editing: {
        id: 'editing',
        name: '编辑',
        order: 1,
        focusedAreaId: 'main',
        maximizedAreaId: null,
        layout: {
          kind: 'area',
          id: 'main',
          activePanelId: 'outliner',
          panelHistory: ['outliner'],
          panelInstanceIds: { outliner: 'outliner-1' },
        },
      },
    },
  })
  const history = new ClientWorkspaceHistory(state)
  const controller = new ClientWorkspaceController(state, history)
  return { state, history, controller }
}

describe('ClientWorkspaceController', () => {
  it('owns Dock mutations outside Application state', () => {
    const { state, controller } = setup()
    controller.splitArea('editing', 'main', 'horizontal')
    const workspace = state.read().workspace.items.editing
    expect(workspace.layout.kind).toBe('split')
    expect(workspace.focusedAreaId).not.toBe('main')
  })

  it('undoes, redoes and clears the redo branch after a new operation', () => {
    const { state, history, controller } = setup()
    controller.toggleMaximize('editing', 'main')
    expect(state.read().workspace.items.editing.maximizedAreaId).toBe('main')
    history.undo()
    expect(state.read().workspace.items.editing.maximizedAreaId).toBeNull()
    history.redo()
    expect(state.read().workspace.items.editing.maximizedAreaId).toBe('main')
    history.undo()
    controller.switchPanel('editing', 'main', 'properties')
    expect(history.getSnapshot().canRedo).toBe(false)
  })

  it('merges continuous resize operations by history group', () => {
    const { state, history, controller } = setup()
    controller.splitArea('editing', 'main', 'horizontal')
    const layout = state.read().workspace.items.editing.layout
    if (layout.kind !== 'split') throw new Error('expected split layout')
    controller.resizeSplit('editing', layout.id, 0.4, 'gesture-1')
    controller.resizeSplit('editing', layout.id, 0.3, 'gesture-1')
    history.undo()
    const restored = state.read().workspace.items.editing.layout
    expect(restored.kind === 'split' ? restored.ratio : null).toBe(0.5)
    expect(history.getSnapshot().undoLabel).toBe('拆分工作区')
  })
})
