import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../../core/state/initialState'
import { graphVideoRuntimeNodeIds } from '../../graph/node-ids'
import { ApplicationHost } from './applicationHost'
import { registerApplicationHandlers } from './registerApplicationHandlers'
import type { GraphHost } from '../graph/graphHost'

describe('registerApplicationHandlers execution authority', () => {
  it('maps Studio commands to one Kernel root Info without a local executor', async () => {
    const injectRootInfo = vi.fn(async () => undefined)
    const graph: GraphHost = {
      executionAuthority: {
        kind: 'causal-graph-runtime',
        owner: 'kernel',
        graphId: 'graphvideo/studio',
        replaceable: false,
      },
      projection: {
        read: () => createInitialState(),
        readGraph: () => null,
        subscribe: () => () => undefined,
      },
      history: {
        read: () => ({
          snapshot: {
            canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, revision: 0,
          },
          currentEntry: null,
        }),
      },
      connect: vi.fn(async () => undefined),
      injectRootInfo,
      cancel: vi.fn(async () => true),
      dispose: vi.fn(),
    }
    const host = new ApplicationHost()
    const dispose = registerApplicationHandlers({
      host,
      graph,
      projectPersistence: {
        importNodeVersion: vi.fn(async () => null),
        promoteNodeVersion: vi.fn(async () => ({
          id: 'node-a', type: 'image', title: 'A', description: '',
        })),
      },
      services: {
        localProjects: {
          open: vi.fn(async () => null),
          listRecent: vi.fn(async () => []),
        },
        projectSnapshots: {
          list: vi.fn(async () => ({ activeBranchId: 'main', branches: [], snapshots: [] })),
          create: vi.fn(async () => ({ activeBranchId: 'main', branches: [], snapshots: [] })),
          branch: vi.fn(async () => ({
            graph: { activeBranchId: 'branch-a', branches: [], snapshots: [] },
            project: {
              name: 'Branched', path: 'C:/Project', markdown: '# branch', nodes: [], retainedNodes: [],
            },
          })),
        },
        projectAssets: {
          url: vi.fn(() => 'graphvideo-asset://node/version'),
          copyVersionFiles: vi.fn(async () => ({ count: 0, mode: 'files' })),
          exportCurrentVideos: vi.fn(async () => ({
            canceled: true, exported: [], skipped: [],
          })),
        },
        generationModels: {
          list: vi.fn(async () => ({ models: [], issues: [] })),
          evaluateDag: vi.fn(async () => []),
          prepareBatch: vi.fn(async () => ({ batchId: 'batch-unused', info: {} as any })),
          resolve: vi.fn(async () => { throw new Error('not used') }),
          buildRequest: vi.fn(async () => undefined),
          import: vi.fn(async () => ({ canceled: true })),
          delete: vi.fn(async () => undefined),
        },
        promptLibrary: {
          list: vi.fn(async () => []),
          read: vi.fn(async () => ''),
          save: vi.fn(async () => undefined),
          create: vi.fn(async () => undefined),
          createDirectory: vi.fn(async () => undefined),
          rename: vi.fn(async () => undefined),
          delete: vi.fn(async () => undefined),
        },
        agentHost: {
          discover: vi.fn(async () => []),
          onTerminalData: vi.fn(() => () => undefined),
          onTerminalExit: vi.fn(() => () => undefined),
        },
      },
    })
    const signal = new AbortController().signal
    const treeOperation = { type: 'rename', key: 'node-a', title: 'A' } as const

    await host.request('project.run-markdown', { markdown: '# project' }, signal)
    await host.request('project.tree.edit', treeOperation, signal)
    const acknowledgement = await host.request('project.node.patch', {
      id: 'node-a', patch: { title: 'Changed' },
    }, signal)
    expect(acknowledgement).toEqual({ revision: (await host.request('snapshot.read', undefined, signal)).revision })
    await host.request('history.undo', undefined, signal)
    await host.request('history.redo', undefined, signal)
    await host.request('project.snapshot.branch', {
      snapshotId: 'snapshot-a', branchName: '方案 A',
    }, signal)

    expect(injectRootInfo).toHaveBeenNthCalledWith(
      1,
      graphVideoRuntimeNodeIds.document,
      { type: 'UserMarkdownEditedInfo', markdown: '# project' },
      { signal },
    )
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      2,
      graphVideoRuntimeNodeIds.document,
      { type: 'ProjectTreeEditRequestedInfo', operation: treeOperation },
      { signal },
    )
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      3,
      graphVideoRuntimeNodeIds.registry,
      {
        type: 'UserMetadataPatchInfo',
        patch: { id: 'node-a', title: 'Changed' },
      },
      { signal },
    )
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      4,
      graphVideoRuntimeNodeIds.history,
      { type: 'UserSnapshotActionInfo', action: { type: 'UNDO' } },
      { signal },
    )
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      5,
      graphVideoRuntimeNodeIds.history,
      { type: 'UserSnapshotActionInfo', action: { type: 'REDO' } },
      { signal },
    )
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      6,
      graphVideoRuntimeNodeIds.projectSession,
      {
        type: 'ProjectOpenedInfo',
        project: {
          name: 'Branched', path: 'C:/Project', markdown: '# branch', nodes: [], retainedNodes: [],
        },
      },
      { signal },
    )

    const cancelController = new AbortController()
    injectRootInfo.mockImplementationOnce(async () => {
      cancelController.abort(new Error('cancel fixture'))
      throw new Error('cancel fixture')
    })
    await expect(host.request(
      'generation-models.generate',
      { nodeId: 'video-a' },
      cancelController.signal,
    )).rejects.toThrow('cancel fixture')
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      7,
      graphVideoRuntimeNodeIds.generationModelResolver,
      {},
      { signal: cancelController.signal },
    )
    expect(injectRootInfo).toHaveBeenNthCalledWith(
      8,
      graphVideoRuntimeNodeIds.generationTask,
      {
        type: 'GenerationBatchCancelRequestedInfo',
        batchId: 'batch-unused',
        reason: '用户已取消生成',
      },
    )

    dispose()
    host.dispose()
  })
})
