export interface OwnedEntry<T> {
  owner: string
  value: T
}

export class OwnedRegistry<T extends { id: string }> {
  private readonly entries = new Map<string, OwnedEntry<T>>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.version

  register(owner: string, value: T) {
    const existing = this.entries.get(value.id)
    if (existing && existing.owner !== owner) {
      throw new Error(`Contribution ID conflict: ${value.id} (${existing.owner} / ${owner})`)
    }
    this.entries.set(value.id, { owner, value })
    this.emit()
  }

  assertCanReplace(owner: string, values: T[]) {
    const ids = new Set<string>()
    for (const value of values) {
      if (ids.has(value.id)) throw new Error(`Contribution ID conflict: ${value.id} (${owner})`)
      ids.add(value.id)
      const existing = this.entries.get(value.id)
      if (existing && existing.owner !== owner) {
        throw new Error(`Contribution ID conflict: ${value.id} (${existing.owner} / ${owner})`)
      }
    }
  }

  replaceOwner(owner: string, values: T[]) {
    this.assertCanReplace(owner, values)
    for (const [id, entry] of this.entries) {
      if (entry.owner === owner) this.entries.delete(id)
    }
    values.forEach((value) => this.entries.set(value.id, { owner, value }))
    this.emit()
  }

  unregisterOwner(owner: string) {
    let changed = false
    for (const [id, entry] of this.entries) {
      if (entry.owner !== owner) continue
      this.entries.delete(id)
      changed = true
    }
    if (changed) this.emit()
  }

  get(id: string) {
    return this.entries.get(id)?.value
  }

  list() {
    return [...this.entries.values()].map((entry) => entry.value)
  }

  ownerOf(id: string) {
    return this.entries.get(id)?.owner
  }

  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}
