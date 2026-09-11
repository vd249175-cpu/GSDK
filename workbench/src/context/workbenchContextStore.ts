import type {
  WorkbenchContextBinding, WorkbenchContextHandle, WorkbenchContextToken,
} from './types'

interface ContextCell<T = unknown> {
  value: T
  initialValue: T
  listeners: Set<() => void>
}

function cloneInitial<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

/** Renderer-only shared interaction context. It never owns projected business facts. */
export class WorkbenchContextStore {
  private readonly cells = new Map<string, ContextCell>()

  private getOrCreateCell<T>(
    token: WorkbenchContextToken<T>,
    binding: WorkbenchContextBinding = {},
  ): ContextCell<T> {
    const key = this.cellKey(token, binding)
    let cell = this.cells.get(key) as ContextCell<T> | undefined
    if (!cell) {
      const initial = cloneInitial(token.initialValue)
      cell = {
        value: initial,
        initialValue: initial,
        listeners: new Set(),
      }
      this.cells.set(key, cell as ContextCell)
    }
    return cell
  }

  get<T>(
    token: WorkbenchContextToken<T>,
    binding: WorkbenchContextBinding = {},
  ): WorkbenchContextHandle<T> {
    const cell = this.getOrCreateCell(token, binding)
    return {
      read: () => cell.value,
      write: (value) => {
        const next = typeof value === 'function'
          ? (value as (current: T) => T)(cell.value)
          : value
        if (Object.is(next, cell.value)) return
        cell.value = next
        cell.listeners.forEach((listener) => listener())
      },
      subscribe: (listener) => {
        cell.listeners.add(listener)
        return () => cell.listeners.delete(listener)
      },
    }
  }

  purgeNamespace(namespace: string) {
    const prefix = `${namespace}/`
    const colonPrefix = `${namespace}:`
    for (const [key, cell] of this.cells.entries()) {
      const tokenId = key.slice(key.lastIndexOf(':') + 1)
      if (tokenId === namespace || tokenId.startsWith(prefix) || tokenId.startsWith(colonPrefix)) {
        const nextValue = cloneInitial(cell.initialValue)
        if (!Object.is(nextValue, cell.value)) {
          cell.value = nextValue
          cell.listeners.forEach((listener) => listener())
        }
      }
    }
  }

  clearPluginContexts(
    pluginOrManifest: string | { id: string; contributes?: { elements?: readonly string[]; workspaces?: readonly string[] } },
  ) {
    if (typeof pluginOrManifest === 'string') {
      this.purgeNamespace(pluginOrManifest)
      return
    }

    const namespaces = new Set<string>()
    if (pluginOrManifest.id) {
      namespaces.add(pluginOrManifest.id)
    }
    if (pluginOrManifest.contributes?.elements) {
      for (const elementId of pluginOrManifest.contributes.elements) {
        namespaces.add(elementId)
      }
    }
    if (pluginOrManifest.contributes?.workspaces) {
      for (const workspaceId of pluginOrManifest.contributes.workspaces) {
        namespaces.add(workspaceId)
      }
    }

    for (const ns of namespaces) {
      this.purgeNamespace(ns)
    }
  }

  /** Final plugin teardown: notify mounted consumers, then release cells for clean reinstallation. */
  disposePluginContexts(
    manifest: { id: string; contributes?: { elements?: readonly string[]; workspaces?: readonly string[] } },
  ) {
    const namespaces = new Set([
      manifest.id,
      ...(manifest.contributes?.elements ?? []),
      ...(manifest.contributes?.workspaces ?? []),
    ])
    for (const [key, cell] of [...this.cells]) {
      const tokenId = key.slice(key.lastIndexOf(':') + 1)
      const owned = [...namespaces].some((namespace) => (
        tokenId === namespace
        || tokenId.startsWith(`${namespace}/`)
        || tokenId.startsWith(`${namespace}:`)
      ))
      if (!owned) continue
      cell.value = cloneInitial(cell.initialValue)
      cell.listeners.forEach((listener) => listener())
      cell.listeners.clear()
      this.cells.delete(key)
    }
  }

  clearScope(scope: 'workspace' | 'instance' | 'project', id: string) {
    const prefix = `${scope}:${id}:`
    for (const [key, cell] of this.cells.entries()) {
      if (key.startsWith(prefix)) {
        const nextValue = cloneInitial(cell.initialValue)
        if (!Object.is(nextValue, cell.value)) {
          cell.value = nextValue
          cell.listeners.forEach((listener) => listener())
        }
      }
    }
  }

  clearAll() {
    for (const cell of this.cells.values()) {
      const nextValue = cloneInitial(cell.initialValue)
      if (!Object.is(nextValue, cell.value)) {
        cell.value = nextValue
        cell.listeners.forEach((listener) => listener())
      }
    }
  }

  private cellKey<T>(token: WorkbenchContextToken<T>, binding: WorkbenchContextBinding) {
    if (token.scope === 'application') return `application:${token.id}`
    if (token.scope === 'project') return `project:${binding.projectId ?? 'no-project'}:${token.id}`
    if (token.scope === 'workspace') {
      if (!binding.workspaceId) throw new Error(`Context ${token.id} 缺少 workspaceId`)
      return `workspace:${binding.workspaceId}:${token.id}`
    }
    if (!binding.instanceId) throw new Error(`Context ${token.id} 缺少 instanceId`)
    return `instance:${binding.instanceId}:${token.id}`
  }
}
