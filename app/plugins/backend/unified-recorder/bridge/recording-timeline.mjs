const validDate = (value) => {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

export const formatOffset = (atMs) => {
  if (!Number.isFinite(atMs)) return ''
  const value = Math.max(0, Math.round(atMs / 1000))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor(value / 60) % 60
  const seconds = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const formatTimestamp = (timestamp) => {
  const value = validDate(timestamp)
  return value === null ? '' : new Date(Math.round(value / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z')
}

export const timestampAt = (startedAt, atMs) => {
  const start = validDate(startedAt)
  const value = start === null || !Number.isFinite(atMs) ? NaN : start + atMs
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value).toISOString() : null
}

function clockTimestamp(time, startedAt, completedAt) {
  if (typeof time !== 'string') return null
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i)
  if (!match) return validDate(time)
  const start = validDate(startedAt)
  if (start === null) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  const meridian = match[4]?.toLowerCase()
  if (hour > 23 || minute > 59 || second > 59 || (meridian && (hour < 1 || hour > 12))) return null
  if (meridian) hour = hour % 12 + (meridian === 'p' ? 12 : 0)
  const sessionEnd = validDate(completedAt) ?? start + 12 * 3_600_000
  const candidates = [-1, 0, 1].map((day) => {
    const value = new Date(start)
    value.setDate(value.getDate() + day)
    value.setHours(hour, minute, second, 0)
    return value.getTime()
  })
  return candidates.find((value) => value >= start - 3_000 && value <= sessionEnd + 3_000) ?? null
}

export function alignRecordingEvents(events, startedAt, completedAt) {
  const start = validDate(startedAt)
  return events.map((event) => {
    const precise = validDate(event.timestamp)
    const clock = precise === null ? clockTimestamp(event.time, startedAt, completedAt) : null
    const observed = precise ?? clock
    const atMs = start !== null && observed !== null ? Math.max(0, observed - start) : null
    const timeSource = observed === null ? null : event.timeSource
      ?? (precise !== null ? event.source === 'browser' ? 'browser-observation' : 'input-hook'
        : event.source === 'browser' ? 'desktop-pair' : 'desktop-clock')
    return {
      ...event,
      atMs,
      timestamp: observed !== null ? new Date(observed).toISOString() : null,
      timeSource,
    }
  })
}

const actionFamily = (action) => {
  if (/click/i.test(action ?? '')) return 'click'
  if (/keyboard|key|typ|press/i.test(action ?? '')) return 'keyboard'
  if (/scroll|wheel/i.test(action ?? '')) return 'scroll'
  return null
}

export function correlateDesktopEvents(psrEvents, hookEvents, startedAt, completedAt) {
  const steps = alignRecordingEvents(psrEvents, startedAt, completedAt)
  const hooks = alignRecordingEvents(hookEvents, startedAt, completedAt)
  const used = new Set()
  return steps.map((step) => {
    const family = actionFamily(step.action)
    if (step.atMs === null || !family) return step
    let best = -1
    let distance = 1_501
    for (let position = 0; position < hooks.length; position += 1) {
      const hook = hooks[position]
      if (used.has(position) || hook.atMs === null || actionFamily(hook.action) !== family) continue
      if (step.application && hook.application && step.application.toUpperCase() !== hook.application.toUpperCase()) continue
      const delta = Math.abs(step.atMs - hook.atMs)
      if (delta < distance) { best = position; distance = delta }
    }
    if (best < 0 || distance > 1_500) return step
    used.add(best)
    return { ...step, atMs: hooks[best].atMs, timestamp: hooks[best].timestamp, timeSource: 'hook-correlated' }
  })
}

export function buildSharedTimeline({ events = [], browserObservations = [], subtitles = [], startedAt }) {
  const operations = events.map((event) => ({
    kind: 'operation', source: event.source, eventIndex: event.index,
    atMs: Number.isFinite(event.atMs) ? event.atMs : null,
    timestamp: event.timestamp ?? null, timeSource: event.timeSource ?? null,
    description: event.description ?? event.action ?? '',
  }))
  const observations = browserObservations.map((event) => ({
    kind: 'observation', source: 'browser', eventIndex: event.index,
    atMs: Number.isFinite(event.atMs) ? event.atMs : null,
    timestamp: event.timestamp ?? null, timeSource: event.timeSource ?? null,
    description: event.description ?? event.action ?? '',
  }))
  const speech = subtitles.map((item) => ({
    kind: 'speech', source: 'audio', subtitleId: item.id,
    atMs: item.startMs, endMs: item.endMs,
    timestamp: item.timestamp ?? timestampAt(startedAt, item.startMs),
    timeSource: 'audio-transcription', description: item.text,
  }))
  return [...operations, ...observations, ...speech].sort((left, right) => {
    if (left.atMs === null) return right.atMs === null ? 0 : 1
    if (right.atMs === null) return -1
    return left.atMs - right.atMs
  })
}

export function renderSharedTimeline({ startedAt, timeline }) {
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return [
    '# Aligned Recording Timeline',
    '',
    `- Session started: ${formatTimestamp(startedAt)}`,
    '- Operation and speech offsets use the same session start.',
    '',
    '| Session time | Timestamp | Track | Detail |',
    '| --- | --- | --- | --- |',
    ...timeline.map((item) => {
      const track = item.kind === 'speech' ? 'Speech' : item.kind === 'observation' ? 'Browser observation'
        : item.source === 'browser' ? 'Browser' : 'Desktop'
      return `| ${item.atMs === null ? '' : formatOffset(item.atMs)} | ${formatTimestamp(item.timestamp)} | ${track} | ${cell(item.description)} |`
    }),
    '',
  ].join('\n')
}
