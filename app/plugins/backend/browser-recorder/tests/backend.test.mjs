import { describe, expect, it } from 'vitest'
import { assertRendererRoot } from '@graphframework/sdk/plugin'
import { createTestRuntime } from '@graphframework/sdk/testing'
import plugin, { createBrowserRecorder } from '../index.mjs'

const controlAdapter = (calls, handle = 'handle-1') => ({
  id: 'browser/capture-control',
  execute: async (request) => {
    calls.push(request)
    return request.op === 'start' ? { handle } : { stopped: true }
  },
})

const eventsAdapter = (batches) => ({
  id: 'browser/capture-events',
  execute: async (request) => batches.shift() ?? { events: [], cursor: request.cursor ?? null },
})

const assemble = ({ batches = [] } = {}) => {
  const calls = []
  const { session, execution, observation } = createBrowserRecorder({
    instanceId: 'example.browser-recorder',
    nodeIdFor: (local) => `example.browser-recorder/${local}`,
    dependencies: { captureControl: controlAdapter(calls), captureEvents: eventsAdapter(batches) },
  })
  return { calls, nodes: [session, execution, observation] }
}

describe('browser-recorder', () => {
  it('start/stop 经 ExecutionWorldNode 下发并回填 Owner State', async () => {
    const { calls, nodes } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'example.browser-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-1' } })
    await runtime.waitForQuiescence()
    expect(calls).toEqual([{ op: 'start', sessionId: 's-1' }])
    expect(runtime.getState('example.browser-recorder/session')).toMatchObject({ status: 'recording', sessionId: 's-1', handle: 'handle-1' })

    runtime.inject({ targetNodeId: 'example.browser-recorder/session', info: { type: 'StopRecordingInfo' } })
    await runtime.waitForQuiescence()
    expect(calls).toEqual([
      { op: 'start', sessionId: 's-1' },
      { op: 'stop', sessionId: 's-1' },
    ])
    expect(runtime.getState('example.browser-recorder/session')).toMatchObject({ status: 'idle' })
    runtime.dispose()
  })

  it('ObservationWorldNode 轮询事件并交回 Owner', async () => {
    const { nodes } = assemble({ batches: [{ events: [{ kind: 'click', url: 'https://example.com/' }], cursor: 'c-1' }] })
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'example.browser-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-2' } })
    await runtime.waitForQuiescence()
    runtime.inject({
      targetNodeId: 'example.browser-recorder/observation',
      info: { type: 'PollRecordingEventsInfo', sessionId: 's-2', cursor: null },
    })
    await runtime.waitForQuiescence()
    expect(runtime.getState('example.browser-recorder/session')).toMatchObject({ eventCount: 1, lastEvent: { kind: 'click', url: 'https://example.com/' } })
    expect(runtime.getState('example.browser-recorder/observation')).toMatchObject({ lastCount: 1 })
    runtime.dispose()
  })

  it('rendererRoots 仅放行用户开始/停止意图', () => {
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.browser-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-1' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.browser-recorder/session', info: { type: 'StopRecordingInfo' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.browser-recorder/execution', info: { type: 'StartCaptureInfo', sessionId: 's-1' },
    })).toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.browser-recorder/observation', info: { type: 'PollRecordingEventsInfo', sessionId: 's-1' },
    })).toThrow()
  })
})
