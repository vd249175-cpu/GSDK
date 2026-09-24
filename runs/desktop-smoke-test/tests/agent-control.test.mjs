import { describe, expect, it } from 'vitest'
import { validateDecision, waitForBreakpoint } from '../agent-control.mjs'

const pending = { nodeId: 'smoke/doc-edit-gate', requestId: 'r1', step: 'edit-doc', text: 'default' }

describe('agent breakpoint handoff', () => {
  it('accepts a matching decision and passes edited text as Info', () => {
    expect(validateDecision(pending, { ...pending, decision: 'approve', text: 'user choice' })).toEqual({
      type: 'ConfirmStepInfo', requestId: 'r1', step: 'edit-doc', decision: 'approve', text: 'user choice',
    })
  })

  it('rejects stale choices and leaves cancellation outside the graph', () => {
    expect(() => validateDecision(pending, { ...pending, requestId: 'old', decision: 'approve' })).toThrow('过期')
    expect(validateDecision(pending, { cancelled: true })).toBeNull()
  })

  it('reserves the world-save breakpoint for the agent graph tools', () => {
    const worldPending = { nodeId: 'smoke/world-review', requestId: 'r1', step: 'save-world' }
    expect(() => validateDecision(worldPending, { ...worldPending, decision: 'approve' })).toThrow('Agent')
  })

  it('waits until the graph exposes a breakpoint', async () => {
    let calls = 0
    const readProjection = async () => {
      calls += 1
      return { nodes: {
        'smoke/session': { state: { status: calls === 1 ? 'checking-browser' : 'awaiting-confirmation' } },
        'smoke/doc-edit-gate': { state: { pendingConfirmation: calls === 1 ? null : pending } },
      } }
    }
    expect(await waitForBreakpoint(readProjection, { timeoutMs: 100, pollMs: 1 })).toEqual(pending)
  })
})
