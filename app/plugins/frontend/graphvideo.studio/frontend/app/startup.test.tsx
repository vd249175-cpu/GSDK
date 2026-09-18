import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationErrorBoundary } from './ApplicationErrorBoundary'
import { ApplicationStartup, useStateSelector } from './AppContext'
import { restoreLastProjectAtStartup } from './projectStartup'
import { createInitialState } from '../core/state/initialState'
import type { LocalProjectSource } from '../core/system/desktopAdapter'

class TestStore<S> {
  private readonly listeners = new Set<() => void>()

  constructor(private state: S) {}

  read = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  write(update: (state: S) => S) {
    this.state = update(this.state)
    this.listeners.forEach((listener) => listener())
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Renderer startup', () => {
  it('does not render a project consumer for unrelated runtime writes', async () => {
    const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true
    const state = new TestStore(createInitialState())
    const renders: string[] = []
    const container = document.createElement('div')
    const root = createRoot(container)
    function Consumer() {
      const project = useStateSelector(state, (snapshot) => ({
        name: snapshot.project.name,
      }))
      renders.push(project.name)
      return <span>{project.name}</span>
    }

    try {
      await act(async () => root.render(<Consumer />))
      await act(async () => state.write((snapshot) => ({
        ...snapshot,
        runtime: { ...snapshot.runtime, pendingTasks: 1 },
      })))
      expect(renders).toEqual(['未打开项目'])

      await act(async () => state.write((snapshot) => ({
        ...snapshot,
        project: { ...snapshot.project, name: '新项目' },
      })))
      expect(renders).toEqual(['未打开项目', '新项目'])
    } finally {
      await act(async () => root.unmount())
      testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  })

  it('restores the last project without requiring an Element runtime', async () => {
    const project: LocalProjectSource = {
      name: '测试项目',
      path: 'C:\\projects\\test',
      markdown: '<project-structure>\n# 项目\n</project-structure>',
      nodes: [],
      retainedNodes: [],
    }
    const restore = vi.fn(async () => project)
    const open = vi.fn(async () => undefined)

    await restoreLastProjectAtStartup(restore, open)

    expect(restore).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledExactlyOnceWith(project)
  })

  it('renders the application before asynchronous Element initialization finishes', async () => {
    const initialization = deferred()
    const initialize = vi.fn(() => initialization.promise)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(<ApplicationStartup initialize={initialize}><span>界面已挂载</span></ApplicationStartup>)
    })

    expect(container.textContent).toContain('界面已挂载')
    expect(initialize).toHaveBeenCalledOnce()
    await act(async () => initialization.resolve())
    await act(async () => root.unmount())
  })

  it('shows a visible fallback when a React subtree throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const container = document.createElement('div')
    const root = createRoot(container)
    function Broken(): ReactElement {
      throw new Error('测试渲染失败')
    }

    await act(async () => {
      root.render(<ApplicationErrorBoundary><Broken /></ApplicationErrorBoundary>)
    })

    expect(container.textContent).toContain('GraphVideo 无法完成界面渲染')
    expect(container.textContent).toContain('测试渲染失败')
    consoleError.mockRestore()
    await act(async () => root.unmount())
  })
})
