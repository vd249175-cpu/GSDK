import { describe, expect, it } from 'vitest'
import { alignRecordingEvents, buildSharedTimeline, correlateDesktopEvents, formatOffset, formatTimestamp, renderSharedTimeline } from './recording-timeline.mjs'

describe('recording timeline', () => {
  it('renders agent-facing times to seconds while retaining millisecond offsets', () => {
    expect(formatOffset(5515)).toBe('00:00:06')
    expect(formatTimestamp('2026-09-23T02:39:18.499Z')).toBe('2026-09-23T02:39:18Z')
    expect(formatTimestamp(null)).toBe('')
  })
  it('aligns local clock readings and hook timestamps to one session start across midnight', () => {
    const startedAt = new Date(2026, 8, 23, 23, 59, 58, 500).toISOString()
    const completedAt = new Date(2026, 8, 24, 0, 0, 3).toISOString()
    const hookAt = new Date(2026, 8, 24, 0, 0, 0, 123).toISOString()
    const events = alignRecordingEvents([
      { index: 1, source: 'desktop', time: '23:59:59', action: 'click' },
      { index: 2, source: 'desktop', timestamp: hookAt, time: '12:00:00 am', action: 'click' },
      { index: 3, source: 'browser', time: '00:00:01', timeSource: 'desktop-pair', action: 'fill' },
      { index: 4, source: 'browser', time: null, action: 'goto' },
    ], startedAt, completedAt)
    expect(events.map((event) => event.atMs)).toEqual([500, 1623, 2500, null])
    expect(events.map((event) => event.timeSource)).toEqual(['desktop-clock', 'input-hook', 'desktop-pair', null])
    expect(events[3].timestamp).toBeNull()
  })

  it('interleaves speech and operations while leaving untimed browser time blank', () => {
    const startedAt = '2026-09-23T00:00:00.000Z'
    const events = [
      { index: 1, source: 'desktop', atMs: 1500, timestamp: '2026-09-23T00:00:01.500Z', timeSource: 'input-hook', action: 'click', description: 'Click button' },
      { index: 2, source: 'browser', atMs: null, timestamp: null, timeSource: null, action: 'goto', description: 'Navigate' },
    ]
    const subtitles = [{ id: 'voice:0', startMs: 1200, endMs: 2200, text: '点击这里' }]
    const timeline = buildSharedTimeline({ events, subtitles, startedAt })
    expect(timeline.map((item) => [item.kind, item.atMs])).toEqual([['speech', 1200], ['operation', 1500], ['operation', null]])
    expect(timeline[0].timestamp).toBe('2026-09-23T00:00:01.200Z')
    const markdown = renderSharedTimeline({ startedAt, timeline })
    expect(markdown).not.toContain('时间未知')
    expect(markdown).toContain('| 00:00:01 | 2026-09-23T00:00:01Z | Speech | 点击这里 |')
    expect(markdown).not.toContain('.200Z')
    expect(markdown).toContain('|  |  | Browser | Navigate |')
  })

  it('uses distinct millisecond hook times only for matching desktop steps', () => {
    const startedAt = '2026-09-23T00:00:00.000Z'
    const psr = [
      { source: 'desktop', application: 'CHROME.EXE', action: 'Mouse Left Click', time: new Date('2026-09-23T00:00:02.000Z').toLocaleTimeString() },
      { source: 'desktop', application: 'CHROME.EXE', action: 'Mouse Left Click', time: new Date('2026-09-23T00:00:02.000Z').toLocaleTimeString() },
      { source: 'desktop', application: 'NOTEPAD.EXE', action: 'Keyboard Input', time: new Date('2026-09-23T00:00:03.000Z').toLocaleTimeString() },
    ]
    const hook = [
      { source: 'desktop', application: 'CHROME.EXE', action: 'Mouse Left Click', timestamp: '2026-09-23T00:00:02.123Z' },
      { source: 'desktop', application: 'CHROME.EXE', action: 'Mouse Left Click', timestamp: '2026-09-23T00:00:02.789Z' },
    ]
    const result = correlateDesktopEvents(psr, hook, startedAt, '2026-09-23T00:00:05.000Z')
    expect(result.map((event) => event.timestamp)).toEqual([
      '2026-09-23T00:00:02.123Z', '2026-09-23T00:00:02.789Z', '2026-09-23T00:00:03.000Z',
    ])
    expect(result.map((event) => event.timeSource)).toEqual(['hook-correlated', 'hook-correlated', 'desktop-clock'])
  })
})
