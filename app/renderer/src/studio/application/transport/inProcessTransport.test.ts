import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../contract/transport'
import { ApplicationHost } from '../host/applicationHost'
import { InProcessTransport } from './inProcessTransport'

describe('InProcessTransport', () => {
  it('always crosses an async structured-clone boundary', async () => {
    const host = new ApplicationHost()
    const input = { nodeIds: ['node-a'] }
    host.register('assets.export-videos', async (received) => {
      expect(received).not.toBe(input)
      received.nodeIds.push('host-only')
      return { canceled: false, exported: [], skipped: [] }
    })
    const transport = new InProcessTransport(host)
    let settled = false
    const request = transport.request('assets.export-videos', input).then((value) => {
      settled = true
      return value
    })
    expect(settled).toBe(false)
    const output = await request
    expect(input.nodeIds).toEqual(['node-a'])
    expect(output).toEqual({ canceled: false, exported: [], skipped: [] })
  })

  it('clones events and cleans subscriptions on disposal', () => {
    const host = new ApplicationHost()
    const transport = new InProcessTransport(host)
    const listener = vi.fn()
    transport.subscribe('generation-models.catalog-changed', listener)
    const payload = { reason: 'import' as const, modelId: 'model-a' }
    host.emit('generation-models.catalog-changed', payload)
    expect(listener).toHaveBeenCalledWith(payload)
    expect(listener.mock.calls[0][0]).not.toBe(payload)
    transport.dispose()
    host.emit('generation-models.catalog-changed', payload)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('normalizes handler failures and cancellation', async () => {
    const host = new ApplicationHost()
    host.register('snapshot.read', async (_input, { signal }) => (
      new Promise((_, reject) => signal.addEventListener('abort', () => (
        reject(new DOMException('aborted', 'AbortError'))
      ), { once: true }))
    ))
    const transport = new InProcessTransport(host)
    const controller = new AbortController()
    const request = transport.request('snapshot.read', undefined, { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'application.canceled' })

    await expect(transport.request('project.list-recent', undefined)).rejects.toMatchObject({
      code: 'application.method-missing',
    })
    transport.dispose()
    await expect(transport.request('project.list-recent', undefined)).rejects.toBeInstanceOf(ApplicationError)
  })

  it('reports a missing provider with a stable application error code', async () => {
    const host = new ApplicationHost()
    host.register('prompt-library.list', () => {
      throw new Error('Service Provider 不可用: graphvideo.prompt-library')
    })
    const transport = new InProcessTransport(host)
    await expect(transport.request('prompt-library.list', undefined)).rejects.toMatchObject({
      code: 'application.provider-missing',
    })
  })
})
