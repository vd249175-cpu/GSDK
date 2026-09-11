import { describe, expect, it, vi } from 'vitest'
import { ElementStateRegistry } from '../registry/stateRegistry'
import { EventRegistry } from '../registry/eventRegistry'
import { defineService, ServiceRegistry } from '../registry/serviceRegistry'
import { ElementRuntimeManager } from './runtimeManager'
import type { ElementHostApi } from './types'

const host: ElementHostApi = {
  getProjectId: () => 'project-a',
  executeCommand: () => undefined,
}

function runtimeManager(states = new ElementStateRegistry(), services = new ServiceRegistry()) {
  return new ElementRuntimeManager(states, host, services, new EventRegistry())
}

describe('Element runtime instance manager', () => {
  it('releases resources acquired before a factory throws', async () => {
    const manager = runtimeManager()
    const dispose = vi.fn()
    await manager.replaceFactory('broken', { create(context) {
      context.onDispose(dispose)
      throw new Error('factory failed')
    } })
    expect(() => manager.getOrCreate('broken', 'one')).toThrow('factory failed')
    await manager.disposeAll()
    expect(dispose).toHaveBeenCalledOnce()
    expect(manager.listInstances()).toHaveLength(0)
  })

  it('runs every runtime cleanup despite a rejected disposer', async () => {
    const manager = runtimeManager()
    const dispose = vi.fn()
    await manager.replaceFactory('cleanup', { create(context) {
      context.onDispose(dispose)
      return { async dispose() { throw new Error('cleanup failed') } }
    } })
    manager.getOrCreate('cleanup', 'one')
    await manager.removeElement('cleanup')
    expect(dispose).toHaveBeenCalledOnce()
    expect(manager.listInstances()).toHaveLength(0)
  })

  it('waits for partial async factory cleanup before reporting a failed replacement', async () => {
    const manager = runtimeManager()
    await manager.replaceFactory('hot', { create: () => ({ version: 'stable' }) })
    const stable = manager.getOrCreate('hot', 'one')
    let finish!: () => void
    const cleanup = new Promise<void>((resolve) => { finish = resolve })
    const disposed = vi.fn()
    const replacement = manager.replaceFactory('hot', { create(context) {
      context.onDispose(disposed)
      context.onDispose(async () => { await cleanup })
      throw new Error('broken replacement')
    } })
    const rejected = expect(replacement).rejects.toThrow('broken replacement')
    expect(disposed).not.toHaveBeenCalled()
    finish()
    await rejected
    expect(disposed).toHaveBeenCalledOnce()
    expect(manager.getOrCreate('hot', 'one')).toBe(stable)
    await manager.disposeAll()
  })

  it('shares one runtime for the same instanceId and isolates different instanceIds', async () => {
    const states = new ElementStateRegistry()
    const manager = runtimeManager(states)
    const create = vi.fn(({ instanceId }) => ({ cache: new Map([['owner', instanceId]]) }))
    await manager.replaceFactory('timeline', { create })

    const sharedA = manager.getOrCreate('timeline', 'shared-editor')
    const sharedB = manager.getOrCreate('timeline', 'shared-editor')
    const isolated = manager.getOrCreate('timeline', 'isolated-editor')

    expect(sharedB).toBe(sharedA)
    expect(isolated).not.toBe(sharedA)
    expect(isolated.value).not.toBe(sharedA.value)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('rebuilds existing runtimes on refresh while preserving stable state cells', async () => {
    const disposeFirst = vi.fn()
    const states = new ElementStateRegistry()
    states.replaceOwner('timeline', [
      { id: 'selection', scope: 'instance', initialValue: null },
    ])
    const manager = runtimeManager(states)
    await manager.replaceFactory('timeline', {
      create: (context) => {
        context.onDispose(disposeFirst)
        return { version: 1 }
      },
    })
    const first = manager.getOrCreate('timeline', 'shared-editor')
    first.states.get<string | null>('selection').write('node-7')

    await manager.replaceFactory('timeline', { create: () => ({ version: 2 }) })
    const second = manager.getOrCreate('timeline', 'shared-editor')

    expect(second).not.toBe(first)
    expect(second.value).toMatchObject({ version: 2 })
    expect(second.states.get('selection').read()).toBe('node-7')
    expect(disposeFirst).toHaveBeenCalledOnce()
  })

  it('disposes only runtimes owned by the removed Element', async () => {
    const timelineDispose = vi.fn()
    const propertiesDispose = vi.fn()
    const manager = runtimeManager()
    await manager.replaceFactory('timeline', { create: () => ({ dispose: timelineDispose }) })
    await manager.replaceFactory('properties', { create: () => ({ dispose: propertiesDispose }) })
    manager.getOrCreate('timeline', 'one')
    manager.getOrCreate('timeline', 'two')
    const properties = manager.getOrCreate('properties', 'one')

    await manager.removeElement('timeline')

    expect(timelineDispose).toHaveBeenCalledTimes(2)
    expect(propertiesDispose).not.toHaveBeenCalled()
    expect(manager.getOrCreate('properties', 'one')).toBe(properties)
  })

  it('rebinds a retained project State handle when the active project changes', async () => {
    let projectId = 'project-a'
    const dynamicHost: ElementHostApi = {
      ...host,
      getProjectId: () => projectId,
    }
    const states = new ElementStateRegistry()
    states.replaceOwner('editor', [
      { id: 'document', scope: 'project', initialValue: '' },
    ])
    const manager = new ElementRuntimeManager(
      states, dynamicHost, new ServiceRegistry(), new EventRegistry(),
    )
    await manager.replaceFactory('editor', null)
    const document = manager.getOrCreate('editor', 'shared').states.get<string>('document')
    document.write('project A')

    projectId = 'project-b'
    expect(document.read()).toBe('')
    document.write('project B')
    projectId = 'project-a'
    expect(document.read()).toBe('project A')
  })

  it('resolves the current Service provider at each Runtime capability call', async () => {
    const Example = defineService<{ read(): string }>('graphvideo.runtime-example')
    const services = new ServiceRegistry()
    services.replaceOwner('provider', [{
      id: Example.id, token: Example, value: { read: () => 'first' },
    }])
    const manager = runtimeManager(new ElementStateRegistry(), services)
    await manager.replaceFactory('consumer', {
      create: (context) => ({ read: () => context.services.get(Example).read() }),
    })
    const runtime = manager.getOrCreate('consumer', 'shared')
    const read = (runtime.value as { read(): string }).read
    expect(read()).toBe('first')

    services.replaceOwner('provider', [{
      id: Example.id, token: Example, value: { read: () => 'second' },
    }])
    expect(read()).toBe('second')
  })
})
