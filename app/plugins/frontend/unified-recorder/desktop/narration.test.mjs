import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNarrationStore, normalizeTranscription, resolveOpenRouterApiKey } from './narration.mjs'

describe('narration storage and transcription', () => {
  it('reads only the OpenRouter key from the local credentials file and prefers the environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narration-credentials-'))
    try {
      const path = join(directory, 'credentials.json')
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, JSON.stringify({ openrouter: { apiKey: 'file-test-key' }, sharedAccounts: { password: 'never-use' } }))
      expect(await resolveOpenRouterApiKey({ credentialsPath: path, environment: {} })).toBe('file-test-key')
      expect(await resolveOpenRouterApiKey({ credentialsPath: path, environment: { OPENROUTER_API_KEY: 'environment-test-key' } })).toBe('environment-test-key')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps segment timestamps and edited text in a durable index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narration-test-'))
    try {
      const requests = []
      const store = createNarrationStore({
        directory, apiKey: 'test-key',
        fetchImpl: async (_url, options) => {
          requests.push(JSON.parse(options.body))
          return { ok: true, json: async () => ({ text: '你好', segments: [{ start: 0.25, end: 1.5, text: ' 你好 ' }] }) }
        },
      })
      const result = await store.save({ sessionId: 'clip-1', bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm', startedAt: '2026-09-23T00:00:01.000Z', narrationStartedAt: '2026-09-23T00:00:00.000Z', durationMs: 2000, timeoutMs: 10_000 })
      expect(result.subtitles).toMatchObject([{ id: 'clip-1:0', startMs: 1250, endMs: 2500, text: '你好' }])
      expect(requests[0]).toMatchObject({ model: 'qwen/qwen3-asr-1.7b', response_format: 'verbose_json', input_audio: { format: 'webm' } })
      expect(await readFile(join(directory, 'clip-1.webm'))).toEqual(Buffer.from([1, 2, 3]))
      await store.correct('clip-1:0', '您好')
      expect((await store.readIndex()).subtitles[0].text).toBe('您好')
      expect(await readFile(join(directory, 'subtitles.srt'), 'utf8')).toContain('00:00:01,250 --> 00:00:02,500\n您好')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('preserves audio when OpenRouter fails and falls back to a timed text segment', async () => {
    expect(normalizeTranscription({ text: '说明' }, 3000)).toEqual([{ startMs: 0, endMs: 3000, text: '说明' }])
    const directory = await mkdtemp(join(tmpdir(), 'narration-test-'))
    try {
      const store = createNarrationStore({ directory, apiKey: '' })
      const result = await store.save({ sessionId: 'clip-2', bytes: new Uint8Array([4]), mimeType: 'audio/webm', startedAt: '2026-09-23T00:00:00.000Z', durationMs: 1000, timeoutMs: 5000 })
      expect(result.transcriptionError).toContain('OPENROUTER_API_KEY')
      expect(await store.readAudio('clip-2')).toEqual(Buffer.from([4]))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
