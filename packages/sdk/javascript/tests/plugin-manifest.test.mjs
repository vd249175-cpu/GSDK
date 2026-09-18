import { describe, expect, it } from 'vitest'
import { parseStudioPluginManifest } from '../src/plugin/plugin-manifest.mjs'

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

  it('parses backend/frontend kinds for apiVersion 2 and refuses mixed contributes', () => {
    expect(parseStudioPluginManifest({
      id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2, kind: 'backend',
      contributes: { backend: 'index.ts', graphFactories: ['createAgentGraph'] },
    })).toMatchObject({
      id: 'example.agent', apiVersion: 2, kind: 'backend',
    })
    expect(parseStudioPluginManifest({
      id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2, kind: 'frontend',
      contributes: { frontend: 'index.ts', elements: ['example.agent'] },
    })).toMatchObject({
      id: 'example.agent', apiVersion: 2, kind: 'frontend',
    })
    expect(() => parseStudioPluginManifest({
      id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2, kind: 'backend',
      contributes: { backend: 'index.ts', elements: ['example.agent'] },
    })).toThrow('kind 与 contributes 不一致')
    expect(() => parseStudioPluginManifest({
      id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2, kind: 'frontend',
      contributes: { backend: 'index.ts' },
    })).toThrow('kind 与 contributes 不一致')
    expect(() => parseStudioPluginManifest({
      id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2,
      contributes: { backend: 'index.ts' },
    })).toThrow('kind 必须是 backend 或 frontend')
    expect(() => parseStudioPluginManifest({
      id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2, kind: 'backend',
      contributes: { backend: 'index.ts', graphFactories: ['dup', 'dup'] },
    })).toThrow('重复 ID')
  })
})
