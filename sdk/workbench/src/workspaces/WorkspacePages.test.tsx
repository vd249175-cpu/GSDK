import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchHostContext, type WorkbenchServices } from '../context/WorkbenchHostContext'
import type { ClientWorkspaceState } from '../dock/workspaceTypes'
import { WorkspacePages } from './WorkspacePages'

vi.mock('../dock/Workspace', () => ({
  Workspace: ({ workspaceId, active }: { workspaceId: string; active: boolean }) => (
    <div data-workspace={workspaceId} data-active={active} />
  ),
}))

const state: ClientWorkspaceState = {
  activeWorkspaceId: 'editing',
  items: {
    review: {
      id: 'review', name: 'Review', order: 2,
      layout: {
        kind: 'area', id: 'review-main', activePanelId: 'panel',
        panelHistory: ['panel'], panelInstanceIds: { panel: 'review-instance' },
      },
      focusedAreaId: 'review-main', maximizedAreaId: null,
    },
    editing: {
      id: 'editing', name: 'Editing', order: 1,
      layout: {
        kind: 'area', id: 'editor', activePanelId: 'panel',
        panelHistory: ['panel'], panelInstanceIds: { panel: 'editor-instance' },
      },
      focusedAreaId: 'editor', maximizedAreaId: null,
    },
  },
}

describe('WorkspacePages', () => {
  it('常驻全部实例并只激活当前页', async () => {
    const adapter = {
      services: {} as unknown as WorkbenchServices,
      useWorkspaceState: <T,>(selector: (workspace: ClientWorkspaceState) => T): T => selector(state),
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <WorkbenchHostContext.Provider value={adapter}>
          <WorkspacePages />
        </WorkbenchHostContext.Provider>,
      )
    })
    const pages = [...container.querySelectorAll('.workspace-pages [data-workspace]')]
      .map((node) => [node.getAttribute('data-workspace'), node.getAttribute('data-active')])
    expect(pages).toEqual([['editing', 'true'], ['review', 'false']])
    await act(async () => root.unmount())
    container.remove()
  })
})
