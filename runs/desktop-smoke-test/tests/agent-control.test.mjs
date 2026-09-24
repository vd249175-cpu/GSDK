import { describe, expect, it } from 'vitest'
import { validateDecision, waitForBreakpoint } from '../agent-control.mjs'

const pending = { nodeId: 'smoke/session', requestId: 'r1', step: 'edit-doc', text: 'default' }

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

  it('waits until the graph exposes a breakpoint', async () => {
    let calls = 0
    const readProjection = async () => {
      calls += 1
      return { nodes: { 'smoke/session': { state: calls === 1 ? { status: 'checking-browser' } : { status: 'awaiting-confirmation', pendingConfirmation: pending } } } }
    }
    expect(await waitForBreakpoint(readProjection, { timeoutMs: 100, pollMs: 1 })).toEqual(pending)
  })
})
