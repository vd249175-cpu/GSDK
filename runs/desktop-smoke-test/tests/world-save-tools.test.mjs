import { describe, expect, it } from 'vitest'
import { createWorldSaveTools } from '../bridge/world-save-tools.mjs'

describe('world save agent tools', () => {
  it('returns a handle before the user decides and shares one popup across repeated calls', async () => {
    let decide
    let prompts = 0
    const tools = createWorldSaveTools({
      showDecision: () => { prompts += 1; return new Promise((resolve) => { decide = resolve }) },
      readPending: async () => ({ requestId: 'r-2', step: 'save-world', nodeId: 'smoke/world-review' }),
      inject: async () => {},
    })
    const ask = tools.find((tool) => tool.name === 'ask_world_save')
    const first = await Promise.race([
      ask.execute({ threadId: 't', requestId: 'r-2', toolCallId: 'a-1', args: {} }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('execution waited for popup')), 100)),
    ])
    const second = await ask.execute({ threadId: 't', requestId: 'r-2', toolCallId: 'a-2', args: {} })
    expect(prompts).toBe(1)
    decide({ requestId: 'r-2', step: 'save-world', decision: 'reject' })
    expect(await ask.observe({ handle: first.handle, threadId: 't', requestId: 'r-2' }))
      .toMatchObject({ decision: 'reject' })
    expect(await ask.observe({ handle: second.handle, threadId: 't', requestId: 'r-2' }))
      .toMatchObject({ decision: 'reject' })
  })

  it('accepts a signal only after the user approved the matching request', async () => {
    const injected = []
    const tools = createWorldSaveTools({
      showDecision: async () => ({ requestId: 'r-1', step: 'save-world', decision: 'approve', text: '保存原因' }),
      readPending: async () => ({ requestId: 'r-1', step: 'save-world', nodeId: 'smoke/world-review' }),
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
    expect(await signal.execute({ threadId: 't', requestId: 'r-1', toolCallId: 's-1', args: {} }))
      .toEqual(signaled)
    expect(await signal.observe({ handle: signaled.handle })).toMatchObject({ signaled: true })
    expect(injected).toEqual([{ nodeId: 'smoke/world-review', info: {
      type: 'WorldSaveDecisionInfo', requestId: 'r-1', decision: 'approve', text: '保存原因',
    } }])
  })
})
