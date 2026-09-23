import { describe, expect, it } from 'vitest'
import { newestSubtitlesFirst } from './subtitleOrder'

describe('subtitle ordering', () => {
  it('shows the latest recording time first without changing the source list', () => {
    const subtitles = [
      { id: 'earlier', startMs: 52 * 60_000 + 33_000, endMs: 52 * 60_000 + 48_000 },
      { id: 'latest', startMs: 62 * 60_000 + 31_000, endMs: 62 * 60_000 + 44_000 },
      { id: 'middle', startMs: 58 * 60_000, endMs: 58 * 60_000 + 1_000 },
    ]
    expect(newestSubtitlesFirst(subtitles).map((item) => item.id)).toEqual(['latest', 'middle', 'earlier'])
    expect(subtitles[0].id).toBe('earlier')
  })
})
