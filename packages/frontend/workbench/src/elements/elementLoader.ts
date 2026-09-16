import * as React from 'react'
import type { CommandHandler, CommandRegistry } from '../commands/commandRegistry'
import type { ExtensionRegistry } from '../registry/extensionRegistry'
import type { EventListenerDefinition, EventRegistry } from '../registry/eventRegistry'
import type { PanelRegistry } from '../registry/panelRegistry'
import type {
  ServiceProviderDefinition, ServiceRegistry,
} from '../registry/serviceRegistry'
import type { ElementStateRegistry } from '../registry/stateRegistry'
import { parseElementManifest } from './manifest'
import { disposeReverse } from './dispose'
import type { ElementRuntimeManager } from './runtimeManager'
import { WorkbenchContextStore } from '../context/workbenchContextStore'
import type {
  ElementCandidate, ElementDispose, ElementHostApi, ElementModule, ElementPackageManifest,
  ElementRuntimeFactory, ElementStateDefinition, ExtensionDefinition, PanelDefinition,
} from './types'

interface ElementLoaderRegistries {
  panels: PanelRegistry
  extensions: ExtensionRegistry
  commands: CommandRegistry
  states: ElementStateRegistry
  events: EventRegistry
  services: ServiceRegistry
  runtimes: ElementRuntimeManager
  host: ElementHostApi
  application?: unknown
  contexts?: WorkbenchContextStore
}

interface LoadedElement {
  owner: string
  manifest: ElementPackageManifest
  version: string
  module: ElementModule<any>
  disposeDefinition: ElementDispose
}

interface StagedElement {
  panels: PanelDefinition[]
  extensions: ExtensionDefinition[]
  commands: Array<{ id: string; handler: CommandHandler<any> }>
  states: ElementStateDefinition[]
  events: EventListenerDefinition<any>[]
  services: ServiceProviderDefinition<any>[]
  runtimeFactory: ElementRuntimeFactory | null
  disposeDefinition: ElementDispose
}

export class ElementLoader {
  private readonly loaded = new Map<string, LoadedElement>()
  private readonly listeners = new Set<() => void>()
  private errors: string[] = []
  private version = 0
  private readonly contexts: WorkbenchContextStore

  constructor(private readonly registries: ElementLoaderRegistries) {
    this.contexts = registries.contexts ?? new WorkbenchContextStore()
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.version
  listErrors() { return this.errors }
  listLoaded() {
    return [...this.loaded.values()].map(({ manifest, owner, version }) => ({ manifest, owner, version }))
  }

  async reconcile(candidates: ElementCandidate[]) {
    const desiredOwners = new Set(candidates.map((candidate) => candidate.owner))
    const errors: string[] = []
    for (const candidate of candidates) {
      const existing = this.loaded.get(candidate.owner)
      if (existing?.version === candidate.version) continue
      try {
        await this.load(candidate)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `无法加载 ${candidate.owner}`)
      }
    }
    for (const loaded of [...this.loaded.values()]) {
      if (!desiredOwners.has(loaded.owner)) await this.unload(loaded.owner)
    }
    this.errors = errors
    this.emit()
  }

  reportError(error: string) {
    this.errors = [error]
    this.emit()
  }

  async unload(owner: string) {
    const loaded = this.loaded.get(owner)
    if (!loaded) return
    this.loaded.delete(owner)
    this.registries.panels.unregisterOwner(owner)
    this.registries.extensions.unregisterOwner(owner)
    this.registries.commands.unregisterOwner(owner)
    await this.registries.runtimes.removeElement(owner)
    this.registries.services.unregisterOwner(owner)
    this.registries.events.unregisterOwner(owner)
    this.registries.states.unregisterOwner(owner)
    await Promise.allSettled([Promise.resolve().then(loaded.disposeDefinition)])
    this.emit()
  }

