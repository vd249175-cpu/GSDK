const eventIdPattern = /^[a-z][a-z0-9.-]*(\/[a-z][a-z0-9.-]*)+$/

declare const eventPayload: unique symbol

export interface EventToken<T> {
  readonly id: string
  readonly [eventPayload]?: (payload: T) => T
}

export type EventListener<T> = (payload: Readonly<T>) => void | Promise<void>

export interface EventListenerDefinition<T = unknown> {
  event: EventToken<T>
  listener: EventListener<T>
}

export interface EventListenerFailure {
  eventId: string
  owner: string
  error: unknown
}

interface OwnedEventListener {
  owner: string
  definition: EventListenerDefinition<any>
}

export function defineEvent<T>(id: string): EventToken<T> {
  if (!eventIdPattern.test(id)) throw new Error(`Event ID 无效: ${id}`)
  return Object.freeze({ id }) as EventToken<T>
}

export class EventRegistry {
  private readonly listeners = new Map<string, OwnedEventListener[]>()
  private reportFailure: (failure: EventListenerFailure) => void

  constructor(reportFailure: (failure: EventListenerFailure) => void = () => undefined) {
    this.reportFailure = reportFailure
  }

  setFailureReporter(reportFailure: (failure: EventListenerFailure) => void) {
    this.reportFailure = reportFailure
  }

  replaceOwner(owner: string, definitions: EventListenerDefinition<any>[]) {
    this.assertDefinitions(definitions)
    this.unregisterOwner(owner)
    definitions.forEach((definition) => {
      const current = this.listeners.get(definition.event.id) ?? []
      current.push({ owner, definition })
      this.listeners.set(definition.event.id, current)
    })
  }

  listen<T>(owner: string, event: EventToken<T>, listener: EventListener<T>) {
    this.assertDefinitions([{ event, listener }])
    const current = this.listeners.get(event.id) ?? []
    const entry: OwnedEventListener = { owner, definition: { event, listener } }
    current.push(entry)
    this.listeners.set(event.id, current)
    return () => {
      const active = this.listeners.get(event.id)
      if (!active) return
      const next = active.filter((candidate) => candidate !== entry)
      if (next.length) this.listeners.set(event.id, next)
      else this.listeners.delete(event.id)
    }
  }

  unregisterOwner(owner: string) {
    for (const [eventId, entries] of this.listeners) {
      const retained = entries.filter((entry) => entry.owner !== owner)
      if (retained.length) this.listeners.set(eventId, retained)
      else this.listeners.delete(eventId)
    }
  }

  emit<T>(event: EventToken<T>, payload: Readonly<T>): void {
    const snapshot = [...(this.listeners.get(event.id) ?? [])]
    snapshot.forEach(({ owner, definition }) => {
      try {
        const result = definition.listener(payload)
        if (result && typeof result.then === 'function') {
          void result.catch((error: unknown) => this.reportFailure({ eventId: event.id, owner, error }))
        }
      } catch (error) {
        this.reportFailure({ eventId: event.id, owner, error })
      }
    })
  }

  listenerCount<T>(event: EventToken<T>) {
    return this.listeners.get(event.id)?.length ?? 0
  }

  private assertDefinitions(definitions: EventListenerDefinition<any>[]) {
    definitions.forEach((definition) => {
      if (!eventIdPattern.test(definition.event.id)) {
        throw new Error(`Event ID 无效: ${definition.event.id}`)
      }
      if (typeof definition.listener !== 'function') {
        throw new Error(`Event Listener 无效: ${definition.event.id}`)
      }
    })
  }
}
