import { describe, expect, it, vi } from 'vitest'
import { ProjectAccess } from './project-access.mjs'

describe('physical project lifetime', () => {
  it('keeps download and subsequent metadata writes in A until the complete operation settles', async () => {
    const access = new ProjectAccess()
    let root = 'A', finishDownload, finishPersist
    const download = new Promise((resolve) => { finishDownload = resolve })
    const persist = new Promise((resolve) => { finishPersist = resolve })
    const writes = []
    const running = access.run(async () => {
      await download; writes.push([root, 'download'])
      await persist; writes.push([root, 'metadata'])
    })
    await expect(access.switchProject(() => { root = 'B' })).rejects.toThrow(/等待完成或取消/)
    finishDownload(); await Promise.resolve()
    await expect(access.switchProject(() => { root = 'B' })).rejects.toThrow(/等待完成或取消/)
    finishPersist(); await running
    await access.switchProject(() => { root = 'B' })
    expect(writes).toEqual([['A', 'download'], ['A', 'metadata']])
    expect(root).toBe('B')
  })

  it('blocks concurrent opens and new operations until a switch finishes, then releases on failure', async () => {
    const access = new ProjectAccess()
    let finish
    const pending = access.switchProject(() => new Promise((resolve) => { finish = resolve }))
    const action = vi.fn()
    await expect(access.run(action)).rejects.toThrow(/切换/)
    await expect(access.switchProject(action)).rejects.toThrow(/切换/)
    expect(action).not.toHaveBeenCalled()
    finish(); await pending
    await expect(access.run(async () => { throw new Error('failed') })).rejects.toThrow('failed')
    await access.switchProject(action)
    expect(action).toHaveBeenCalledOnce()
  })

  it('rejects a switch even after IPC settles while a graph task or cancellation is still pending', async () => {
    let graphBusy = true
    const access = new ProjectAccess(() => graphBusy)
    await expect(access.switchProject(vi.fn())).rejects.toThrow(/任务/)
    graphBusy = false
    await expect(access.switchProject(() => 'B')).resolves.toBe('B')
  })

  it('uses one-use authoritative batches, ignores renderer mutations and invalidates on same-path reopen', async () => {
    const access = new ProjectAccess()
    const original = { type: 'GenerationBatchRequestedInfo', batchId: 'opaque-id', catalog: { price: 20 }, project: { path: 'A' }, items: [] }
    const prepared = access.prepareBatch(original)
    original.catalog.price = 0
    expect(prepared).toEqual({ batchId: 'opaque-id', info: { type: 'GenerationBatchRequestedInfo', batchId: 'opaque-id' } })
    expect(access.consumeBatch(prepared.batchId).catalog.price).toBe(20)
    expect(() => access.consumeBatch(prepared.batchId)).toThrow(/失效/)
    access.prepareBatch(original)
    await access.switchProject(() => 'A')
    expect(() => access.consumeBatch(prepared.batchId)).toThrow(/失效/)
  })

  it('expires abandoned batches and bounds outstanding preparations', () => {
    const access = new ProjectAccess()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      for (let i = 0; i < 128; i++) access.prepareBatch({ type: 'GenerationBatchRequestedInfo', batchId: String(i) })
      expect(() => access.prepareBatch({ batchId: 'over-limit' })).toThrow(/过多/)
      clock.mockReturnValue(600_001)
      expect(() => access.consumeBatch('0')).toThrow(/失效/)
      expect(() => access.prepareBatch({ batchId: 'new' })).not.toThrow()
      expect(access.preparedBatches.size).toBe(1)
    } finally { clock.mockRestore() }
  })
})
