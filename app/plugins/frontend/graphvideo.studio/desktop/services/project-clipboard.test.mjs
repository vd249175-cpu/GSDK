import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importProjectNodeVersion, openLocalProject, saveProjectNode } from './project-store.mjs'
import { copyProjectVersions, writeSystemFileClipboard } from './project-clipboard.mjs'

let projectRoot
let versions

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'graphvideo-clipboard-'))
  await openLocalProject(projectRoot)
  versions = []
  for (const [id, fileName] of [['image_one', 'one.png'], ['audio_two', 'two.wav']]) {
    const sourcePath = join(projectRoot, fileName)
    await writeFile(sourcePath, `${id}-bytes`)
    const node = await saveProjectNode(projectRoot, {
      id, type: id.startsWith('image') ? 'image' : 'audio', title: id,
      description: '', prompt: '', history: [],
    })
    const imported = await importProjectNodeVersion(projectRoot, node.id, sourcePath)
    versions.push({ nodeId: node.id, versionId: imported.history[0].id })
  }
})

afterEach(async () => {
  const resolvedRoot = resolve(projectRoot)
  const safeParent = resolve(tmpdir())
  if (resolvedRoot.startsWith(safeParent) && basename(resolvedRoot).startsWith('graphvideo-clipboard-')) {
    await rm(resolvedRoot, { recursive: true, force: true })
  }
})

describe('project version clipboard', () => {
  it('resolves registered files in source order and removes duplicates', () => {
    const writer = vi.fn(() => 'files')
    expect(copyProjectVersions(
      projectRoot, [versions[1], versions[0], versions[1]], writer,
    )).toEqual({ count: 2, mode: 'files' })
    const paths = writer.mock.calls[0][0]
    expect(paths).toHaveLength(2)
    expect(paths[0]).toMatch(/\.wav$/)
    expect(paths[1]).toMatch(/\.png$/)
  })

  it('writes a Windows file-drop clipboard through an encoded STA command', () => {
    const run = vi.fn(() => ({ status: 0 }))
    const writeText = vi.fn()
    expect(writeSystemFileClipboard(['C:\\media\\one.png'], {
      platform: 'win32', run, writeText,
    })).toBe('files')
    expect(run).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-STA', '-EncodedCommand']),
      expect.objectContaining({ windowsHide: true }),
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('writes a macOS file-drop clipboard through an osascript command', () => {
    const run = vi.fn(() => ({ status: 0 }))
    const writeText = vi.fn()
    expect(writeSystemFileClipboard(['/media/one.png'], {
      platform: 'darwin', run, writeText,
    })).toBe('files')
    expect(run).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'set the clipboard to {POSIX file "/media/one.png"}'],
      { encoding: 'utf8' },
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to newline-separated paths when macOS osascript fails or outside supported platforms', () => {
    const writeText = vi.fn()
    expect(writeSystemFileClipboard(['/one.png', '/two.wav'], {
      platform: 'darwin', run: vi.fn(() => ({ status: 1 })), writeText,
    })).toBe('paths')
    expect(writeText).toHaveBeenCalledWith('/one.png\n/two.wav')

    const writeTextLinux = vi.fn()
    expect(writeSystemFileClipboard(['/one.png', '/two.wav'], {
      platform: 'linux', run: vi.fn(), writeText: writeTextLinux,
    })).toBe('paths')
    expect(writeTextLinux).toHaveBeenCalledWith('/one.png\n/two.wav')
  })

  it('rejects an unregistered version before writing the clipboard', () => {
    const writer = vi.fn()
    expect(() => copyProjectVersions(
      projectRoot, [{ nodeId: versions[0].nodeId, versionId: 'missing' }], writer,
    )).toThrow('不存在')
    expect(writer).not.toHaveBeenCalled()
  })
})
