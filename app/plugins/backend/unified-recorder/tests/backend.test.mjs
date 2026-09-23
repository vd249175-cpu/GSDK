import { describe, expect, it } from 'vitest'
import { assertRendererRoot } from '@graphframework/sdk/plugin'
import { createTestRuntime } from '@graphframework/sdk/testing'
import plugin, {
  buildReplayScript,
  buildTranscript,
  createUnifiedRecorder,
  normalizeBrowserEvent,
  normalizeDesktopEvent,
} from '../index.mjs'

const desktopControl = (calls) => ({
  id: 'unified/desktop-control',
  execute: async (request) => {
    calls.push({ adapter: 'desktop', ...request })
    if (request.op === 'start') {
      return { handle: `psr:${request.sessionId}`, artifactPath: `C:\\recordings\\${request.sessionId}.zip`, startedAt: 't0' }
    }
    return { stopped: true, artifactPath: `C:\\recordings\\${request.sessionId}.zip` }
  },
})

const browserControl = (calls) => ({
  id: 'unified/browser-control',
  execute: async (request) => {
    calls.push({ adapter: 'browser', ...request })
    if (request.op === 'start') return { handle: `playwright-cli:rec:${request.sessionId}` }
    return { stopped: true, actions: "await page.goto('https://example.com/');" }
  },
})

const desktopObservation = (events) => ({
  id: 'unified/desktop-observation',
  execute: async () => ({ events, applications: ['EXPLORER.EXE'], completedAt: 't1' }),
})

const desktopEvents = (batches) => ({
  id: 'unified/desktop-events',
  execute: async () => batches.shift() ?? { events: [] },
})

const browserEvents = (batches) => ({
  id: 'unified/browser-events',
  execute: async () => batches.shift() ?? { events: [], cursor: null },
})

const assemble = ({ liveDesktop = [], liveBrowser = [], authoritative = [] } = {}) => {
  const calls = []
  const nodes = createUnifiedRecorder({
    instanceId: 'recorder',
    nodeIdFor: (local) => `recorder/${local}`,
    dependencies: {
      desktopControl: desktopControl(calls),
      browserControl: browserControl(calls),
      desktopObservation: desktopObservation(authoritative),
      desktopEvents: desktopEvents(liveDesktop),
      browserEvents: browserEvents(liveBrowser),
    },
  })
  return { calls, nodes: Object.values(nodes) }
}

describe('unified-recorder normalization', () => {
  it('normalizes desktop and browser shapes into one canonical step', () => {
    const desktop = normalizeDesktopEvent({ action: 'Mouse Left Click', application: 'NOTEPAD.EXE', description: 'Clicked' }, 1)
    expect(desktop).toMatchObject({ index: 1, source: 'desktop', application: 'NOTEPAD.EXE' })
    const browser = normalizeBrowserEvent({ kind: 'action', code: "await page.getByRole('textbox').fill('s3cr3t');" }, 2)
    expect(browser).toMatchObject({
      index: 2,
      source: 'browser',
      action: 'fill',
      text: 's3cr3t',
      code: "await page.getByRole('textbox').fill('s3cr3t');",
    })
  })

  it('builds one transcript and one replayable script', () => {
    const events = [
      normalizeDesktopEvent({ action: 'Mouse Left Click', application: 'NOTEPAD.EXE', description: 'Clicked' }, 1),
      normalizeBrowserEvent({ kind: 'action', code: "await page.goto('https://example.com/');" }, 2),
    ]
    expect(buildTranscript(events)).toContain('01 [desktop|NOTEPAD.EXE]')
    expect(buildTranscript(events)).toContain('02 [browser|example.com]')
    expect(buildReplayScript(events)).toContain("await page.goto('https://example.com/');")
    expect(buildReplayScript(events)).toContain('// DESKTOP 1:')
  })
})

