import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createUnifiedAdapters, formatRecordingDirectoryName } from '../bridge/unified-adapters.mjs'

describe('recording directory names', () => {
  it('includes local year, month, day and the start/end time to the second', () => {
    expect(formatRecordingDirectoryName({
      sessionId: 'unified-123',
      startedAt: new Date(2026, 8, 23, 10, 2, 6),
      completedAt: new Date(2026, 8, 23, 10, 5, 9),
    })).toBe('2026-09-23_10-02-06__2026-09-23_10-05-09_unified-123')
  })

  it('includes both dates when a recording crosses midnight', () => {
    expect(formatRecordingDirectoryName({
      sessionId: 'night',
      startedAt: new Date(2026, 8, 23, 23, 59, 58),
      completedAt: new Date(2026, 8, 24, 0, 0, 2),
    })).toBe('2026-09-23_23-59-58__2026-09-24_00-00-02_night')
  })

  it('renames a completed session and keeps the recorded files', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'unified-dir-test-'))
    try {
      const adapters = createUnifiedAdapters({
        runCli: async () => '',
        recordingsDirectory: join(tempRoot, 'recordings'),
        enablePsr: false,
        enableInputObserver: false,
      })
      const started = await adapters.desktopControl.execute({ op: 'start', sessionId: 'flow-1' })
      await writeFile(join(started.sessionDir, 'marker.txt'), 'recorded content')
      const stopped = await adapters.desktopControl.execute({ op: 'stop', sessionId: 'flow-1' })
      expect(basename(stopped.sessionDir)).toBe(formatRecordingDirectoryName({
        sessionId: 'flow-1', startedAt: started.startedAt, completedAt: stopped.completedAt,
      }))
      expect(await readFile(join(stopped.sessionDir, 'marker.txt'), 'utf8')).toBe('recorded content')
      await expect(stat(started.sessionDir)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (dirname(resolve(tempRoot)) !== resolve(tmpdir()) || !basename(tempRoot).startsWith('unified-dir-test-')) throw new Error('Unsafe test cleanup target')
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
