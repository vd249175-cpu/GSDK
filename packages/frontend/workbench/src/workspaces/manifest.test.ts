import { describe, expect, it } from 'vitest'
import { createWorkspaceRuntime, parseWorkspaceDefinition } from './manifest'

const workspace = JSON.stringify({
  id: 'editing',
  name: '编辑',
  order: 10,
  layout: {
    kind: 'split',
    id: 'root',
    direction: 'horizontal',
    ratio: 0.7,
    first: {
      kind: 'area', id: 'editor', panelId: 'markdown-editor', instanceId: 'shared-editor',
    },
    second: {
      kind: 'area', id: 'properties', panelId: 'properties', instanceId: 'shared-properties',
    },
  },
})

describe('Workspace source definition', () => {
  it('creates stable panel instance bindings from source JSON', () => {
    const runtime = createWorkspaceRuntime(parseWorkspaceDefinition('editing', workspace))
    expect(runtime.focusedAreaId).toBe('editor')
    expect(runtime.layout).toMatchObject({
      kind: 'split',
      first: {
        activePanelId: 'markdown-editor',
        panelInstanceIds: { 'markdown-editor': 'shared-editor' },
      },
      second: {
        activePanelId: 'properties',
        panelInstanceIds: { properties: 'shared-properties' },
      },
    })
  })

  it('rejects duplicate Area/Split IDs inside one workspace', () => {
    const duplicate = workspace.replace('"id":"properties"', '"id":"editor"')
    expect(() => parseWorkspaceDefinition('editing', duplicate)).toThrow('ID 无效或重复')
  })
})
