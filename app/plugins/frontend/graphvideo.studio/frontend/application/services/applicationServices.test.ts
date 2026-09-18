import { describe, expect, it, vi } from 'vitest'
import { createDesktopApplicationServices } from './applicationServices'

const projectAssets = {
  url: vi.fn(() => 'graphvideo-asset://node/a/v1'),
  copyVersionFiles: vi.fn(async () => ({ count: 0, mode: 'files' as const })),
  exportCurrentVideos: vi.fn(async () => ({
    canceled: true,
    exported: [],
    skipped: [],
  })),
}

describe('desktop application services', () => {
  it('exposes stable application capabilities without Element providers', async () => {
    const catalogChanged = vi.fn()
    const desktop = {
      project: {
        listRecent: vi.fn(async () => [{ name: 'Demo', path: 'C:/Demo', openedAt: 1 }]),
        openLocal: vi.fn(async () => ({
          canceled: false,
          project: {
            name: 'Demo', path: 'C:/Demo', markdown: '# Demo', nodes: [], retainedNodes: [],
          },
        })),
        listSnapshots: vi.fn(async () => ({ activeBranchId: 'main', branches: [], snapshots: [] })),
        createSnapshot: vi.fn(async () => ({ activeBranchId: 'main', branches: [], snapshots: [] })),
        branchFromSnapshot: vi.fn(async () => ({
          graph: { activeBranchId: 'branch-a', branches: [], snapshots: [] },
          project: { name: 'Demo', path: 'C:/Demo', markdown: '# Demo', nodes: [], retainedNodes: [] },
        })),
      },
      generationModels: {
        list: vi.fn(async () => ({ models: [], issues: [] })),
        evaluateDag: vi.fn(async () => []),
        prepareBatch: vi.fn(async () => ({ batchId: 'batch-a', info: {} })),
        resolve: vi.fn(async () => ({ model: {}, body: '', prompt: '', aliases: {}, effectiveConfig: {} })),
        buildRequest: vi.fn(async () => ({})),
        import: vi.fn(async () => ({ canceled: false, model: { id: 'model-a' } })),
        delete: vi.fn(async () => undefined),
      },
      promptLibrary: {
        list: vi.fn(async () => []),
        read: vi.fn(async () => '<prompts></prompts>'),
        save: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined),
        createDirectory: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      agent: {
        discover: vi.fn(async () => []),
        launchNativeTerminal: vi.fn(async (templateId: string, agentId: string) => ({
          templateId, agentId, title: agentId, terminal: 'windows-terminal' as const,
        })),
        openDirectory: vi.fn(async () => undefined),
      },
    } as any

    const services = createDesktopApplicationServices(desktop, projectAssets, catalogChanged)

    expect(await services.localProjects.listRecent()).toHaveLength(1)
    expect((await services.localProjects.open())?.name).toBe('Demo')
    expect((await services.projectSnapshots.list()).activeBranchId).toBe('main')
    expect((await services.projectSnapshots.branch('snapshot-a', '方案 A')).graph.activeBranchId).toBe('branch-a')
    expect(await services.promptLibrary.read('prompt.xml')).toBe('<prompts></prompts>')
    expect((await services.generationModels.import()).model?.id).toBe('model-a')
    await services.generationModels.delete('model-a')
    expect(await services.agentHost.launchTerminal('default', 'director')).toEqual({
      templateId: 'default', agentId: 'director', title: 'director', terminal: 'windows-terminal',
    })
    await services.agentHost.openDirectory('default', 'director')
    expect(desktop.agent.openDirectory).toHaveBeenCalledWith('default', 'director')

    expect(catalogChanged).toHaveBeenNthCalledWith(
      1, { reason: 'import', modelId: 'model-a' },
    )
    expect(catalogChanged).toHaveBeenNthCalledWith(
      2, { reason: 'delete', modelId: 'model-a' },
    )
  })

  it('keeps a stable dependency object when the desktop bridge is unavailable', async () => {
    const services = createDesktopApplicationServices(undefined, projectAssets, vi.fn())
    await expect(services.localProjects.listRecent()).rejects.toThrow('Electron 桌面模式')
    await expect(services.agentHost.launchTerminal('default', 'director')).rejects.toThrow('Electron 桌面模式')
    await expect(services.agentHost.openDirectory('default', 'director')).rejects.toThrow('Electron 桌面模式')
  })
})
