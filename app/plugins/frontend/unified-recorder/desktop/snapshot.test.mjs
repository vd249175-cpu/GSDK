import { describe, expect, it } from 'vitest'
import { createRecorderSnapshot } from './snapshot.mjs'

describe('recorder host snapshots', () => {
  it('returns the same complete field set for normal and failed reads', () => {
    const healthy = createRecorderSnapshot({ status: 'idle', audioClips: [{ sessionId: 'clip-1', audioFile: 'clip-1.webm', startMs: 0, durationMs: 1000 }] })
    const failed = createRecorderSnapshot(null, { status: 'error', lastError: 'backend unavailable' })
    expect(Object.keys(failed).sort()).toEqual(Object.keys(healthy).sort())
    expect(failed).toMatchObject({ status: 'error', lastError: 'backend unavailable', progressLog: [], subtitles: [], audioClips: [], browserAlive: false })
    expect(healthy.audioClips).toHaveLength(1)
  })

  it('normalizes missing projection arrays', () => {
    expect(createRecorderSnapshot({ events: null, progressLog: undefined, subtitles: {}, audioClips: false })).toMatchObject({
      events: [], progressLog: [], subtitles: [], audioClips: [],
    })
  })
})
