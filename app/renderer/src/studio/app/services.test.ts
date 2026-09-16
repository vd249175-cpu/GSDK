import { describe, expect, it } from 'vitest'
import type { WorkspaceRuntimeState } from '../client/state/workspaceTypes'
import { appServices } from './services'

function workspace(id: string): WorkspaceRuntimeState {
  return {
    id,
    name: id,
    order: 1,
    focusedAreaId: 'main',
    maximizedAreaId: null,
    layout: {
      kind: 'area',
      id: 'main',
      activePanelId: 'properties',
      panelHistory: ['properties'],
      panelInstanceIds: { properties: `${id}-properties` },
    },
  }
}

describe('workspace-scoped Dock commands', () => {
  it('updates only the workspace carried by the command payload', async () => {
    appServices.clientState.replaceWorkspaces({
      activeWorkspaceId: 'editing',
      items: { editing: workspace('editing'), review: workspace('review') },
    })
    const reviewBefore = appServices.clientState.read().workspace.items.review

    await appServices.commands.execute('workspace.area.maximize', {
      workspaceId: 'editing', areaId: 'main',
    })

    const result = appServices.clientState.read().workspace.items
    expect(result.editing.maximizedAreaId).toBe('main')
    expect(result.review).toBe(reviewBefore)
    expect(result.review.maximizedAreaId).toBeNull()
  })
})
