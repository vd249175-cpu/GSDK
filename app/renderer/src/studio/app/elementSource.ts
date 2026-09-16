import type { ClientStateStore } from '../client/state/clientStateStore'
import {
  ElementLoader, createWorkspaceRuntime, parseWorkspaceDefinition,
  loadActiveWorkspacePreference, loadWorkspaceDefault,
  type ElementCandidate, type ElementModule,
  type ElementSourceCatalog, type SourceElementDescriptor, type SourcePluginDescriptor,
  type PluginRuntimeManager,
} from '@graphvideo/workbench'

interface ElementSourceSnapshot {
  refreshing: boolean
  error: string
}

const pluginElementModules = import.meta.glob<{ default?: ElementModule; register?: ElementModule['register'] }>(
  '../../../../plugins/*/elements/*/element.ts',
)

function toCandidate(descriptor: SourceElementDescriptor): ElementCandidate {
  return {
    owner: descriptor.elementId,
    manifestText: descriptor.manifestText,
    version: descriptor.version,
    async load() {
      const key = `../../../../plugins/${descriptor.pluginId}/elements/${descriptor.elementId}/element.ts`
      const loadModule = pluginElementModules[key]
      if (!loadModule) throw new Error(`Element 模块未进入应用构建: ${descriptor.elementId} (Plugin: ${descriptor.pluginId})`)
      const exports = await loadModule()
      return (exports.default ?? exports) as ElementModule
    },
  }
}

export class DesktopElementSource {
  private loader: ElementLoader | null = null
  private pluginRuntime: PluginRuntimeManager | null = null
  private state: ClientStateStore | null = null
  private readonly workspaceVersions = new Map<string, string>()
  private readonly plugins = new Map<string, SourcePluginDescriptor>()
  private catalogApplied = false
  private readonly listeners = new Set<() => void>()
  private snapshot: ElementSourceSnapshot = { refreshing: false, error: '' }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.snapshot

  async start(loader: ElementLoader, state: ClientStateStore, pluginRuntime: PluginRuntimeManager) {
    this.loader = loader
    this.state = state
    this.pluginRuntime = pluginRuntime
    const bridge = window.graphvideoDesktop?.elements
    if (!bridge) return
    await this.apply(await bridge.list())
  }

  async refresh() {
    const bridge = window.graphvideoDesktop?.elements
    if (!bridge || !this.loader || !this.state || this.snapshot.refreshing) return
    this.setSnapshot({ refreshing: true, error: '' })
    try {
      await this.apply(await bridge.refresh())
      this.setSnapshot({ refreshing: false, error: '' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '组件刷新失败'
      this.loader.reportError(message)
      this.setSnapshot({ refreshing: false, error: message })
    }
  }

  private async apply(catalog: ElementSourceCatalog) {
    if (!this.loader || !this.state || !this.pluginRuntime) return
    const nextPlugins = new Map(catalog.plugins.map((plugin) => [plugin.pluginId, plugin]))
    if (this.catalogApplied && this.backendCompositionChanged(nextPlugins)) {
      throw new Error('Backend Plugin 已变更；为保持唯一 StudioRuntime，请重建并重启应用后生效')
    }
    const parsedWorkspaces = catalog.workspaces.map((descriptor) => ({
      descriptor,
      definition: parseWorkspaceDefinition(descriptor.workspaceId, descriptor.definitionText),
    })).sort((left, right) => (
      left.definition.order - right.definition.order
      || left.definition.id.localeCompare(right.definition.id)
    ))

    for (const previous of this.plugins.values()) {
      if (nextPlugins.has(previous.pluginId)) continue
      await this.pluginRuntime.uninstall({
        id: previous.pluginId,
        contributes: { elements: previous.elements, workspaces: previous.workspaces },
      })
    }
    await this.loader.reconcile(catalog.elements.map(toCandidate))
    const descriptors = new Map(parsedWorkspaces.map((item) => [item.definition.id, item]))
    const preferredWorkspaceId = loadActiveWorkspacePreference()
    const current = this.state.read()
    const items = Object.fromEntries(parsedWorkspaces.map(({ descriptor, definition }) => {
      const existing = current.workspace.items[definition.id]
      const unchanged = existing && this.workspaceVersions.get(definition.id) === descriptor.version
      if (unchanged) return [definition.id, existing]
      const runtime = createWorkspaceRuntime(definition)
      const savedDefault = loadWorkspaceDefault(definition.id)
      return [definition.id, savedDefault ? {
        ...runtime,
        layout: savedDefault.layout,
        focusedAreaId: savedDefault.focusedAreaId,
      } : runtime]
    }))
    const activeWorkspaceId = descriptors.has(current.workspace.activeWorkspaceId)
      ? current.workspace.activeWorkspaceId
      : preferredWorkspaceId && descriptors.has(preferredWorkspaceId)
        ? preferredWorkspaceId
        : parsedWorkspaces[0]?.definition.id ?? ''
    this.state.replaceWorkspaces({ activeWorkspaceId, items })
    this.workspaceVersions.clear()
    parsedWorkspaces.forEach(({ descriptor }) => (
      this.workspaceVersions.set(descriptor.workspaceId, descriptor.version)
    ))
    this.plugins.clear()
    nextPlugins.forEach((plugin, pluginId) => this.plugins.set(pluginId, plugin))
    this.catalogApplied = true
  }

  private backendCompositionChanged(next: Map<string, SourcePluginDescriptor>) {
    const ids = new Set([...this.plugins.keys(), ...next.keys()])
    for (const pluginId of ids) {
      const before = this.plugins.get(pluginId)
      const after = next.get(pluginId)
      if (!(before?.hasBackend || after?.hasBackend)) continue
      if (!before || !after || before.version !== after.version || before.hasBackend !== after.hasBackend) return true
    }
    return false
  }

  private setSnapshot(snapshot: ElementSourceSnapshot) {
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener())
  }
}

export const desktopElementSource = new DesktopElementSource()
