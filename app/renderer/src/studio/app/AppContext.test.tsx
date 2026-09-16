import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  ServicesContext, useProjectSelectionSync, useSelectedNodeId,
  useClientSelectionActions, useWorkbenchContext,
} from './AppContext'
import type { AppServices } from './services'
import { activeSelectedNodeIdToken } from '@graphvideo/sdk/tokens'
import { ClientStateStore } from '../client/state/clientStateStore'
import { WorkbenchContextStore } from '@graphvideo/workbench'
import { initialKernelApplicationState } from '../application/graph/application-state-projection'
import { parseProject } from '../core/project/parser'
import type { ApplicationState } from '../core/state/types'

const roots: Root[] = []
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  if (typeof localStorage !== 'undefined' && typeof localStorage.clear === 'function') localStorage.clear()
})
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()))
  if (typeof localStorage !== 'undefined' && typeof localStorage.clear === 'function') localStorage.clear()
})

const nodes: ApplicationState['project']['nodes'] = {
  node_first: { id: 'node_first', title: 'First', type: 'text', description: '' },
  node_saved: { id: 'node_saved', title: 'Saved', type: 'text', description: '' },
}

function mountSelection(saved: Record<string, string | null> = {}, ready = true) {
  const clientState = new ClientStateStore()
  Object.entries(saved).forEach(([path, value]) => clientState.selectNode(path, value))
  const contexts = new WorkbenchContextStore()
  const initial = initialKernelApplicationState()
  let state: ApplicationState = {
    ...initial,
    project: {
      ...initial.project, localPath: '/project/a', nodes: ready ? nodes : {},
      tree: parseProject('<project-structure>\n$Saved\n</project-structure>').tree,
    },
  }
  const listeners = new Set<() => void>()
  const services = {
    clientState, workbenchContexts: contexts,
    applicationSnapshots: {
      readState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  } as AppServices
  let selected: string | null
  let token: string | null | undefined
  let select!: (path: string | null, id: string | null) => void
  let write!: (id: string | null) => void
  function Consumer() {
    useProjectSelectionSync()
    selected = useSelectedNodeId()
    const shared = useWorkbenchContext(activeSelectedNodeIdToken)
    token = shared[0]
    write = shared[1]
    select = useClientSelectionActions().selectNode
    return <span>{selected}</span>
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  act(() => root.render(<ServicesContext.Provider value={services}><Consumer /></ServicesContext.Provider>))
  return {
    clientState, contexts,
    read: () => ({ selected, token }),
    select: (id: string | null, path = '/project/a') => act(() => select(path, id)),
    write: (id: string | null) => act(() => write(id)),
    project: (path: string, nextNodes = nodes) => act(() => {
      state = { ...state, project: { ...state.project, localPath: path, nodes: nextNodes } }
      listeners.forEach((listener) => listener())
    }),
  }
}

describe('Shared project selection', () => {
  it('restores a saved tree identity as a real Node ID for both built-in and plugin consumers', () => {
    const app = mountSelection({ '/project/a': 'auto:$:Saved' })
    expect(app.read()).toEqual({ selected: 'node_saved', token: 'node_saved' })
    expect(app.clientState.read().selectionByProjectPath['/project/a']).toBe('node_saved')
  })

  it('resolves parser identities emitted by outliner clicks before writing the token', () => {
    const app = mountSelection()
    const item = parseProject('<project-structure>\n$Saved\n</project-structure>').tree[0]
    app.select(item.nodeId!)
    expect(app.read()).toEqual({ selected: 'node_saved', token: 'node_saved' })
    expect(nodes[app.read().selected!].title).toBe('Saved')
    app.select(item.key)
    expect(app.read().token).toBe('node_saved')
  })

  it('preserves explicit null across A -> B -> A and a new session', () => {
    const app = mountSelection({ '/project/a': 'node_saved' })
    app.select(null)
    app.project('/project/b')
    app.project('/project/a')
    expect(app.read()).toEqual({ selected: null, token: null })
    const restored = mountSelection(app.clientState.read().selectionByProjectPath)
    expect(restored.read()).toEqual({ selected: null, token: null })
  })

  it('preserves and persists plugin token writes across project switches', () => {
    const app = mountSelection({ '/project/a': 'node_first' })
    app.write('node_saved')
    app.project('/project/b')
    app.project('/project/a')
    expect(app.read()).toEqual({ selected: 'node_saved', token: 'node_saved' })
    expect(app.clientState.read().selectionByProjectPath['/project/a']).toBe('node_saved')
  })

  it('waits for registry data and initializes only once', () => {
    const app = mountSelection({ '/project/a': 'node_saved' }, false)
    expect(app.read().token).toBeUndefined()
    app.project('/project/a')
    expect(app.read().token).toBe('node_saved')
    app.write(null)
    app.project('/project/a', { ...nodes })
    expect(app.read().token).toBeNull()
  })

  it('honors saved null instead of a current-selection fallback', () => {
    const app = mountSelection({ current: 'node_saved', '/project/a': null })
    expect(app.read().token).toBeNull()
  })

  it('binds actions to the requested project, not the currently rendered project', () => {
    const app = mountSelection({ '/project/a': 'node_first' })
    app.select('node_saved', '/project/b')
    expect(app.read().token).toBe('node_first')
    app.project('/project/b')
    expect(app.read().token).toBe('node_saved')
  })
})
