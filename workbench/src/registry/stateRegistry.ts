import type {
  ElementStateBinding, ElementStateDefinition, ElementStateHandle,
} from '../elements/types'

interface StateDefinitionEntry {
  owner: string
  definition: ElementStateDefinition
}

interface StateCell<T = unknown> {
  value: T
  listeners: Set<() => void>
}

function cloneInitial<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

export class ElementStateRegistry {
  private readonly definitions = new Map<string, StateDefinitionEntry>()
  private readonly cells = new Map<string, StateCell>()

  assertCanReplace(owner: string, definitions: ElementStateDefinition[]) {
    const ids = new Set<string>()
    for (const definition of definitions) {
      if (!definition.id || ids.has(definition.id)) throw new Error(`State ID 重复: ${definition.id}`)
      ids.add(definition.id)
      const key = this.definitionKey(owner, definition.id)
      const existing = this.definitions.get(key)
      if (existing && existing.definition.scope !== definition.scope) {
        throw new Error(`State Scope 不允许热变更: ${definition.id}`)
      }
    }
  }

  replaceOwner(owner: string, definitions: ElementStateDefinition[]) {
    this.assertCanReplace(owner, definitions)
    this.unregisterOwner(owner)
    for (const definition of definitions) {
      this.definitions.set(this.definitionKey(owner, definition.id), { owner, definition })
    }
  }

  unregisterOwner(owner: string) {
    for (const [key, entry] of this.definitions) {
      if (entry.owner === owner) this.definitions.delete(key)
    }
  }

  bind<T>(owner: string, stateId: string, binding: ElementStateBinding): ElementStateHandle<T> {
    const entry = this.definitions.get(this.definitionKey(owner, stateId))
    if (!entry) throw new Error(`Unknown Element State: ${owner}.${stateId}`)
    const cellKey = this.cellKey(owner, entry.definition, binding)
    let cell = this.cells.get(cellKey) as StateCell<T> | undefined
    if (!cell) {
      cell = { value: cloneInitial(entry.definition.initialValue) as T, listeners: new Set() }
      this.cells.set(cellKey, cell as StateCell)
    }
    return {
      read: () => cell!.value,
      write: (value) => {
        cell!.value = typeof value === 'function'
          ? (value as (current: T) => T)(cell!.value)
          : value
        cell!.listeners.forEach((listener) => listener())
      },
      subscribe: (listener) => {
        cell!.listeners.add(listener)
        return () => cell!.listeners.delete(listener)
      },
    }
  }

  listDefinitions() {
    return [...this.definitions.values()].map(({ owner, definition }) => ({ owner, definition }))
  }

  getOwnerDefinitions(owner: string) {
    return [...this.definitions.values()]
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.definition)
  }

  private definitionKey(owner: string, stateId: string) {
    return `${owner}:${stateId}`
  }

  private cellKey(owner: string, definition: ElementStateDefinition, binding: ElementStateBinding) {
    const prefix = `${owner}:${definition.id}`
    if (definition.scope === 'application') return `application:${prefix}`
    if (definition.scope === 'project') return `project:${binding.projectId ?? 'no-project'}:${prefix}`
    if (definition.scope === 'workspace') {
      if (!binding.workspaceId) throw new Error(`State ${definition.id} 缺少 workspaceId`)
      return `workspace:${binding.workspaceId}:${prefix}`
    }
    if (!binding.instanceId) throw new Error(`State ${definition.id} 缺少 instanceId`)
    return `instance:${owner}:${binding.instanceId}:${definition.id}`
  }
}
