import { describe, expect, it, vi } from 'vitest'
import { createProjectAssetsService } from './projectAssetsService'

describe('ProjectAssets application service', () => {
  it('resolves local media without an Element service provider', async () => {
    const adapter = {
      assetUrl: vi.fn(() => 'graphvideo-asset://node/image-node/version-1'),
      copyVersionFiles: vi.fn(async () => ({ count: 1, mode: 'files' as const })),
      exportCurrentVideos: vi.fn(async () => ({
        canceled: false,
        exported: [],
        skipped: [],
      })),
    }
    const assets = createProjectAssetsService(adapter)

    expect(assets.url('image-node', 'version-1')).toBe(
      'graphvideo-asset://node/image-node/version-1',
    )
    expect(await assets.copyVersionFiles([{ nodeId: 'image-node', versionId: 'version-1' }]))
      .toEqual({ count: 1, mode: 'files' })
  })

  it('reports desktop capability absence instead of returning an empty URL', () => {
    const assets = createProjectAssetsService(undefined)
    expect(() => assets.url('image-node', 'version-1')).toThrow('Electron 桌面模式')
  })
})
