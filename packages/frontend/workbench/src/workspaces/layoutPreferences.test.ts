import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceRuntimeState } from '../dock/workspaceTypes'
import {
  loadActiveWorkspacePreference, loadWorkspaceDefault,
  saveActiveWorkspacePreference, saveWorkspaceDefault,
} from './layoutPreferences'

const workspace: WorkspaceRuntimeState = {
  id: 'editing',
  name: '编辑',
  order: 10,
  focusedAreaId: 'editor',
  maximizedAreaId: null,
  layout: {
    kind: 'area', id: 'editor', activePanelId: 'markdown-editor',
    panelHistory: ['markdown-editor'],
    panelInstanceIds: { 'markdown-editor': 'shared-editor' },
  },
}

describe('Workspace default layout preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    })
  })

  it('stores the last active workspace independently from default layouts', () => {
    saveActiveWorkspacePreference('generation')
    expect(loadActiveWorkspacePreference()).toBe('generation')
  })

  it('restores a user-saved runtime layout', () => {
    saveWorkspaceDefault(workspace)
    expect(loadWorkspaceDefault('editing')).toEqual({
      layout: workspace.layout,
      focusedAreaId: 'editor',
    })
  })

  it('ignores invalid persisted layouts', () => {
    localStorage.setItem('graphvideo-workspace-default-layouts-v1', JSON.stringify({
      editing: { focusedAreaId: 'missing', layout: { kind: 'area', id: 'editor' } },
    }))
    expect(loadWorkspaceDefault('editing')).toBeNull()
  })
})
