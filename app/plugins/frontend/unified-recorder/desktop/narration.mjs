import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SESSION_ID = /^[a-zA-Z0-9_-]{1,100}$/
const DEFAULT_STT_MODEL = 'microsoft/mai-transcribe-2'

export async function resolveOpenRouterApiKey({ credentialsPath, environment = process.env }) {
  const fromEnvironment = environment.OPENROUTER_API_KEY?.trim()
  if (fromEnvironment) return fromEnvironment
  try {
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
    return typeof credentials?.openrouter?.apiKey === 'string' ? credentials.openrouter.apiKey.trim() : null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
const srtTime = (ms) => {
  const value = Math.max(0, Math.round(ms))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor(value / 60_000) % 60
  const seconds = Math.floor(value / 1000) % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(value % 1000).padStart(3, '0')}`
}

export const subtitlesToSrt = (subtitles) => subtitles.map((item, index) => (
  `${index + 1}\n${srtTime(item.startMs)} --> ${srtTime(Math.max(item.startMs, item.endMs))}\n${item.text}\n`
)).join('\n')

const timedPart = (part, field = 'text') => ({
  startMs: Math.max(0, Math.round(Number(part.start) * 1000) || 0),
  endMs: Math.max(0, Math.round(Number(part.end) * 1000) || 0),
  text: String(part[field] ?? '').trim(),
})

const sentences = (text) => (text.match(/[^。！？!?；;，,]+[。！？!?；;，,]?/gu) ?? [])
  .map((part) => part.trim()).filter(Boolean)

const joinAtLargestPauses = (parts, count) => {
  if (parts.length < count || count < 2) return []
  const gaps = parts.slice(1).map((part, index) => ({
    after: index, duration: part.startMs - parts[index].endMs,
  }))
    .filter((gap) => gap.duration >= 450)
    .sort((left, right) => right.duration - left.duration)
    .slice(0, count - 1)
  if (gaps.length !== count - 1) return []
  const boundaries = new Set(gaps.map((gap) => gap.after))
  const groups = []
  let group = []
  parts.forEach((part, index) => {
    group.push(part)
    if (boundaries.has(index) || index === parts.length - 1) {
      groups.push(group)
      group = []
    }
  })
  return groups
}

const splitTimedWords = (words, sourceText) => {
  const valid = words.filter((word) => typeof (word.word ?? word.text) === 'string')
    .map((word) => timedPart(word, typeof word.word === 'string' ? 'word' : 'text'))
    .filter((word) => word.text && word.endMs >= word.startMs)
  if (!valid.length) return []
  const originalSentences = sentences(sourceText)
  if (originalSentences.length > 1) {
    const markedBoundaries = valid.slice(0, -1).flatMap((word, index) =>
      /[。！？!?；;，,]$/.test(word.text) ? [index] : [])
    const groups = markedBoundaries.length === originalSentences.length - 1
      ? valid.reduce((all, word, index) => {
          if (index === 0 || markedBoundaries.includes(index - 1)) all.push([])
          all.at(-1).push(word)
          return all
        }, [])
      : joinAtLargestPauses(valid, originalSentences.length)
    if (groups.length === originalSentences.length) return groups.map((group, index) => ({
      startMs: group[0].startMs, endMs: group.at(-1).endMs, text: originalSentences[index],
    }))
  }
  const groups = []
  for (const word of valid) {
    const previous = groups.at(-1)
    if (!previous || word.startMs - previous.endMs >= 500 || /[。！？!?；;，,]$/.test(previous.text)) {
      groups.push({ ...word })
    } else {
      previous.endMs = Math.max(previous.endMs, word.endMs)
      previous.text += /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(word.text)
        ? ` ${word.text}` : word.text
    }
  }
  return groups
}

export function normalizeTranscription(result, durationMs, speechRanges = []) {
  const segments = Array.isArray(result?.segments) ? result.segments : []
  const normalized = segments
    .filter((part) => typeof part.text === 'string' && part.text.trim())
    .map((part) => timedPart(part))
  if (normalized.length > 1) return normalized
  const text = typeof result?.text === 'string' ? result.text.trim() : ''
  const combined = normalized[0] ?? (text ? { startMs: 0, endMs: Math.max(0, durationMs), text } : null)
  const words = Array.isArray(result?.words) ? result.words : []
  const wordParts = splitTimedWords(words, combined?.text ?? text)
  if (wordParts.length > 1) return wordParts
  if (!combined) return wordParts
  const parts = sentences(combined.text)
  const ranges = (Array.isArray(speechRanges) ? speechRanges : []).filter((range) =>
    Number.isFinite(range?.startMs) && Number.isFinite(range?.endMs) && range.endMs > range.startMs)
    .sort((left, right) => left.startMs - right.startMs)
  const groupedRanges = joinAtLargestPauses(ranges, parts.length)
  if (parts.length > 1 && groupedRanges.length === parts.length) {
    return groupedRanges.map((group, index) => ({
      startMs: group[0].startMs,
      endMs: group.at(-1).endMs,
      text: parts[index],
    }))
  }
  return [combined]
}

export async function transcribeAudio({ bytes, format, timeoutMs, apiKey, model = DEFAULT_STT_MODEL, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('请配置 OPENROUTER_API_KEY 或本机 credentials.json 的 openrouter.apiKey；声音已保存在本机')
  const deadline = Date.now() + timeoutMs
  const request = (granularities) => fetchImpl('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input_audio: { data: Buffer.from(bytes).toString('base64'), format },
      response_format: 'verbose_json',
      timestamp_granularities: granularities,
    }),
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  })
  let response = await request(['word'])
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await request(['segment'])
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenRouter 转写失败 (${response.status}): ${body.slice(0, 300)}`)
  }
  return response.json()
}

