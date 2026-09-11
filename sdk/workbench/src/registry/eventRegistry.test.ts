import { describe, expect, it, vi } from 'vitest'
import { defineEvent, EventRegistry } from './eventRegistry'

const Changed = defineEvent<{ value: string }>('example/changed')

describe('Event registry', () => {
  it('replaces and removes listeners by owner', () => {
    const registry = new EventRegistry()
    const first = vi.fn()
    const second = vi.fn()
    registry.replaceOwner('observer', [{ event: Changed, listener: first }])
    registry.emit(Changed, { value: 'first' })
    expect(first).toHaveBeenCalledWith({ value: 'first' })

    registry.replaceOwner('observer', [{ event: Changed, listener: second }])
    registry.emit(Changed, { value: 'second' })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledWith({ value: 'second' })

    registry.unregisterOwner('observer')
    registry.emit(Changed, { value: 'ignored' })
    expect(second).toHaveBeenCalledOnce()
  })

  it('isolates synchronous and asynchronous listener failures', async () => {
    const report = vi.fn()
    const registry = new EventRegistry(report)
    const healthy = vi.fn()
    registry.replaceOwner('sync-failure', [{
      event: Changed, listener: () => { throw new Error('sync failed') },
    }])
    registry.replaceOwner('async-failure', [{
      event: Changed, listener: async () => { throw new Error('async failed') },
    }])
    registry.replaceOwner('healthy', [{ event: Changed, listener: healthy }])

    expect(() => registry.emit(Changed, { value: 'event' })).not.toThrow()
    await Promise.resolve()
    expect(healthy).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('supports disposable lifecycle listeners', () => {
    const registry = new EventRegistry()
    const listener = vi.fn()
    const dispose = registry.listen('view', Changed, listener)
    expect(registry.listenerCount(Changed)).toBe(1)
    dispose()
    expect(registry.listenerCount(Changed)).toBe(0)
  })

  it('requires namespaced notification event IDs', () => {
    expect(() => defineEvent('changed')).toThrow('Event ID 无效')
    expect(() => defineEvent('Example/changed')).toThrow('Event ID 无效')
  })
})