describe('unified-recorder causal flow', () => {
  it('keeps timed narration subtitles across recording segments and accepts corrections', async () => {
    const { nodes } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StartRecordingInfo', sessionId: 'clip-1' } })
    await runtime.waitForQuiescence()
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'AudioTranscribedInfo', sessionId: 'clip-1', audioFile: 'clip-1.webm', segments: [{ startMs: 1200, endMs: 2500, text: '错误字幕' }] } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('recorder/session').subtitles).toMatchObject([{ id: 'clip-1:0', startMs: 1200, endMs: 2500, text: '错误字幕' }])
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'CorrectSubtitleInfo', id: 'clip-1:0', text: '正确字幕' } })
    await runtime.waitForQuiescence()
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StopRecordingInfo' } })
    await runtime.waitForQuiescence()
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StartRecordingInfo', sessionId: 'clip-2' } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('recorder/session').subtitles).toMatchObject([{ id: 'clip-1:0', text: '正确字幕' }])
    runtime.dispose()
  })
  it('starts both sources, streams live events, settles with authoritative desktop trace', async () => {
    const { calls, nodes } = assemble({
      liveDesktop: [{ events: [{ action: 'Mouse Left Click', application: 'NOTEPAD.EXE', description: 'Clicked' }] }],
      liveBrowser: [{ events: [{ kind: 'action', code: "await page.goto('https://example.com/');" }] }],
      authoritative: [{ index: 2, action: 'Mouse Left Click', application: 'EXPLORER.EXE', description: 'authoritative' }],
    })
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-1' } })
    await runtime.waitForQuiescence()
    expect(calls).toEqual([
      { adapter: 'desktop', op: 'start', sessionId: 's-1' },
      { adapter: 'browser', op: 'start', sessionId: 's-1' },
    ])
    expect(runtime.getState('recorder/session')).toMatchObject({ status: 'recording', sessionId: 's-1' })

    runtime.inject({ targetNodeId: 'recorder/observation', info: { type: 'PollUnifiedEventsInfo', sessionId: 's-1' } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('recorder/session')).toMatchObject({ status: 'recording', eventCount: 2 })
    expect(runtime.getState('recorder/observation')).toMatchObject({ lastCount: 2 })

    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StopRecordingInfo' } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('recorder/session')).toMatchObject({
      status: 'idle',
      artifactPath: 'C:\\recordings\\s-1.zip',
      browserActions: "await page.goto('https://example.com/');",
      eventCount: 2,
      applications: expect.arrayContaining(['NOTEPAD.EXE', 'EXPLORER.EXE', 'example.com']),
    })
    runtime.dispose()
  })

  it('emits portable merge pulses without functions in the observe request', async () => {
    let observedRequest = null
    const nodes = createUnifiedRecorder({
      instanceId: 'recorder',
      nodeIdFor: (local) => `recorder/${local}`,
      dependencies: {
        desktopControl: desktopControl([]),
        browserControl: browserControl([]),
        desktopObservation: {
          id: 'unified/desktop-observation',
          execute: async (request) => {
            observedRequest = request
            return {
              events: [
                { index: 1, source: 'desktop', action: 'Mouse Left Click', application: 'EXPLORER.EXE', description: 'Clicked' },
              ],
              applications: ['EXPLORER.EXE'],
              completedAt: 't1',
            }
          },
        },
        desktopEvents: desktopEvents([]),
        browserEvents: browserEvents([]),
      },
    })
    const runtime = createTestRuntime({ nodes: Object.values(nodes) })
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-progress' } })
    await runtime.waitForQuiescence()
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StopRecordingInfo' } })
    await runtime.waitForQuiescence()
    const state = runtime.getState('recorder/session')
    expect(state.status).toBe('idle')
    // daemon-portable 断言：request 内不得出现 function，否则 daemon codec 直接 throw。
    expect(JSON.stringify(observedRequest, (_key, value) => (typeof value === 'function' ? '__FUNCTION__' : value))).not.toContain('__FUNCTION__')
    expect(observedRequest.onProgress).toBeUndefined()
    expect(state.progressLog.map((entry) => entry.stage)).toEqual(
      expect.arrayContaining(['start-requested', 'merging', 'merge-started', 'merge-done']),
    )
    runtime.dispose()
  })

  it('fails one source without dropping the other', async () => {
    const calls = []
    const nodes = createUnifiedRecorder({
      instanceId: 'recorder',
      nodeIdFor: (local) => `recorder/${local}`,
      dependencies: {
        desktopControl: { id: 'unified/desktop-control', execute: async () => { throw new Error('psr unavailable') } },
        browserControl: browserControl(calls),
        desktopObservation: desktopObservation([]),
        desktopEvents: desktopEvents([]),
        browserEvents: browserEvents([]),
      },
    })
    const runtime = createTestRuntime({ nodes: Object.values(nodes) })
    runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-2' } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('recorder/session')).toMatchObject({
      status: 'recording',
      handles: { desktop: null, browser: 'playwright-cli:rec:s-2' },
    })
    expect(runtime.getState('recorder/session').lastError).toContain('desktop')
    runtime.dispose()
  })

  it('renderer roots expose only start and stop user intent', () => {
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.unified-recorder/session', info: { type: 'StartRecordingInfo', sessionId: 's-1' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.unified-recorder/session', info: { type: 'StopRecordingInfo' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.unified-recorder/execution', info: { type: 'StartCaptureInfo', sessionId: 's-1' },
    })).toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.unified-recorder/observation', info: { type: 'PollUnifiedEventsInfo', sessionId: 's-1' },
    })).toThrow()
  })
})
