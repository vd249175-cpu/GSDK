import { describe, expect, it } from 'vitest'
import { createNarrationRestorer } from './restore.mjs'

describe('narration startup restore', () => {
  it('waits for a running session and restores only once', async () => {
    let phase = 'starting'
    let injections = 0
    const projection = { nodes: { 'recorder/session': { state: {} } } }
    const restore = createNarrationRestorer({
      targetNodeId: 'recorder/session',
      readIndex: async () => ({ subtitles: [], audioClips: [{ sessionId: 'clip-1' }] }),
      callControl: async (operation) => {
        if (operation === 'health') return { state: phase }
        if (operation === 'inject-renderer') { injections += 1; return { status: 'accepted' } }
        return projection
      },
    })
    await restore(projection)
    expect(injections).toBe(0)
    phase = 'running'
    await restore(projection)
    await restore(projection)
    expect(injections).toBe(1)
  })

  it('retries after an injection failure', async () => {
    let attempts = 0
    const projection = { nodes: { 'recorder/session': { state: {} } } }
    const restore = createNarrationRestorer({
      targetNodeId: 'recorder/session',
      readIndex: async () => ({ subtitles: [{ id: 'caption-1' }], audioClips: [] }),
      callControl: async (operation) => {
        if (operation === 'health') return { state: 'running' }
        if (operation === 'inject-renderer' && ++attempts === 1) throw new Error('backend not ready')
        return projection
      },
    })
    await expect(restore(projection)).rejects.toThrow('backend not ready')
    await restore(projection)
    expect(attempts).toBe(2)
  })
})
