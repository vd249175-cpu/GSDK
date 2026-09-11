import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../commands/commandRegistry'
import { ExtensionRegistry } from '../registry/extensionRegistry'
import { EventRegistry, defineEvent } from '../registry/eventRegistry'
import { PanelRegistry } from '../registry/panelRegistry'
import { ServiceRegistry, defineService } from '../registry/serviceRegistry'
import { ElementStateRegistry } from '../registry/stateRegistry'
import { WorkbenchContextStore } from '../context/workbenchContextStore'
import { defineWorkbenchContext } from '../context/types'
import { ElementRuntimeManager } from '../elements/runtimeManager'
import { ElementLoader } from '../elements/elementLoader'
import { PluginRuntimeManager } from './pluginManager'

describe('PluginRuntimeManager Full Lifecycle Acceptance', () => {
  it('executes the renderer uninstall pipeline and waits for runtime disposal', async () => {
    const panels = new PanelRegistry()
    const extensions = new ExtensionRegistry()
    const commands = new CommandRegistry()
    const states = new ElementStateRegistry()
    const events = new EventRegistry()
    const services = new ServiceRegistry()
    const contexts = new WorkbenchContextStore()
    const host = {
      getProjectId: () => 'proj-1',
      executeCommand: (id: string, payload: unknown) => commands.execute(id, payload),
    }
    const runtimes = new ElementRuntimeManager(states, host, services, events, contexts)
    const elementLoader = new ElementLoader({
      panels,
      extensions,
      commands,
      states,
      events,
      services,
      runtimes,
      host,
      contexts,
    })

    const pluginManager = new PluginRuntimeManager({
      contextStore: contexts,
      elementLoader,
    })

    // 1. 模拟 ElementLoader 加载插件前端 Element
    const testToken = defineWorkbenchContext<string>('test.element/msg', {
      scope: 'project',
      initialValue: 'init',
    })
    const contextHandle = contexts.get(testToken, { projectId: 'proj-1' })
    contextHandle.write('active')
    let releaseDisposal!: () => void
    const disposalGate = new Promise<void>((resolve) => { releaseDisposal = resolve })
    let disposed = false
    let notificationCount = 0
    let commandRuns = 0
    const event = defineEvent<void>('test.element/changed')
    const service = defineService<{ value: string }>('test.element.service')

    await elementLoader.reconcile([
      {
        owner: 'test.element',
        manifestText: JSON.stringify({
          id: 'test.element',
          name: 'Test Element',
          apiVersion: 1,
          entry: 'element.ts',
        }),
        version: '1.0.0',
        load: async () => ({
          register(ctx) {
            ctx.panels.register({
              id: 'test.element.panel',
              title: 'Test Panel',
              icon: () => null,
              component: () => null,
            })
            ctx.commands.register('test.element.command', () => { commandRuns += 1 })
            ctx.services.provide(service, { value: 'active' })
            ctx.events.on(event, () => { notificationCount += 1 })
            ctx.runtime.define({ create(runtimeContext) {
              runtimeContext.onDispose(async () => {
                await disposalGate
                disposed = true
              })
              return {}
            } })
          },
        }),
      },
    ])

    expect(panels.get('test.element.panel')).toBeDefined()
    commands.execute('test.element.command', undefined)
    expect(commandRuns).toBe(1)
    expect(contextHandle.read()).toBe('active')
    runtimes.getOrCreate('test.element', 'instance')
    events.emit(event, undefined)
    expect(notificationCount).toBe(1)

    // 2. 执行完整的生产卸载管线
    const uninstall = pluginManager.uninstall({
      id: 'test.plugin',
      contributes: {
        elements: ['test.element'],
        workspaces: [],
      },
    })
    expect(disposed).toBe(false)
    expect(contextHandle.read()).toBe('active')
    releaseDisposal()
    await uninstall
    expect(disposed).toBe(true)

    // 3. 验证卸载后：前端面板、命令注销，Context 重置
    expect(panels.get('test.element.panel')).toBeUndefined()
    expect(() => commands.execute('test.element.command', undefined)).toThrow()
    expect(contextHandle.read()).toBe('init')
    expect(services.get(service)).toBeUndefined()
    events.emit(event, undefined)
    expect(notificationCount).toBe(1)

    const replacementToken = defineWorkbenchContext('test.element/msg', {
      scope: 'project', initialValue: 'replacement-default',
    })
    expect(contexts.get(replacementToken, { projectId: 'proj-1' }).read()).toBe('replacement-default')

    // 4. 验证同版本重新安装无冲突
    await elementLoader.reconcile([
      {
        owner: 'test.element',
        manifestText: JSON.stringify({
          id: 'test.element',
          name: 'Test Element',
          apiVersion: 1,
          entry: 'element.ts',
        }),
        version: '1.0.0',
        load: async () => ({
          register(ctx) {
            ctx.panels.register({
              id: 'test.element.panel',
              title: 'Test Panel',
              icon: () => null,
              component: () => null,
            })
          },
        }),
      },
    ])
    expect(panels.get('test.element.panel')).toBeDefined()
  })
})
