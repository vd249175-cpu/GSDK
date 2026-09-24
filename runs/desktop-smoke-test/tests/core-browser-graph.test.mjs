import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { buildCausalIndex, buildAllNodesView, validateCausalIndex, analyzeViewHealth } from '@graphframework/sdk/analysis'
import { createBrowserExecutorGraph } from '../../../app/plugins/backend/browser-executor/index.mjs'

describe('core browser executor', () => {
  it('has resolved Info routes and no causal cycle', () => {
    const index = buildCausalIndex({ nodeObjects: createBrowserExecutorGraph({ instanceId: 'browser' }) })
    expect(index.unresolvedInfoTypes).toEqual([])
    expect(index.unresolvedSendTargets).toEqual([])
    expect(validateCausalIndex(index).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(analyzeViewHealth(buildAllNodesView(index)).cyclicNodeIds).toEqual([])
  })

  it('executes a registered task then observes the browser in separate world nodes', async () => {
    const calls = []
    const nodes = createBrowserExecutorGraph({ instanceId: 'browser', dependencies: {
      browserExecution: { id: 'browser/execution', execute: async (request) => {
        calls.push(['execute', request])
        return { opened: true }
      } },
      browserObservation: { id: 'browser/observation', execute: async (request) => {
        calls.push(['observe', request])
        return { url: 'https://example.org/', title: 'Example' }
      } },
    } })
    const runtime = createTestRuntime({ nodes })
    try {
      runtime.inject({ targetNodeId: 'browser/session', info: {
        type: 'RunBrowserTaskInfo', requestId: 'r-1', task: 'check-home', args: { url: 'https://example.org/' },
      } })
      await runtime.waitForQuiescence()
      expect(calls.map(([phase]) => phase)).toEqual(['execute', 'observe'])
      expect(runtime.getState('browser/result')).toMatchObject({
        status: 'done', result: { opened: true }, observation: { title: 'Example' },
      })
    } finally { await runtime.dispose() }
  })
})