export function createNarrationStore({ directory, apiKey = process.env.OPENROUTER_API_KEY, model = process.env.OPENROUTER_STT_MODEL ?? DEFAULT_STT_MODEL, fetchImpl = fetch }) {
  const indexPath = join(directory, 'subtitles.json')
  let indexQueue = Promise.resolve()
  const assertSession = (sessionId) => {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error('Invalid audio session ID')
  }
  const readIndex = async () => {
    try { return JSON.parse(await readFile(indexPath, 'utf8')) }
    catch (error) {
      if (error?.code === 'ENOENT') return { narrationStartedAt: null, subtitles: [], audioClips: [] }
      throw error
    }
  }
  const writeIndex = async (value) => {
    await mkdir(directory, { recursive: true })
    const temporary = `${indexPath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporary, indexPath)
    await writeFile(join(directory, 'subtitles.srt'), subtitlesToSrt(value.subtitles), 'utf8')
  }
  const updateIndex = (update) => {
    const job = indexQueue.then(async () => {
      const index = await readIndex()
      await update(index)
      await writeIndex(index)
      return index
    })
    indexQueue = job.catch(() => {})
    return job
  }
  return {
    readIndex,
    readAudio: async (sessionId) => {
      assertSession(sessionId)
      return readFile(join(directory, `${sessionId}.webm`))
    },
    correct: async (id, text) => {
      if (typeof id !== 'string' || typeof text !== 'string' || text.length > 2000) throw new Error('Invalid subtitle correction')
      return updateIndex((index) => {
        const item = index.subtitles.find((entry) => entry.id === id)
        if (!item) throw new Error('Subtitle not found')
        item.text = text.trim()
      })
    },
    linkRecording: async (sessionId, sessionDirectory) => {
      assertSession(sessionId)
      if (typeof sessionDirectory !== 'string' || !sessionDirectory) throw new Error('Invalid recording directory')
      return updateIndex((index) => {
        if (!index.audioClips.some((item) => item.sessionId === sessionId)) throw new Error('Audio clip not found')
        index.recordingDirectories = { ...index.recordingDirectories, [sessionId]: sessionDirectory }
      })
    },
    save: async ({ sessionId, bytes, mimeType, transcriptionBytes = bytes, transcriptionFormat = 'webm', startedAt, durationMs, timeoutMs, narrationStartedAt, speechRanges = [] }) => {
      assertSession(sessionId)
      if (mimeType !== 'audio/webm' && mimeType !== 'audio/webm;codecs=opus') throw new Error('Only WebM/Opus audio is supported')
      if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 100_000_000) throw new Error('Invalid audio data')
      if (!(transcriptionBytes instanceof Uint8Array) || transcriptionBytes.length === 0 || transcriptionBytes.length > 100_000_000) throw new Error('Invalid transcription audio data')
      if (transcriptionFormat !== 'wav' && transcriptionFormat !== 'webm') throw new Error('Invalid transcription audio format')
      const limit = Math.min(600_000, Math.max(5_000, Number(timeoutMs) || 120_000))
      const deadline = Date.now() + limit
      await mkdir(directory, { recursive: true })
      const audioFile = `${sessionId}.webm`
      await writeFile(join(directory, audioFile), bytes, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
      let segments = []
      let transcriptionError = null
      try {
        const resolvedApiKey = typeof apiKey === 'function' ? await apiKey() : apiKey
        const result = await transcribeAudio({ bytes: transcriptionBytes, format: transcriptionFormat, timeoutMs: Math.max(1, deadline - Date.now()), apiKey: resolvedApiKey, model, fetchImpl })
        segments = normalizeTranscription(result, durationMs, speechRanges)
      } catch (error) {
        transcriptionError = error instanceof Error ? error.message : String(error)
      }
      const index = await updateIndex((current) => {
        const origin = current.narrationStartedAt ?? narrationStartedAt ?? startedAt
        const offset = Math.max(0, Date.parse(startedAt) - Date.parse(origin)) || 0
        const subtitles = segments.map((part, position) => ({
          id: `${sessionId}:${position}`, sessionId,
          startMs: offset + part.startMs, endMs: offset + part.endMs, text: part.text,
        }))
        current.narrationStartedAt = origin
        current.subtitles = [...current.subtitles.filter((item) => item.sessionId !== sessionId), ...subtitles].sort((a, b) => a.startMs - b.startMs)
        current.audioClips = [...current.audioClips.filter((item) => item.sessionId !== sessionId), { sessionId, audioFile, startMs: offset, durationMs }]
      })
      const subtitles = index.subtitles.filter((item) => item.sessionId === sessionId)
      return { audioFile, segments, transcriptionError, subtitles, index }
    },
  }
}
