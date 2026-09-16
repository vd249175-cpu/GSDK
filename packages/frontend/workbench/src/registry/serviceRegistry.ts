const serviceIdPattern = /^[a-z][a-z0-9.-]*$/

declare const serviceValue: unique symbol

export interface ServiceToken<T> {
  readonly id: string
  readonly [serviceValue]?: (value: T) => T
}

export interface ServiceProviderDefinition<T = unknown> {
  id: string
  token: ServiceToken<T>
  value: T
}

interface OwnedServiceProvider {
  owner: string
  definition: ServiceProviderDefinition<any>
}

export function defineService<T>(id: string): ServiceToken<T> {
  if (!serviceIdPattern.test(id)) throw new Error(`Service ID 无效: ${id}`)
  return Object.freeze({ id }) as ServiceToken<T>
}

export class ServiceRegistry {
  private readonly providers = new Map<string, OwnedServiceProvider>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.version

  assertCanReplace(owner: string, definitions: ServiceProviderDefinition<any>[]) {
    const ids = new Set<string>()
    for (const definition of definitions) {
      if (!serviceIdPattern.test(definition.id) || definition.id !== definition.token.id) {
        throw new Error(`Service ID 无效: ${definition.id}`)
      }
      if (ids.has(definition.id)) throw new Error(`Service ID 重复: ${definition.id} (${owner})`)
      ids.add(definition.id)
      const existing = this.providers.get(definition.id)
      if (existing && existing.owner !== owner) {
        throw new Error(`Service ID conflict: ${definition.id} (${existing.owner} / ${owner})`)
      }
    }
  }

  replaceOwner(owner: string, definitions: ServiceProviderDefinition<any>[]) {
    this.assertCanReplace(owner, definitions)
    let changed = false
    for (const [id, entry] of this.providers) {
      if (entry.owner !== owner) continue
      this.providers.delete(id)
      changed = true
    }
    for (const definition of definitions) {
      this.providers.set(definition.id, { owner, definition })
      changed = true
    }
    if (changed) this.emit()
  }

  unregisterOwner(owner: string) {
    let changed = false
    for (const [id, entry] of this.providers) {
      if (entry.owner !== owner) continue
      this.providers.delete(id)
      changed = true
    }
    if (changed) this.emit()
  }

  get<T>(token: ServiceToken<T>): T | undefined {
    return this.providers.get(token.id)?.definition.value as T | undefined
  }

  require<T>(token: ServiceToken<T>): T {
    const provider = this.get(token)
    if (!provider) throw new Error(`Service Provider 不可用: ${token.id}`)
    return provider
  }

  has<T>(token: ServiceToken<T>) {
    return this.providers.has(token.id)
  }

  getOwnerDefinitions(owner: string) {
    return [...this.providers.values()]
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.definition)
  }

  ownerOf<T>(token: ServiceToken<T>) {
    return this.providers.get(token.id)?.owner
  }

  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}
