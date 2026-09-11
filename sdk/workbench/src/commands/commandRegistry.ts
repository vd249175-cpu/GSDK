export type CommandHandler<T = unknown> = (payload: T) => void | Promise<void>

export class CommandRegistry {
  private readonly handlers = new Map<string, { owner: string; handler: CommandHandler<any> }>()

  register<T>(id: string, handler: CommandHandler<T>, owner = 'core') {
    const existing = this.handlers.get(id)
    if (existing && existing.owner !== owner) {
      throw new Error(`Command ID conflict: ${id} (${existing.owner} / ${owner})`)
    }
    this.handlers.set(id, { owner, handler })
  }

  assertCanReplace(owner: string, entries: Array<{ id: string; handler: CommandHandler<any> }>) {
    const ids = new Set<string>()
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error(`Command ID conflict: ${entry.id} (${owner})`)
      ids.add(entry.id)
      const existing = this.handlers.get(entry.id)
      if (existing && existing.owner !== owner) {
        throw new Error(`Command ID conflict: ${entry.id} (${existing.owner} / ${owner})`)
      }
    }
  }

  replaceOwner(owner: string, entries: Array<{ id: string; handler: CommandHandler<any> }>) {
    this.assertCanReplace(owner, entries)
    this.unregisterOwner(owner)
    entries.forEach((entry) => this.handlers.set(entry.id, { owner, handler: entry.handler }))
  }

  unregisterOwner(owner: string) {
    for (const [id, entry] of this.handlers) {
      if (entry.owner === owner) this.handlers.delete(id)
    }
  }

  execute<T>(id: string, payload: T) {
    const entry = this.handlers.get(id)
    if (!entry) throw new Error(`Unknown command: ${id}`)
    return entry.handler(payload)
  }
}
