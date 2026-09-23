import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { subtitlesToSrt } from './narration.mjs'

const SESSION_ID = /^[a-zA-Z0-9_-]{1,100}$/
const START_MARKER = '<!-- voice-narration:start -->'
const END_MARKER = '<!-- voice-narration:end -->'

const timeLabel = (value) => {
  const seconds = Math.floor(Math.max(0, value) / 1000)
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

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
  const subtitles = (index.subtitles ?? [])
    .filter((item) => item.sessionId === sessionId)
    .map((item) => ({ id: item.id, startMs: toLocal(item.startMs), endMs: toLocal(item.endMs), text: item.text }))
    .sort((left, right) => left.startMs - right.startMs)
  const audioFile = 'audio/narration.webm'
  await mkdir(join(directory, 'audio'), { recursive: true })
  await copyFile(join(narrationDirectory, `${sessionId}.webm`), join(directory, 'audio', 'narration.webm'))
  await writeFile(join(directory, 'subtitles.srt'), subtitlesToSrt(subtitles), 'utf8')

  record.narration = {
    audioClips: [{ audioFile, startMs: toLocal(clip.startMs), durationMs: clip.durationMs }],
    subtitles,
    subtitlesFile: 'subtitles.srt',
  }
  const section = [
    START_MARKER,
    '## Voice Narration',
    '',
    `- Audio: ${audioFile}`,
    '- Subtitles: subtitles.srt',
    '',
    ...subtitles.map((item) => `- ${timeLabel(item.startMs)}–${timeLabel(item.endMs)} ${item.text}`),
    END_MARKER,
  ].join('\n')
  const existingSection = /\n?<!-- voice-narration:start -->[\s\S]*?<!-- voice-narration:end -->\n?/
  const nextTranscript = existingSection.test(transcript)
    ? transcript.replace(existingSection, `\n${section}\n`)
    : `${transcript.trimEnd()}\n\n${section}\n`
  const temporary = `${jsonPath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(record, null, 2), 'utf8')
  await rename(temporary, jsonPath)
  await writeFile(transcriptPath, nextTranscript, 'utf8')
  return { merged: true }
}
