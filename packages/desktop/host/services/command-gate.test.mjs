import { describe, expect, it } from 'vitest'
import { createCommandGate, bindCommandIpc } from './command-gate.mjs'
import { EventEmitter } from 'node:events'

describe('host command gate', () => {
  it('rejects new commands while allowing already accepted operations to finish', async () => {
    const gate = createCommandGate()
    let release
    const work = gate.run(() => new Promise((resolve) => { release = resolve }))
    gate.close()
    await expect(gate.run(() => {})).rejects.toThrow(/closing/)
    let drained = false
    const drain = gate.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    release()
    await Promise.all([work, drain])
    expect(drained).toBe(true)
  })
  it('gates IPC mutations, permits projection reads, and removes owned registrations', async () => {
    const gate = createCommandGate()
    const ipc = new EventEmitter()
    const handlers = new Map()
    ipc.handle = (channel, handler) => handlers.set(channel, handler)
    ipc.removeHandler = (channel) => handlers.delete(channel)
    const binding = bindCommandIpc(ipc, gate, { allowRead: (channel) => channel === 'read' })
    binding.handle('write', () => 'written')
    binding.handle('read', () => 'projection')
    let events = 0
    binding.on('event', () => { events++ })
    ipc.emit('event', {})
    await gate.drain()
    expect(events).toBe(1)
    gate.close()
    await expect(handlers.get('write')({})).rejects.toThrow(/closing/)
    expect(handlers.get('read')({})).toBe('projection')
    ipc.emit('event', {})
    expect(events).toBe(1)
    binding.dispose()
    expect(handlers.size).toBe(0)
    expect(ipc.listenerCount('event')).toBe(0)
  })
})
