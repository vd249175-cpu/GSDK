import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { subtitlesToSrt } from './narration.mjs'
import { alignRecordingEvents, buildSharedTimeline, formatOffset, formatTimestamp, renderSharedTimeline, timestampAt } from '../../../backend/unified-recorder/bridge/recording-timeline.mjs'

const SESSION_ID = /^[a-zA-Z0-9_-]{1,100}$/
export async function mergeNarrationIntoRecording({ sessionId, sessionDirectory, recordingsDirectory, narrationDirectory, index }) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error('Invalid recording session ID')
  const directory = resolve(sessionDirectory)
  if (dirname(directory) !== resolve(recordingsDirectory)) throw new Error('Recording directory is outside its data root')
  const clip = index.audioClips?.find((item) => item.sessionId === sessionId)
  if (!clip) return { merged: false }

  const jsonPath = join(directory, 'unified-events.json')
  const record = JSON.parse(await readFile(jsonPath, 'utf8'))
  if (record.sessionId !== sessionId) throw new Error('Recording session ID does not match the exported record')
  const transcriptPath = join(directory, 'agent-transcript.md')
  const transcript = await readFile(transcriptPath, 'utf8')
  const origin = Date.parse(index.narrationStartedAt ?? '')
  const started = Date.parse(record.startedAt ?? '')
  const shift = Number.isFinite(origin) && Number.isFinite(started) ? origin - started : 0
  const toLocal = (value) => Math.max(0, Math.round(Number(value) + shift) || 0)
  record.events = alignRecordingEvents(record.events ?? [], record.startedAt, record.completedAt)
  record.browserObservations = alignRecordingEvents(record.browserObservations ?? [], record.startedAt, record.completedAt)
  const subtitles = (index.subtitles ?? [])
    .filter((item) => item.sessionId === sessionId)
    .map((item) => ({
      id: item.id, startMs: toLocal(item.startMs), endMs: toLocal(item.endMs), text: item.text,
      timestamp: timestampAt(record.startedAt, toLocal(item.startMs)),
    }))
    .sort((left, right) => left.startMs - right.startMs)
  const audioFile = 'audio/narration.webm'
  await mkdir(join(directory, 'audio'), { recursive: true })
  const audioPath = join(directory, 'audio', 'narration.webm')
  try { await access(audioPath) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await copyFile(join(narrationDirectory, `${sessionId}.webm`), audioPath)
  }
  await writeFile(join(directory, 'subtitles.srt'), subtitlesToSrt(subtitles), 'utf8')

  const clipStartMs = toLocal(clip.startMs)
  record.narration = {
    audioClips: [{ audioFile, startMs: clipStartMs, timestamp: timestampAt(record.startedAt, clipStartMs), durationMs: clip.durationMs }],
    subtitles,
    subtitlesFile: 'subtitles.srt',
    transcriptFile: 'narration-transcript.md',
  }
  record.timeBase = { startedAt: record.startedAt, unit: 'ms' }
  record.timeline = buildSharedTimeline({
    events: record.events, browserObservations: record.browserObservations,
    subtitles, startedAt: record.startedAt,
  })
  const narrationTranscript = [
    `# Voice Narration: ${sessionId}`,
    '',
    `- Audio: ${audioFile}`,
    '- Subtitles: subtitles.srt',
    `- Recording started: ${formatTimestamp(record.startedAt)}`,
    '',
    '## Timed Speech',
    '',
    ...subtitles.map((item) => `- ${formatOffset(item.startMs)}–${formatOffset(item.endMs)} | ${formatTimestamp(item.timestamp)} | ${item.text}`),
    '',
  ].join('\n')
  const nextTranscript = transcript.replace(/\n?<!-- voice-narration:start -->[\s\S]*?<!-- voice-narration:end -->\n?/, '\n')
  const temporary = `${jsonPath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2), 'utf8')
  await rename(temporary, jsonPath)
  await writeFile(join(directory, 'aligned-timeline.md'), renderSharedTimeline({ startedAt: record.startedAt, timeline: record.timeline }), 'utf8')
  await writeFile(join(directory, 'narration-transcript.md'), narrationTranscript, 'utf8')
  if (nextTranscript !== transcript) await writeFile(transcriptPath, nextTranscript, 'utf8')
  return { merged: true }
}

export async function backfillNarrationTranscripts({ recordingsDirectory, narrationDirectory, index }) {
  let updated = 0
  const errors = []
  for (const [sessionId, sessionDirectory] of Object.entries(index.recordingDirectories ?? {})) {
    if (!index.audioClips?.some((clip) => clip.sessionId === sessionId)) continue
    try {
      await access(join(sessionDirectory, 'narration-transcript.md'))
      await access(join(sessionDirectory, 'aligned-timeline.md'))
      continue
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        errors.push({ sessionId, message: error.message })
        continue
      }
    }
    try {
      await mergeNarrationIntoRecording({ sessionId, sessionDirectory, recordingsDirectory, narrationDirectory, index })
      updated += 1
    } catch (error) {
      errors.push({ sessionId, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { updated, errors }
}
