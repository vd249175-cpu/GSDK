import { describe, expect, it } from 'vitest'
import { assertRendererRoot } from '@graphframework/sdk/plugin'
import { createTestRuntime } from '@graphframework/sdk/testing'
import plugin, { createOsRecorder } from '../index.mjs'

const controlAdapter = (calls) => ({
  id: 'ufo/psr-capture-control',
  execute: async (request) => {
    calls.push(request)
    if (request.op === 'start') {
      return {
        handle: 'psr:s-1',
        artifactPath: 'C:\\recordings\\s-1.zip',
        startedAt: '2026-09-20T08:00:00.000Z',
      }
    }
    return { stopped: true, artifactPath: 'C:\\recordings\\s-1.zip' }
  },
})

const observationAdapter = (events = []) => ({
  id: 'ufo/psr-capture-observation',
  execute: async () => ({
    events,
    applications: ['EXPLORER.EXE'],
    completedAt: '2026-09-20T08:01:00.000Z',
  }),
})

const assemble = ({ events = [], control } = {}) => {
  const calls = []
  const nodes = createOsRecorder({
    instanceId: 'example.os-recorder',
    nodeIdFor: (local) => `example.os-recorder/${local}`,
    dependencies: {
      captureControl: control ?? controlAdapter(calls),
      captureObservation: observationAdapter(events),
    },
  })
  return { calls, nodes: Object.values(nodes) }
}

describe('os-recorder causal flow', () => {
  it('starts, stops, observes the UFO-compatible artifact, and settles owner state', async () => {
    const events = [
      { index: 1, action: 'Mouse Left Click', application: 'EXPLORER.EXE', description: 'User opened Documents' },
      { index: 2, action: 'Keyboard Input', application: 'NOTEPAD.EXE', description: 'User entered text' },
    ]
    const { calls, nodes } = assemble({ events })
    const runtime = createTestRuntime({ nodes })

    runtime.inject({ targetNodeId: 'example.os-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-1' } })
    await runtime.waitForQuiescence()
    expect(calls).toEqual([{ op: 'start', sessionId: 's-1' }])
    expect(runtime.getState('example.os-recorder/session')).toMatchObject({
      status: 'recording',
      sessionId: 's-1',
      handle: 'psr:s-1',
    })

    runtime.inject({ targetNodeId: 'example.os-recorder/session', info: { type: 'StopRecordingInfo' } })
    await runtime.waitForQuiescence()
    expect(calls).toEqual([
      { op: 'start', sessionId: 's-1' },
      { op: 'stop', sessionId: 's-1' },
    ])
    expect(runtime.getState('example.os-recorder/session')).toMatchObject({
      status: 'idle',
      eventCount: 2,
      applications: ['EXPLORER.EXE'],
      artifactPath: 'C:\\recordings\\s-1.zip',
      lastEvent: events[1],
      lastError: null,
    })
    expect(runtime.getState('example.os-recorder/observation')).toMatchObject({ lastCount: 2 })
    runtime.dispose()
  })

  it('turns physical failures into owner-visible causal state', async () => {
    const control = {
      id: 'ufo/psr-capture-control',
      execute: async () => { throw new Error('Steps Recorder unavailable') },
    }
    const { nodes } = assemble({ control })
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'example.os-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-2' } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('example.os-recorder/session')).toMatchObject({
      status: 'error',
      lastError: 'Steps Recorder unavailable',
    })
    runtime.dispose()
  })

  it('renderer roots expose only start and stop user intent', () => {
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.os-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-1' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.os-recorder/session', info: { type: 'StopRecordingInfo' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.os-recorder/execution', info: { type: 'StartCaptureInfo', sessionId: 's-1' },
    })).toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.os-recorder/observation', info: { type: 'ObserveRecordingInfo', artifactPath: 'x' },
    })).toThrow()
  })
})
