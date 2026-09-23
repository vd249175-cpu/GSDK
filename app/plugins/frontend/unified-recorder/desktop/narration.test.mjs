import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNarrationStore, normalizeTranscription, resolveOpenRouterApiKey, transcribeAudio } from './narration.mjs'

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
      const result = await store.save({ sessionId: 'clip-1', bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm', transcriptionBytes: new Uint8Array([4, 5]), transcriptionFormat: 'wav', startedAt: '2026-09-23T00:00:01.000Z', narrationStartedAt: '2026-09-23T00:00:00.000Z', durationMs: 2000, timeoutMs: 10_000 })
      expect(result.subtitles).toMatchObject([{ id: 'clip-1:0', startMs: 1250, endMs: 2500, text: '你好' }])
      expect(requests[0]).toMatchObject({ model: 'microsoft/mai-transcribe-2', response_format: 'verbose_json', timestamp_granularities: ['word'], input_audio: { format: 'wav', data: 'BAU=' } })
      expect(await readFile(join(directory, 'clip-1.webm'))).toEqual(Buffer.from([1, 2, 3]))
      await store.correct('clip-1:0', '您好')
      expect((await store.readIndex()).subtitles[0].text).toBe('您好')
      expect(await readFile(join(directory, 'subtitles.srt'), 'utf8')).toContain('00:00:01,250 --> 00:00:02,500\n您好')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('retries with segment timestamps when a provider rejects word granularity', async () => {
    const requests = []
    const result = await transcribeAudio({
      bytes: new Uint8Array([1]), format: 'webm', timeoutMs: 10000, apiKey: 'test-key',
      fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body).timestamp_granularities)
        return requests.length === 1
          ? { ok: false, status: 400 }
          : { ok: true, json: async () => ({ segments: [] }) }
      },
    })
    expect(result).toEqual({ segments: [] })
    expect(requests).toEqual([['word'], ['segment']])
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

  it('splits a single provider segment at actual word pauses', () => {
    const result = normalizeTranscription({
      segments: [{ start: 5.5, end: 24.8, text: '再次录制测试。浏览器打开测试。本地文件测试。' }],
      words: [
        { start: 5.5, end: 8.1, word: '再次录制测试。' },
        { start: 12.4, end: 16.2, word: '浏览器打开测试。' },
        { start: 20.1, end: 24.8, word: '本地文件测试。' },
      ],
    }, 25000)
    expect(result).toEqual([
      { startMs: 5500, endMs: 8100, text: '再次录制测试。' },
      { startMs: 12400, endMs: 16200, text: '浏览器打开测试。' },
      { startMs: 20100, endMs: 24800, text: '本地文件测试。' },
    ])
  })

  it('splits MAI Chinese word timestamps at sentence punctuation', () => {
    const result = normalizeTranscription({
      text: '音频片段一。音频片段二。',
      segments: [{ start: 0, end: 13.68, text: '音频片段一。音频片段二。' }],
      words: [
        { word: '音', start: 3.48, end: 3.56 }, { word: '频', start: 3.64, end: 3.72 },
        { word: '片', start: 3.88, end: 3.96 }, { word: '段', start: 4.04, end: 4.12 },
        { word: '一', start: 4.36, end: 4.44 }, { word: '。', start: 4.72, end: 4.8 },
        { word: '音', start: 10.44, end: 10.52 }, { word: '频', start: 10.6, end: 10.68 },
        { word: '片', start: 10.84, end: 10.92 }, { word: '段', start: 10.96, end: 11.04 },
        { word: '二', start: 11.2, end: 11.279 }, { word: '。', start: 11.44, end: 11.52 },
      ],
    }, 13680)
    expect(result).toEqual([
      { startMs: 3480, endMs: 4800, text: '音频片段一。' },
      { startMs: 10440, endMs: 11520, text: '音频片段二。' },
    ])
  })

  it('uses detected speech ranges when the provider only returns one combined segment', () => {
    const result = normalizeTranscription({
      segments: [{ start: 5.5, end: 24.8, text: '再次录制测试。浏览器打开测试。本地文件测试。' }],
    }, 25000, [
      { startMs: 5400, endMs: 8200 },
      { startMs: 12300, endMs: 16300 },
      { startMs: 20000, endMs: 24900 },
    ])
    expect(result).toEqual([
      { startMs: 5400, endMs: 8200, text: '再次录制测试。' },
      { startMs: 12300, endMs: 16300, text: '浏览器打开测试。' },
      { startMs: 20000, endMs: 24900, text: '本地文件测试。' },
    ])
  })

  it('rejects a zero-duration provider timestamp and uses recorded pauses', () => {
    const result = normalizeTranscription({
      text: '音频片段一，音频片段二。',
      segments: [{ start: 11.44, end: 11.44, text: '音频片段一，音频片段二。' }],
      words: [{ start: 11.44, end: 11.44, word: '音频片段一，音频片段二。' }],
    }, 13680, [{ startMs: 3240, endMs: 5100 }, { startMs: 10280, endMs: 11520 }])
    expect(result).toEqual([
      { startMs: 3240, endMs: 5100, text: '音频片段一，' },
      { startMs: 10280, endMs: 11520, text: '音频片段二。' },
    ])
  })

  it('groups short within-sentence pauses using the longer gaps in the recorded clip', () => {
    const result = normalizeTranscription({
      segments: [{ start: 0, end: 19.32, text: '再次录制测试。浏览器打开测试。本地文件测试。' }],
    }, 19320, [
      { startMs: 0, endMs: 3600 },
      { startMs: 4280, endMs: 6060 },
      { startMs: 6680, endMs: 9540 },
      { startMs: 10780, endMs: 15320 },
    ])
    expect(result).toEqual([
      { startMs: 0, endMs: 3600, text: '再次录制测试。' },
      { startMs: 4280, endMs: 9540, text: '浏览器打开测试。' },
      { startMs: 10780, endMs: 15320, text: '本地文件测试。' },
    ])
  })

  it('persists separate subtitles when transcription returns one segment for three utterances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'narration-pauses-'))
    try {
      const store = createNarrationStore({
        directory, apiKey: 'test-key',
        fetchImpl: async () => ({ ok: true, json: async () => ({
          segments: [{ start: 0, end: 19.32, text: '再次录制测试。浏览器打开测试。本地文件测试。' }],
        }) }),
      })
      const result = await store.save({
        sessionId: 'clip-3', bytes: new Uint8Array([1]), mimeType: 'audio/webm',
        startedAt: '2026-09-23T00:00:05.515Z', narrationStartedAt: '2026-09-23T00:00:00.000Z',
        durationMs: 19320, timeoutMs: 10000,
        speechRanges: [
          { startMs: 0, endMs: 3600 }, { startMs: 4280, endMs: 6060 },
          { startMs: 6680, endMs: 9540 }, { startMs: 10780, endMs: 15320 },
        ],
      })
      expect(result.subtitles.map((item) => [item.startMs, item.endMs, item.text])).toEqual([
        [5515, 9115, '再次录制测试。'],
        [9795, 15055, '浏览器打开测试。'],
        [16295, 20835, '本地文件测试。'],
      ])
      expect((await readFile(join(directory, 'subtitles.srt'), 'utf8')).match(/-->/g)).toHaveLength(3)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
