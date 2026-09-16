import type { ElementStateRegistry } from '../registry/stateRegistry'
import type { EventRegistry } from '../registry/eventRegistry'
import type { ServiceRegistry } from '../registry/serviceRegistry'
import type {
  ElementDispose, ElementHostApi, ElementRuntimeFactory, ElementRuntimeHandle,
  ElementRuntimeValue,
} from './types'
import { WorkbenchContextStore } from '../context/workbenchContextStore'
import { disposeReverse } from './dispose'

interface RuntimeEntry {
  handle: ElementRuntimeHandle
  dispose: ElementDispose
}

export class ElementRuntimeManager {
  private readonly factories = new Map<string, ElementRuntimeFactory | null>()
  private readonly instances = new Map<string, RuntimeEntry>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private readonly pendingCleanups = new Set<Promise<void>>()

  constructor(
    private readonly states: ElementStateRegistry,
    private readonly host: ElementHostApi,
    private readonly services: ServiceRegistry,
    private readonly events: EventRegistry,
    private readonly contexts: WorkbenchContextStore = new WorkbenchContextStore(),
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.version

  getOrCreate(elementId: string, instanceId: string) {
    const key = this.key(elementId, instanceId)
    const existing = this.instances.get(key)
    if (existing) return existing.handle
    if (!this.factories.has(elementId)) throw new Error(`Element Runtime 未注册: ${elementId}`)
    const entry = this.createEntry(elementId, instanceId, this.factories.get(elementId) ?? null)
    this.instances.set(key, entry)
    return entry.handle
  }

  async replaceFactory(elementId: string, factory: ElementRuntimeFactory | null) {
    const current = [...this.instances.entries()].filter(([key]) => key.startsWith(`${elementId}:`))
    const staged = new Map<string, RuntimeEntry>()
    try {
      for (const [key, entry] of current) {
        staged.set(key, this.createEntry(elementId, entry.handle.instanceId, factory))
      }
    } catch (error) {
      await Promise.allSettled([...staged.values()].map((entry) => entry.dispose()))
      await Promise.all(this.pendingCleanups)
      throw error
    }
    this.factories.set(elementId, factory)
    staged.forEach((entry, key) => this.instances.set(key, entry))
    this.emit()
    await Promise.allSettled(current.map(([, entry]) => entry.dispose()))
  }

  async removeElement(elementId: string) {
    this.factories.delete(elementId)
    const removed: RuntimeEntry[] = []
    for (const [key, entry] of [...this.instances]) {
      if (!key.startsWith(`${elementId}:`)) continue
      this.instances.delete(key)
      removed.push(entry)
    }
    this.emit()
    await Promise.allSettled(removed.map((entry) => entry.dispose()))
    await Promise.all(this.pendingCleanups)
  }

  async disposeAll() {
    this.factories.clear()
    const entries = [...this.instances.values()]
    this.instances.clear()
    this.emit()
    await Promise.allSettled(entries.map((entry) => entry.dispose()))
    await Promise.all(this.pendingCleanups)
  }

  listInstances() {
    return [...this.instances.values()].map((entry) => entry.handle)
  }

  private createEntry(
    elementId: string,
    instanceId: string,
    factory: ElementRuntimeFactory | null,
  ): RuntimeEntry {
    const views = new Set<string>()
    const disposers: ElementDispose[] = []
    const states = {
      get: <T>(
        stateId: string,
        binding: { projectId?: string | null; workspaceId?: string } = {},
      ) => {
        const bind = () => this.states.bind<T>(elementId, stateId, {
          projectId: 'projectId' in binding ? binding.projectId : this.host.getProjectId(),
          workspaceId: binding.workspaceId,
          instanceId,
        })
        return {
          read: () => bind().read(),
          write: (value: T | ((current: T) => T)) => bind().write(value),
          subscribe: (listener: () => void) => bind().subscribe(listener),
        }
      },
    }
    let value: ElementRuntimeValue
    try {
      value = factory?.create({
        elementId,
        instanceId,
        host: this.host,
        events: { emit: (event, payload) => this.events.emit(event, payload) },
        services: {
          get: (token) => this.services.require(token),
          has: (token) => this.services.has(token),
        },
        states,
        contexts: {
          get: (token, binding = {}) => this.contexts.get(token, {
            ...binding,
            projectId: 'projectId' in binding ? binding.projectId : this.host.getProjectId(),
            instanceId: binding.instanceId ?? instanceId,
          }),
        },
        onDispose: (dispose) => disposers.push(dispose),
      }) ?? {}
    } catch (error) {
      const cleanup = disposeReverse(disposers)
      this.pendingCleanups.add(cleanup)
      void cleanup.finally(() => this.pendingCleanups.delete(cleanup))
      throw error
    }
    const runtimeValue = value as ElementRuntimeValue
    if (runtimeValue.dispose) disposers.push(() => runtimeValue.dispose!())
    const handle: ElementRuntimeHandle = {
      elementId,
      instanceId,
      value: runtimeValue,
      states,
      attach: (viewId) => views.add(viewId),
      detach: (viewId) => views.delete(viewId),
    }
    return {
      handle,
      dispose: async () => {
        await disposeReverse(disposers)
        views.clear()
      },
    }
  }

  private key(elementId: string, instanceId: string) {
    return `${elementId}:${instanceId}`
  }

  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}