  private async load(candidate: ElementCandidate) {
    const manifest = parseElementManifest(candidate.manifestText)
    if (candidate.owner !== manifest.id) {
      throw new Error(`Element 目录名与 Manifest ID 不一致: ${candidate.owner} / ${manifest.id}`)
    }
    const module = await candidate.load(manifest)
    if (!module || typeof module.register !== 'function') {
      throw new Error(`Element ${manifest.id} 未导出 register(context)`)
    }
    const staged = await this.stage(manifest, module)
    try {
      this.registries.panels.assertCanReplace(manifest.id, staged.panels)
      this.registries.extensions.assertCanReplace(manifest.id, staged.extensions)
      this.registries.commands.assertCanReplace(manifest.id, staged.commands)
      this.registries.states.assertCanReplace(manifest.id, staged.states)
      this.registries.services.assertCanReplace(manifest.id, staged.services)
    } catch (error) {
      await Promise.allSettled([Promise.resolve().then(staged.disposeDefinition)])
      throw error
    }

    const previous = this.loaded.get(manifest.id)
    const previousStates = this.registries.states.getOwnerDefinitions(manifest.id)
    const previousServices = this.registries.services.getOwnerDefinitions(manifest.id)
    this.registries.states.replaceOwner(manifest.id, staged.states)
    this.registries.services.replaceOwner(manifest.id, staged.services)
    try {
      await this.registries.runtimes.replaceFactory(manifest.id, staged.runtimeFactory)
    } catch (error) {
      this.registries.states.replaceOwner(manifest.id, previousStates)
      this.registries.services.replaceOwner(manifest.id, previousServices)
      await Promise.allSettled([Promise.resolve().then(staged.disposeDefinition)])
      throw error
    }
    this.registries.panels.replaceOwner(manifest.id, staged.panels)
    this.registries.extensions.replaceOwner(manifest.id, staged.extensions)
    this.registries.commands.replaceOwner(manifest.id, staged.commands)
    this.registries.events.replaceOwner(manifest.id, staged.events)
    this.loaded.set(manifest.id, {
      owner: manifest.id,
      manifest,
      version: candidate.version,
      module,
      disposeDefinition: staged.disposeDefinition,
    })
    if (previous) await Promise.allSettled([Promise.resolve().then(previous.disposeDefinition)])
  }

  private async stage(manifest: ElementPackageManifest, module: ElementModule): Promise<StagedElement> {
    const panels: PanelDefinition[] = []
    const extensions: ExtensionDefinition[] = []
    const commands: Array<{ id: string; handler: CommandHandler<any> }> = []
    const states: ElementStateDefinition[] = []
    const events: EventListenerDefinition<any>[] = []
    const services: ServiceProviderDefinition<any>[] = []
    const disposers: ElementDispose[] = []
    let runtimeFactory: ElementRuntimeFactory | null = null
    try {
      const moduleDispose = await module.register({
        manifest,
        react: React,
        host: this.registries.host,
        application: this.registries.application,
        events: {
          on: (event, listener) => events.push({ event, listener }),
          emit: (event, payload) => this.registries.events.emit(event, payload),
        },
        services: {
          provide: (token, provider) => services.push({ id: token.id, token, value: provider }),
          get: (token) => this.registries.services.require(token),
          has: (token) => this.registries.services.has(token),
        },
        contexts: {
          get: (token, binding = {}) => this.contexts.get(token, {
            ...binding,
            projectId: 'projectId' in binding ? binding.projectId : this.registries.host.getProjectId(),
          }),
        },
        panels: { register: (panel) => panels.push(panel) },
        extensions: { register: (extension) => extensions.push(extension) },
        commands: { register: (id, handler) => commands.push({ id, handler }) },
        states: { define: (state) => states.push(state) },
        runtime: {
          define: (factory) => {
            if (runtimeFactory) throw new Error(`Element ${manifest.id} 只能定义一个 Runtime Factory`)
            runtimeFactory = factory
          },
        },
        onDispose: (dispose) => disposers.push(dispose),
      })
      if (moduleDispose) disposers.push(moduleDispose)
    } catch (error) {
      await disposeReverse(disposers)
      throw error
    }
    return {
      panels,
      extensions,
      commands,
      states,
      events,
      services,
      runtimeFactory,
      disposeDefinition: async () => {
        await disposeReverse(disposers)
      },
    }
  }

  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}
