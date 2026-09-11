import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../commands/commandRegistry'
import { ExtensionRegistry } from '../registry/extensionRegistry'
import { defineEvent, EventRegistry } from '../registry/eventRegistry'
import { PanelRegistry } from '../registry/panelRegistry'
import { defineService, ServiceRegistry } from '../registry/serviceRegistry'
import { ElementStateRegistry } from '../registry/stateRegistry'
import { ElementLoader } from './elementLoader'
import { ElementRuntimeManager } from './runtimeManager'
import type { ElementCandidate, ElementHostApi, ElementModule } from './types'

const EmptyComponent = () => null
const EmptyIcon = () => null
const host: ElementHostApi = {
  getProjectId: () => 'test-project',
  executeCommand: () => undefined,
}

function candidate(owner: string, version: string, module: ElementModule, id = owner): ElementCandidate {
  return {
    owner,
    version,
    manifestText: JSON.stringify({ id, name: id, apiVersion: 1, entry: 'element.ts' }),
    load: () => module,
  }
}

function testLoader() {
  const panels = new PanelRegistry()
  const extensions = new ExtensionRegistry()
  const commands = new CommandRegistry()
  const states = new ElementStateRegistry()
  const events = new EventRegistry()
  const services = new ServiceRegistry()
  const runtimes = new ElementRuntimeManager(states, host, services, events)
  const loader = new ElementLoader({
    panels, extensions, commands, states, events, services, runtimes, host,
  })
  return { loader, panels, extensions, commands, states, events, services, runtimes }
}

const ExampleService = defineService<{ value(): string }>('graphvideo.example')
const ChainedService = defineService<{ value(): string }>('graphvideo.chained-example')
const ExampleChanged = defineEvent<{ value: string }>('example/changed')

