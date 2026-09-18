import { describe, expect, it, vi } from 'vitest'
import type { GraphVideoApplicationClient } from '../app/applicationClient'
import { ClientHistoryCoordinator } from './clientHistoryCoordinator'
import { ClientStateStore } from './clientStateStore'
import { ClientWorkspaceHistory } from './clientWorkspaceHistory'

function setup() {
  let applicationRecorded: ((payload: { historyId: string; label: string }) => void) | undefined
  const application = {
    history: {
      undo: vi.fn(async () => undefined),
      redo: vi.fn(async () => undefined),
      clearRedo: vi.fn(async () => undefined),
      onRecorded: (listener: typeof applicationRecorded) => {
        applicationRecorded = listener
        return () => { applicationRecorded = undefined }
      },
      onCleared: () => () => undefined,
    },
  } as unknown as GraphVideoApplicationClient
  const clientState = new ClientStateStore()
  const workspace = new ClientWorkspaceHistory(clientState)
  const coordinator = new ClientHistoryCoordinator(application, workspace)
  return { application, applicationRecorded, coordinator, workspace }
}

describe('ClientHistoryCoordinator', () => {
  it('preserves application/workspace ordering across undo and redo', async () => {
    const context = setup()
    context.applicationRecorded?.({ historyId: 'project-1', label: '修改节点' })
    // Workspace history records an opaque client entry after the project operation.
    context.workspace.record(
      '切换面板',
      { activeWorkspaceId: '', items: {} },
      { activeWorkspaceId: 'editing', items: {} },
    )
    expect(context.coordinator.getSnapshot().undoLabel).toBe('切换面板')
    await context.coordinator.undo()
    expect(context.application.history.undo).not.toHaveBeenCalled()
    expect(context.coordinator.getSnapshot().undoLabel).toBe('修改节点')
    await context.coordinator.undo()
    expect(context.application.history.undo).toHaveBeenCalledOnce()
    await context.coordinator.redo()
    expect(context.application.history.redo).toHaveBeenCalledOnce()
  })
})
