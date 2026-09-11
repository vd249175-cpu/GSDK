import { describe, expect, it } from 'vitest'
import { parseStudioPluginManifest } from './plugin-manifest.mjs'

describe('Studio plugin manifest', () => {
  it('normalizes a versioned set of front and backend contributions', () => {
    expect(parseStudioPluginManifest({
      id: 'example.timeline', name: 'Timeline', version: '1.2.3', apiVersion: 1,
      contributes: {
        backend: 'backend.ts', elements: ['example.timeline'], workspaces: ['example.editing'],
      },
    })).toEqual({
      id: 'example.timeline', name: 'Timeline', version: '1.2.3', apiVersion: 1,
      contributes: {
        backend: 'backend.ts', elements: ['example.timeline'], workspaces: ['example.editing'],
      },
    })
  })

  it('rejects path traversal and duplicate contribution IDs', () => {
    expect(() => parseStudioPluginManifest({
      id: 'example.bad', name: 'Bad', version: '1.0.0', apiVersion: 1,
      contributes: { backend: '../outside.ts' },
    })).toThrow('包内相对路径')
    expect(() => parseStudioPluginManifest({
      id: 'example.bad', name: 'Bad', version: '1.0.0', apiVersion: 1,
      contributes: { elements: ['same', 'same'] },
    })).toThrow('重复 ID')
  })
})
