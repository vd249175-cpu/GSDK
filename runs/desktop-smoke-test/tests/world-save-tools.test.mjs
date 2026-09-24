import { describe, expect, it } from 'vitest'
import { createWorldSaveTools } from '../bridge/world-save-tools.mjs'

describe('world save agent tools', () => {
  it('accepts a signal only after the user approved the matching request', async () => {
    const injected = []
    const tools = createWorldSaveTools({
      showDecision: async () => ({ requestId: 'r-1', step: 'save-world', decision: 'approve', text: '保存原因' }),
      readPending: async () => ({ requestId: 'r-1', step: 'save-world', nodeId: 'smoke/session' }),
      inject: async (nodeId, info) => injected.push({ nodeId, info }),
    })
    const ask = tools.find((tool) => tool.name === 'ask_world_save')
    const signal = tools.find((tool) => tool.name === 'signal_world_save')
    await expect(signal.execute({ threadId: 't', requestId: 'r-1', toolCallId: 's-0', args: {} }))
      .rejects.toThrow('user decision')
    const asked = await ask.execute({ threadId: 't', requestId: 'r-1', toolCallId: 'a-1', args: {} })
    expect(await ask.observe({ handle: asked.handle, threadId: 't', requestId: 'r-1' }))
      .toMatchObject({ decision: 'approve' })
    const signaled = await signal.execute({ threadId: 't', requestId: 'r-1', toolCallId: 's-1', args: {} })
    expect(await signal.observe({ handle: signaled.handle })).toMatchObject({ signaled: true })
    expect(injected).toEqual([{ nodeId: 'smoke/session', info: {
      type: 'WorldSaveDecisionInfo', requestId: 'r-1', decision: 'approve', text: '保存原因',
    } }])
  })
})
