import { describe, expect, it } from 'vitest'
import {
  buildPromptFileRows, canMovePromptPath, promptMoveTarget, rebasePromptPath,
  visiblePromptFileRows,
} from './promptFileTree'

describe('Prompt Library file tree', () => {
  it('creates directory and file rows with stable depths', () => {
    expect(buildPromptFileRows([
      { kind: 'file', path: 'common.xml' },
      { kind: 'file', path: 'video/camera.xml' },
      { kind: 'directory', path: 'video/empty' },
      { kind: 'file', path: 'video/style/crt.xml' },
    ])).toEqual([
      { kind: 'directory', name: 'video', path: 'video', depth: 0 },
      { kind: 'directory', name: 'empty', path: 'video/empty', depth: 1 },
      { kind: 'directory', name: 'style', path: 'video/style', depth: 1 },
      { kind: 'file', name: 'crt.xml', path: 'video/style/crt.xml', depth: 2 },
      { kind: 'file', name: 'camera.xml', path: 'video/camera.xml', depth: 1 },
      { kind: 'file', name: 'common.xml', path: 'common.xml', depth: 0 },
    ])
  })

  it('hides descendants of collapsed directories and rebases renamed paths', () => {
    const rows = buildPromptFileRows([
      { kind: 'file', path: 'video/style/crt.xml' },
      { kind: 'file', path: 'common.xml' },
    ])
    expect(visiblePromptFileRows(rows, new Set(['video'])).map((row) => row.path))
      .toEqual(['video', 'common.xml'])
    expect(rebasePromptPath('video/style/crt.xml', 'video', 'visual'))
      .toBe('visual/style/crt.xml')
  })

  it('resolves safe drag targets for files and directories', () => {
    expect(canMovePromptPath('camera.xml', 'video')).toBe(true)
    expect(promptMoveTarget('camera.xml', 'video')).toBe('video/camera.xml')
    expect(canMovePromptPath('video', 'video/style')).toBe(false)
    expect(canMovePromptPath('video/camera.xml', 'video')).toBe(false)
    expect(canMovePromptPath('video/camera.xml', '')).toBe(true)
  })
})
