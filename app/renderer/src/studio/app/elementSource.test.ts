import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopElementSource } from './elementSource'
import { ClientStateStore } from '../client/state/clientStateStore'
import {
  ElementLoader, PluginRuntimeManager, ElementRuntimeManager,
  WorkbenchContextStore, defineWorkbenchContext, CommandRegistry,
  PanelRegistry, ExtensionRegistry, EventRegistry, ServiceRegistry,
  ElementStateRegistry, type ElementSourceCatalog,
} from '@graphvideo/workbench'

function catalog(plugins: ElementSourceCatalog['plugins']): ElementSourceCatalog {
  return { elements: [], workspaces: [], plugins }
}

const originalBridge = window.graphvideoDesktop
afterEach(() => { window.graphvideoDesktop = originalBridge })

describe('DesktopElementSource plugin lifecycle', () => {
  it('removes a loaded panel and its private context through the real refresh pipeline', async () => {
    const panels = new PanelRegistry()
    const contexts = new WorkbenchContextStore()
    const states = new ElementStateRegistry()
    const services = new ServiceRegistry()
    const events = new EventRegistry()
    const host = { getProjectId: () => 'project', executeCommand: () => undefined }
    const loader = new ElementLoader({
      panels, contexts, states, services, events, host,
      commands: new CommandRegistry(), extensions: new ExtensionRegistry(),
      runtimes: new ElementRuntimeManager(states, host, services, events, contexts),
    })
    const manifestText = JSON.stringify({ id: 'review.panel', name: 'Panel', apiVersion: 1, entry: 'element.ts' })
    // Seed a loaded bundled module; matching catalog versions do not re-import it.
    await loader.reconcile([{
      owner: 'review.panel', manifestText, version: 'one',
      load: () => ({ register(ctx) {
        ctx.panels.register({ id: 'review.panel', title: 'Panel', component: () => null, icon: () => null })
      } }),
    }])
    const token = defineWorkbenchContext('review.frontend/draft', {
      scope: 'application', initialValue: 'default',
    })
    contexts.get(token).write('active')
    let current: ElementSourceCatalog = {
      elements: [{ elementId: 'review.panel', pluginId: 'review.frontend', version: 'one', manifestText }],
      workspaces: [],
      plugins: [{ pluginId: 'review.frontend', version: 'one', hasBackend: false, elements: ['review.panel'], workspaces: [] }],
    }
    window.graphvideoDesktop = {
      elements: { list: async () => current, refresh: async () => current },
    } as typeof window.graphvideoDesktop
    const source = new DesktopElementSource()
    await source.start(loader, new ClientStateStore(), new PluginRuntimeManager({
      elementLoader: loader, contextStore: contexts,
    }))
    expect(panels.get('review.panel')).toBeDefined()
    current = catalog([])
    await source.refresh()
    expect(panels.get('review.panel')).toBeUndefined()
    expect(loader.listLoaded()).toHaveLength(0)
    expect(contexts.get(token).read()).toBe('default')
    expect(source.getSnapshot().error).toBe('')
  })

  it('routes a production catalog removal through the plugin runtime manager', async () => {
    const first = catalog([{
      pluginId: 'review.frontend', version: 'one', hasBackend: false,
      elements: ['review.panel'], workspaces: ['review.workspace'],
    }])
    const second = catalog([])
    let current = first
    window.graphvideoDesktop = {
      elements: { list: async () => current, refresh: async () => current },
    } as typeof window.graphvideoDesktop
    const source = new DesktopElementSource()
    const loader = {
      reconcile: vi.fn(async () => undefined), reportError: vi.fn(),
    } as unknown as ElementLoader
    const plugins = { uninstall: vi.fn(async () => undefined) } as unknown as PluginRuntimeManager

    await source.start(loader, new ClientStateStore(), plugins)
    current = second
    await source.refresh()

    expect(plugins.uninstall).toHaveBeenCalledWith({
      id: 'review.frontend',
      contributes: { elements: ['review.panel'], workspaces: ['review.workspace'] },
    })
    expect(source.getSnapshot().error).toBe('')
  })

  it('keeps the running frontend intact when a backend composition changes', async () => {
    let current = catalog([{
      pluginId: 'review.backend', version: 'one', hasBackend: true,
      elements: ['review.panel'], workspaces: [],
    }])
    window.graphvideoDesktop = {
      elements: { list: async () => current, refresh: async () => current },
    } as typeof window.graphvideoDesktop
    const source = new DesktopElementSource()
    const loader = {
      reconcile: vi.fn(async () => undefined), reportError: vi.fn(),
    } as unknown as ElementLoader
    const plugins = { uninstall: vi.fn(async () => undefined) } as unknown as PluginRuntimeManager
    await source.start(loader, new ClientStateStore(), plugins)
    current = catalog([])

    await source.refresh()

    expect(plugins.uninstall).not.toHaveBeenCalled()
    expect(loader.reconcile).toHaveBeenCalledTimes(1)
    expect(source.getSnapshot().error).toContain('重建并重启')
  })

  it('also rejects backend installation into an initially empty catalog', async () => {
    let current = catalog([])
    window.graphvideoDesktop = {
      elements: { list: async () => current, refresh: async () => current },
    } as typeof window.graphvideoDesktop
    const source = new DesktopElementSource()
    const loader = {
      reconcile: vi.fn(async () => undefined), reportError: vi.fn(),
    } as unknown as ElementLoader
    const plugins = { uninstall: vi.fn(async () => undefined) } as unknown as PluginRuntimeManager
    await source.start(loader, new ClientStateStore(), plugins)
    current = catalog([{
      pluginId: 'new.backend', version: 'one', hasBackend: true, elements: [], workspaces: [],
    }])
    await source.refresh()
    expect(source.getSnapshot().error).toContain('重建并重启')
    expect(loader.reconcile).toHaveBeenCalledTimes(1)
  })

  it('loads real studio plugin from disk and registers all panels and workspaces', async () => {
    const { ElementCatalog } = await import('../../electron/element-catalog.mjs')
    const { resolve } = await import('node:path')
    const pluginsRoot = resolve(__dirname, '../../../plugins')
    const catalogStore = new ElementCatalog({ pluginsRoot })
    const realCatalog = await catalogStore.scan()

    expect(realCatalog.plugins.length).toBeGreaterThanOrEqual(1)
    expect(realCatalog.plugins.some((p) => p.pluginId === 'graphvideo.studio')).toBe(true)
    expect(realCatalog.elements.length).toBeGreaterThanOrEqual(6)
    expect(realCatalog.workspaces.length).toBeGreaterThanOrEqual(4)

    const panels = new PanelRegistry()
    const contexts = new WorkbenchContextStore()
    const states = new ElementStateRegistry()
    const services = new ServiceRegistry()
    const events = new EventRegistry()
    const host = { getProjectId: () => 'project', executeCommand: () => undefined }
    const application = {} as any
    const loader = new ElementLoader({
      panels, contexts, states, services, events, host, application,
      commands: new CommandRegistry(), extensions: new ExtensionRegistry(),
      runtimes: new ElementRuntimeManager(states, host, services, events, contexts),
    })
    const clientState = new ClientStateStore()
    const plugins = new PluginRuntimeManager({
      elementLoader: loader, contextStore: contexts,
    })

    window.graphvideoDesktop = {
      elements: { list: async () => realCatalog, refresh: async () => realCatalog },
    } as typeof window.graphvideoDesktop

    const source = new DesktopElementSource()
    await source.start(loader, clientState, plugins)

    expect(loader.listLoaded().length).toBeGreaterThanOrEqual(6)
    expect(panels.get('generation')).toBeDefined()
    expect(panels.get('properties')).toBeDefined()
    expect(panels.get('markdown-editor')).toBeDefined()
    expect(panels.get('outliner')).toBeDefined()
    expect(panels.get('agent-console')).toBeDefined()
    expect(panels.get('prompt-library')).toBeDefined()
    expect(panels.get('style-probe')).toBeDefined()

    const loadedWorkspaces = clientState.read().workspace.items
    expect(loadedWorkspaces['agent']).toBeDefined()
    expect(loadedWorkspaces['editing']).toBeDefined()
    expect(loadedWorkspaces['generation']).toBeDefined()
    expect(loadedWorkspaces['style-probe']).toBeDefined()
    expect(loadedWorkspaces['review']).toBeDefined()
    expect(source.getSnapshot().error).toBe('')
    expect(loader.listErrors()).toHaveLength(0)
  })
})