describe('Element loader', () => {
  it('cleans partially registered resources in reverse order even when a cleanup throws', async () => {
    const { loader } = testLoader()
    const disposed: string[] = []
    await loader.reconcile([candidate('broken', '1', {
      async register(context) {
        context.onDispose(() => { disposed.push('first') })
        context.onDispose(async () => { disposed.push('second'); throw new Error('cleanup failed') })
        throw new Error('registration failed')
      },
    })])
    expect(disposed).toEqual(['second', 'first'])
    expect(loader.listLoaded()).toHaveLength(0)
    expect(loader.listErrors()).toContain('registration failed')
  })

  it('continues all definition cleanup when an unload disposer rejects', async () => {
    const { loader } = testLoader()
    const disposed: string[] = []
    await loader.reconcile([candidate('cleanup', '1', { register(context) {
      context.onDispose(() => { disposed.push('first') })
      context.onDispose(async () => { disposed.push('second'); throw new Error('cleanup failed') })
    } })])
    await loader.unload('cleanup')
    await loader.unload('cleanup')
    expect(disposed).toEqual(['second', 'first'])
  })

  it('registers definitions and keeps session state cells when an Element is removed', async () => {
    const disposeDefinition = vi.fn()
    const disposeRuntime = vi.fn()
    const { loader, panels, extensions, commands, states, runtimes } = testLoader()
    const module: ElementModule = {
      register(context) {
        context.commands.register('tools.run', () => undefined)
        context.states.define({ id: 'selection', scope: 'instance', initialValue: '' })
        context.runtime.define({
          create(runtimeContext) {
            runtimeContext.onDispose(disposeRuntime)
            return { cache: new Map() }
          },
        })
        context.panels.register({ id: 'tools', title: 'Tools', icon: EmptyIcon, component: EmptyComponent })
        context.extensions.register({
          id: 'tools-header', point: 'panel:outliner:header', component: EmptyComponent,
        })
        context.onDispose(disposeDefinition)
      },
    }
    await loader.reconcile([candidate('tools', '1', module)])

    const runtime = runtimes.getOrCreate('tools', 'shared-tools')
    const selection = runtime.states.get<string>('selection')
    selection.write('first')
    expect(panels.get('tools')?.title).toBe('Tools')
    expect(extensions.list('panel:outliner:header')).toHaveLength(1)
    expect(commands.execute('tools.run', undefined)).toBeUndefined()

    await loader.reconcile([])
    expect(disposeDefinition).toHaveBeenCalledOnce()
    expect(disposeRuntime).toHaveBeenCalledOnce()
    expect(panels.get('tools')).toBeUndefined()
    expect(() => commands.execute('tools.run', undefined)).toThrow('Unknown command')
    expect(states.listDefinitions()).toHaveLength(0)

    await loader.reconcile([candidate('tools', '2', module)])
    expect(runtimes.getOrCreate('tools', 'shared-tools').states.get<string>('selection').read())
      .toBe('first')
  })

  it('hot replaces one owner and keeps the previous version if registration fails', async () => {
    const { loader, panels } = testLoader()
    const module = (title: string): ElementModule => ({
      register(context) {
        context.panels.register({ id: 'hot-panel', title, icon: EmptyIcon, component: EmptyComponent })
      },
    })
    await loader.reconcile([candidate('hot', '1', module('Version 1'))])
    await loader.reconcile([candidate('hot', '2', module('Version 2'))])
    expect(panels.get('hot-panel')?.title).toBe('Version 2')

    await loader.reconcile([candidate('hot', '3', {
      register() { throw new Error('broken update') },
    })])
    expect(panels.get('hot-panel')?.title).toBe('Version 2')
    expect(loader.listErrors()).toContain('broken update')
  })

  it('cleans a staged Element that conflicts without changing the active owner', async () => {
    const stagedDispose = vi.fn()
    const { loader, panels } = testLoader()
    const active = candidate('active', '1', {
      register(context) {
        context.panels.register({
          id: 'shared-panel', title: 'Active', icon: EmptyIcon, component: EmptyComponent,
        })
      },
    })
    await loader.reconcile([active])

    await loader.reconcile([active, candidate('conflict', '1', {
      register(context) {
        context.panels.register({
          id: 'shared-panel', title: 'Conflict', icon: EmptyIcon, component: EmptyComponent,
        })
        context.onDispose(stagedDispose)
      },
    })])

    expect(panels.get('shared-panel')?.title).toBe('Active')
    expect(stagedDispose).toHaveBeenCalledOnce()
    expect(loader.listErrors()[0]).toContain('Contribution ID conflict')
  })

  it('hot replaces and unloads Service providers with the Element owner', async () => {
    const { loader, services } = testLoader()
    const module = (value: string): ElementModule => ({
      register(context) {
        context.services.provide(ExampleService, { value: () => value })
      },
    })

    await loader.reconcile([candidate('provider', '1', module('first'))])
    expect(services.require(ExampleService).value()).toBe('first')

    await loader.reconcile([candidate('provider', '2', module('second'))])
    expect(services.require(ExampleService).value()).toBe('second')

    await loader.reconcile([])
    expect(services.get(ExampleService)).toBeUndefined()
  })

  it('restores the previous Service when Runtime reconstruction fails', async () => {
    const { loader, services, runtimes } = testLoader()
    const stable: ElementModule = {
      register(context) {
        context.services.provide(ExampleService, { value: () => 'stable' })
        context.runtime.define({ create: () => ({ version: 'stable' }) })
      },
    }
    await loader.reconcile([candidate('provider', '1', stable)])
    runtimes.getOrCreate('provider', 'shared')

    await loader.reconcile([candidate('provider', '2', {
      register(context) {
        context.services.provide(ExampleService, { value: () => 'broken' })
        context.runtime.define({ create: () => { throw new Error('runtime failed') } })
      },
    })])

    expect(services.require(ExampleService).value()).toBe('stable')
    expect(loader.listErrors()).toContain('runtime failed')
  })

  it('lets Commands and Providers resolve current capabilities when they execute', async () => {
    const { loader, commands, services } = testLoader()
    let commandValue = ''
    const consumer: ElementModule = {
      register(context) {
        context.services.provide(ChainedService, {
          value: () => `chained:${context.services.get(ExampleService).value()}`,
        })
        context.commands.register('consumer.run', () => {
          commandValue = context.services.get(ChainedService).value()
        })
      },
    }
    const provider = (value: string): ElementModule => ({
      register(context) {
        context.services.provide(ExampleService, { value: () => value })
      },
    })

    await loader.reconcile([
      candidate('consumer', '1', consumer),
      candidate('provider', '1', provider('first')),
    ])
    await commands.execute('consumer.run', undefined)
    expect(commandValue).toBe('chained:first')

    await loader.reconcile([
      candidate('consumer', '1', consumer),
      candidate('provider', '2', provider('second')),
    ])
    expect(services.require(ChainedService).value()).toBe('chained:second')
  })

  it('replaces and unloads notification listeners with the Element owner', async () => {
    const observed: string[] = []
    const { loader, events } = testLoader()
    const observer = (label: string): ElementModule => ({
      register(context) {
        context.events.on(ExampleChanged, ({ value }) => {
          observed.push(`${label}:${value}`)
        })
      },
    })

    await loader.reconcile([candidate('observer', '1', observer('first'))])
    events.emit(ExampleChanged, { value: 'one' })
    await loader.reconcile([candidate('observer', '2', observer('second'))])
    events.emit(ExampleChanged, { value: 'two' })
    await loader.reconcile([])
    events.emit(ExampleChanged, { value: 'three' })

    expect(observed).toEqual(['first:one', 'second:two'])
  })
})
