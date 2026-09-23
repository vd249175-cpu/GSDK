import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNarrationStore } from './narration.mjs'
import { mergeNarrationIntoRecording } from './recording-merge.mjs'

describe('final recording merge', () => {
  it('includes the audio track and corrected timed subtitles in the final record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recorder-merge-'))
    try {
      const recordingsDirectory = join(root, 'recordings')
      const narrationDirectory = join(recordingsDirectory, 'narration')
      const sessionDirectory = join(recordingsDirectory, '2026-09-23_09-00-00__2026-09-23_09-00-05_clip-1')
      await mkdir(sessionDirectory, { recursive: true })
      await writeFile(join(sessionDirectory, 'unified-events.json'), JSON.stringify({ sessionId: 'clip-1', startedAt: '2026-09-23T00:00:00.000Z', events: [{ index: 1, source: 'desktop', action: 'click' }] }))
      await writeFile(join(sessionDirectory, 'agent-transcript.md'), '# Recording\n\n## Step-by-Step Operations\n\n### Step 01\n')
      const store = createNarrationStore({
        directory: narrationDirectory, apiKey: 'test-key',
        fetchImpl: async () => ({ ok: true, json: async () => ({ segments: [{ start: 0.25, end: 1.5, text: '初始字幕' }] }) }),
      })
      await store.save({ sessionId: 'clip-1', bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm', startedAt: '2026-09-23T00:00:01.000Z', narrationStartedAt: '2026-09-23T00:00:00.000Z', durationMs: 2000, timeoutMs: 10_000 })
      const index = await store.readIndex()
      await mergeNarrationIntoRecording({ sessionId: 'clip-1', sessionDirectory, recordingsDirectory, narrationDirectory, index })
      await store.linkRecording('clip-1', sessionDirectory)

      const record = JSON.parse(await readFile(join(sessionDirectory, 'unified-events.json'), 'utf8'))
      expect(record.events).toHaveLength(1)
      expect(record.narration.audioClips).toEqual([{ audioFile: 'audio/narration.webm', startMs: 1000, durationMs: 2000 }])
      expect(record.narration.subtitles).toMatchObject([{ startMs: 1250, endMs: 2500, text: '初始字幕' }])
      expect(await readFile(join(sessionDirectory, 'audio', 'narration.webm'))).toEqual(Buffer.from([1, 2, 3]))
      expect(await readFile(join(sessionDirectory, 'subtitles.srt'), 'utf8')).toContain('00:00:01,250 --> 00:00:02,500\n初始字幕')

      const corrected = await store.correct('clip-1:0', '修正字幕')
      expect(corrected.recordingDirectories['clip-1']).toBe(sessionDirectory)
      await mergeNarrationIntoRecording({ sessionId: 'clip-1', sessionDirectory, recordingsDirectory, narrationDirectory, index: corrected })
      const updated = JSON.parse(await readFile(join(sessionDirectory, 'unified-events.json'), 'utf8'))
      expect(updated.narration.subtitles[0].text).toBe('修正字幕')
      const transcript = await readFile(join(sessionDirectory, 'agent-transcript.md'), 'utf8')
      expect(transcript).toContain('修正字幕')
      expect(transcript).not.toContain('初始字幕')
      expect(transcript).toContain('audio/narration.webm')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('keeps the audio track in the final record when transcription fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recorder-merge-error-'))
    try {
      const recordingsDirectory = join(root, 'recordings')
      const narrationDirectory = join(recordingsDirectory, 'narration')
      const sessionDirectory = join(recordingsDirectory, 'session-2')
      await mkdir(sessionDirectory, { recursive: true })
      await writeFile(join(sessionDirectory, 'unified-events.json'), JSON.stringify({ sessionId: 'clip-2', startedAt: '2026-09-23T00:00:00.000Z', events: [] }))
      await writeFile(join(sessionDirectory, 'agent-transcript.md'), '# Recording\n')
      const store = createNarrationStore({ directory: narrationDirectory, apiKey: '' })
      const saved = await store.save({ sessionId: 'clip-2', bytes: new Uint8Array([4]), mimeType: 'audio/webm', startedAt: '2026-09-23T00:00:01.000Z', durationMs: 1000, timeoutMs: 5000 })
      expect(saved.transcriptionError).toContain('OPENROUTER_API_KEY')
      await mergeNarrationIntoRecording({ sessionId: 'clip-2', sessionDirectory, recordingsDirectory, narrationDirectory, index: await store.readIndex() })
      const record = JSON.parse(await readFile(join(sessionDirectory, 'unified-events.json'), 'utf8'))
      expect(record.narration.subtitles).toEqual([])
      expect(record.narration.audioClips[0].audioFile).toBe('audio/narration.webm')
      expect(await readFile(join(sessionDirectory, 'audio', 'narration.webm'))).toEqual(Buffer.from([4]))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
