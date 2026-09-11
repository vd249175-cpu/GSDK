import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchHostContext, type WorkbenchServices } from '../context/WorkbenchHostContext'
import type { ClientWorkspaceState } from '../dock/workspaceTypes'
import { WorkspaceTabs } from './WorkspaceTabs'

function area(id: string) {
  return {
    kind: 'area', id, activePanelId: 'panel',
    panelHistory: ['panel'], panelInstanceIds: { panel: `${id}-instance` },
  } as const
}

const state: ClientWorkspaceState = {
  activeWorkspaceId: 'editing',
  items: {
    review: {
      id: 'review', name: 'Review', order: 2,
      layout: area('review-main'), focusedAreaId: 'review-main', maximizedAreaId: null,
    },
    editing: {
      id: 'editing', name: 'Editing', order: 1,
      layout: area('editor'), focusedAreaId: 'editor', maximizedAreaId: null,
    },
  },
}

describe('WorkspaceTabs', () => {
  it('按 order 渲染标签并经命令激活', async () => {
    const execute = vi.fn()
    const adapter = {
      services: { commands: { execute } } as unknown as WorkbenchServices,
      useWorkspaceState: <T,>(selector: (workspace: ClientWorkspaceState) => T): T => selector(state),
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <WorkbenchHostContext.Provider value={adapter}>
          <WorkspaceTabs />
        </WorkbenchHostContext.Provider>,
      )
    })
    const labels = [...container.querySelectorAll('.workspace-tabs button')]
      .map((button) => button.textContent)
    expect(labels).toEqual(['Editing', 'Review'])
    expect(container.querySelector('.workspace-tabs button.is-active')?.textContent).toBe('Editing')
    await act(async () => {
      container.querySelectorAll('.workspace-tabs button')[1]?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(execute).toHaveBeenCalledWith('workspace.activate', 'review')
    await act(async () => root.unmount())
    container.remove()
  })
})
