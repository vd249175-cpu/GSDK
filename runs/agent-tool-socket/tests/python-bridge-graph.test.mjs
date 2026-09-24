import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { buildCausalIndex, buildAllNodesView, validateCausalIndex, analyzeViewHealth } from '@graphframework/sdk/analysis'
import { createAgentExecutorGraph } from '../../../app/plugins/backend/agent-executor/index.mjs'
import { createAgentMonitorGraph } from '../../../app/plugins/backend/agent-monitor/index.mjs'

describe('Python agent graph ports', () => {
  it('has statically provable Info types and no causal cycle', () => {
    const nodes = [
      ...createAgentExecutorGraph({ instanceId: 'agent', dependencies: {} }),
      ...createAgentMonitorGraph({ instanceId: 'monitor' }),
    ]
    const index = buildCausalIndex({ nodeObjects: nodes })
    expect(index.unresolvedInfoTypes).toEqual([])
    expect(index.unresolvedSendTargets).toEqual([])
    expect(validateCausalIndex(index).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(analyzeViewHealth(buildAllNodesView(index)).cyclicNodeIds).toEqual([])
  })

  it('routes node prompts and media to an outside executor and publishes status', async () => {
    const requests = []
    const nodes = createAgentExecutorGraph({
      instanceId: 'agent', params: { executionSeats: 2, toolSeats: 2, promptSections: ['base'] },
      dependencies: {
        runAgent: { id: 'agent/run', execute: async (request) => { requests.push(request); return { answer: 'ok', processId: 42 } } },
        graphToolExecution: { id: 'agent/graph-tool-execution', execute: async () => ({ handle: 'h' }) },
        graphToolObservation: { id: 'agent/graph-tool-observation', execute: async () => ({ ok: true }) },
      },
    })
    const runtime = createTestRuntime({ nodes })
    try {
      runtime.inject({ targetNodeId: 'agent/session', info: {
        type: 'AgentInputInfo', threadId: 'thread-1', requestId: 'request-1', text: 'inspect',
        promptSections: ['workflow'], attachments: [{ type: 'video', url: 'https://example.org/a.mp4' }],
      } })
      await runtime.waitForQuiescence()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ threadId: 'thread-1', prompts: ['base', 'workflow'], attachments: [{ type: 'video' }] })
      expect(runtime.getState('agent/result').threads['thread-1']).toMatchObject({ status: 'done', answer: 'ok' })
    } finally { await runtime.dispose() }
  })

  it('runs different thread ids on independent execution seats', async () => {
    let active = 0
    let maximum = 0
    const gate = Promise.withResolvers()
    const nodes = createAgentExecutorGraph({ instanceId: 'agent', params: { executionSeats: 2, toolSeats: 1 },
      dependencies: {
        runAgent: { id: 'agent/run', execute: async () => {
          active += 1
          maximum = Math.max(maximum, active)
          if (maximum === 2) gate.resolve()
          await gate.promise
          active -= 1
          return { answer: 'ok' }
        } },
        graphToolExecution: { id: 'agent/graph-tool-execution', execute: async () => ({ handle: 'h' }) },
        graphToolObservation: { id: 'agent/graph-tool-observation', execute: async () => ({}) },
      } })
    const runtime = createTestRuntime({ nodes })
    try {
      for (const threadId of ['a', 'b']) runtime.inject({ targetNodeId: 'agent/session', info: {
        type: 'AgentInputInfo', threadId, requestId: `r-${threadId}`, text: 'hi',
      } })
      await runtime.waitForQuiescence()
      expect(maximum).toBe(2)
      expect(runtime.getState('agent/result').threads.a.status).toBe('done')
      expect(runtime.getState('agent/result').threads.b.status).toBe('done')
    } finally { await runtime.dispose() }
  })

  it('runs independent graph tool calls on separate seats and records monitor Info', async () => {
    let active = 0
    let maximum = 0
    const gate = Promise.withResolvers()
    const nodes = [
      ...createAgentExecutorGraph({ instanceId: 'agent', params: { toolSeats: 2 }, dependencies: {
        runAgent: { id: 'agent/run', execute: async () => ({ answer: '' }) },
        graphToolExecution: { id: 'agent/graph-tool-execution', execute: async ({ toolCallId }) => {
          active += 1
          maximum = Math.max(maximum, active)
          if (maximum === 2) gate.resolve()
          await gate.promise
          active -= 1
          return { handle: toolCallId }
        } },
        graphToolObservation: { id: 'agent/graph-tool-observation', execute: async ({ handle }) => ({ toolCallId: handle }) },
      } }),
      ...createAgentMonitorGraph({ instanceId: 'monitor' }),
    ]
    const runtime = createTestRuntime({ nodes })
    try {
      for (const [seat, id] of [[0, 'a'], [1, 'b']]) runtime.inject({ targetNodeId: `agent/tool-${seat}`, info: {
        type: 'AgentGraphToolInfo', threadId: 'thread-1', requestId: 'request-1', toolCallId: id,
        toolName: 'probe', args: {},
      } })
      runtime.inject({ targetNodeId: 'monitor/session', info: {
        type: 'AgentMonitorInfo', threadId: 'thread-1', requestId: 'request-1', phase: 'before_tool',
      } })
      await runtime.waitForQuiescence()
      expect(maximum).toBe(2)
      expect(runtime.getState('agent/tool-observation-0').results.a).toEqual({ toolCallId: 'a' })
      expect(runtime.getState('agent/tool-observation-1').results.b).toEqual({ toolCallId: 'b' })
      expect(runtime.getState('monitor/session').events.at(-1)).toMatchObject({ phase: 'before_tool' })
    } finally { await runtime.dispose() }
  })
})
