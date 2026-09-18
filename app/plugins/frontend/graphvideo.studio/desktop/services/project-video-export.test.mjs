import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { exportNumberedVideoFiles, sanitizeVideoExportTitle } from './project-video-export.mjs'

let testRoot = ''

afterEach(async () => {
  const resolvedRoot = resolve(testRoot || '.')
  const safeParent = resolve(tmpdir())
  if (resolvedRoot.startsWith(safeParent)
    && basename(resolvedRoot).startsWith('graphvideo-video-export-')) {
    await rm(resolvedRoot, { recursive: true, force: true })
  }
  testRoot = ''
})

describe('flat project video export', () => {
  it('copies videos sequentially without overwriting an existing numbered file', async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'graphvideo-video-export-'))
    const destination = join(testRoot, 'output')
    const first = join(testRoot, 'first.mp4')
    const second = join(testRoot, 'second.webm')
    await writeFile(first, 'first-video')
    await writeFile(second, 'second-video')
    const initial = await exportNumberedVideoFiles(destination, [{
      nodeId: 'node-first', title: '开场: 镜头', sourcePath: first,
    }])
    const repeated = await exportNumberedVideoFiles(destination, [
      { nodeId: 'node-first', title: '开场: 镜头', sourcePath: first },
      { nodeId: 'node-second', title: '结尾', sourcePath: second },
    ])

    expect(initial.exported[0].fileName).toBe('001_开场_ 镜头.mp4')
    expect(repeated.exported.map((item) => item.fileName)).toEqual([
      '001_开场_ 镜头 (2).mp4', '002_结尾.webm',
    ])
    expect(await readFile(repeated.exported[1].destinationPath, 'utf8')).toBe('second-video')
    expect(await readdir(destination)).toHaveLength(3)
  })

  it('normalizes invalid and reserved platform file names', () => {
    expect(sanitizeVideoExportTitle('  <>  ')).toBe('__')
    expect(sanitizeVideoExportTitle('CON')).toBe('_CON')
  })

  it('reports a missing video while continuing to export the remaining files', async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'graphvideo-video-export-'))
    const source = join(testRoot, 'available.mp4')
    await writeFile(source, 'available-video')
    const result = await exportNumberedVideoFiles(join(testRoot, 'output'), [
      { nodeId: 'missing', title: '缺失镜头', sourcePath: join(testRoot, 'missing.mp4') },
      { nodeId: 'available', title: '可用镜头', sourcePath: source },
    ])
    expect(result.skipped).toEqual([expect.objectContaining({ nodeId: 'missing', title: '缺失镜头' })])
    expect(result.skipped[0].reason).toContain('ENOENT')
    expect(result.exported.map((item) => item.fileName)).toEqual(['001_可用镜头.mp4'])
    expect(await readFile(result.exported[0].destinationPath, 'utf8')).toBe('available-video')
  })
})
