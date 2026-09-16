import { describe, expect, it } from 'vitest';
import type { ProjectNode } from '../../core/project/types';
import { SqliteRegistryNode } from '../sqlite-registry';
import { SqliteObserverSourceNode } from '../sqlite-observer';
import { SqliteWriterSinkNode } from '../sqlite-writer';
import { createCausalRegionHarness, InfoCollectorNode } from '../../testing/graph';

function textNode(id: string, title: string, content = ''): ProjectNode {
  return {
    id,
    type: 'text',
    title,
    description: '',
    content,
    history: [],
  }
}

describe('SqliteRegistryNode canonical project ownership', () => {
  it('allocates a stable storage-safe identity for a new unmapped Markdown node', async () => {
    const registry = new SqliteRegistryNode()
    let persistedIds: string[] = []
    const writer = new SqliteWriterSinkNode(
      'sink-sqlite-writer',
      'SQLite writer',
      {
        id: 'test/sqlite',
        execute: async () => ({
          dbFilePath: '.graphvideo/nodes.sqlite',
          persistedRecordCount: 0,
          byteLength: 0,
          contentRef: 'test:sqlite',
        }),
      },
      {
        id: 'test/project-structure',
        execute: async (request) => {
          persistedIds = request.nodes.map((node) => node.id)
          return {
            nodes: request.nodes,
            retainedNodes: request.retainedNodes,
            savedAt: 1,
            contentRef: 'test:project-structure',
          }
        },
      },
    )
    const region = createCausalRegionHarness([registry, writer, new SqliteObserverSourceNode()])

    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [{
        id: 'auto:~:随便什么声音',
        type: 'audio',
        title: '随便什么声音',
        description: '',
        prompt: '',
        history: [],
      }],
      markdown: '<project-structure>\n~随便什么声音\n</project-structure>',
      persistenceMode: 'full',
    })

    const [allocatedId] = registry.getState().table.keys()
    expect(allocatedId).toMatch(/^node_[A-Za-z0-9_-]+$/)
    expect(allocatedId).not.toContain(':')
    expect(persistedIds).toEqual([allocatedId])
    expect(registry.getState().inSync).toBe(true)
    await region.dispose()
  })

  it('reconciles a project structure write failure without escaping the writer Node', async () => {
    const registry = new SqliteRegistryNode()
    const writer = new SqliteWriterSinkNode(
      'sink-sqlite-writer',
      'SQLite writer',
      {
        id: 'test/sqlite',
        execute: async () => ({
          dbFilePath: '.graphvideo/nodes.sqlite',
          persistedRecordCount: 0,
          byteLength: 0,
          contentRef: 'test:sqlite',
        }),
      },
      {
        id: 'test/project-structure',
        execute: async () => { throw new Error('测试磁盘拒绝写入') },
      },
    )
    const observer = new SqliteObserverSourceNode()
    const region = createCausalRegionHarness([registry, writer, observer])

    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [textNode('node_scene', '场景')],
      markdown: '<project-structure>\n$场景\n</project-structure>',
      persistenceMode: 'full',
    })

    expect(writer.status).toBe('IDLE')
    expect(registry.getState()).toMatchObject({
      inSync: false,
      lastError: '测试磁盘拒绝写入',
    })
    await region.dispose()
  })

  it('keeps payload-bearing removed nodes retained and restores stable identity by type/title', async () => {
    const registry = new SqliteRegistryNode()
    const region = createCausalRegionHarness([
      registry,
      new InfoCollectorNode('sink-sqlite-writer'),
    ])

    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [textNode('original-id', '第一场', '正文')],
    })
    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [],
    })

    expect(registry.getState().table.size).toBe(0)
    expect(registry.getState().retainedTable.get('original-id')?.content).toBe('正文')

    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [textNode('auto:$:第一场', '第一场')],
    })

    expect([...registry.getState().table.keys()]).toEqual(['original-id'])
    expect(registry.getState().table.get('original-id')?.content).toBe('正文')
    expect(registry.getState().retainedTable.size).toBe(0)
    await region.dispose()
  })

  it('rejects reuse of a retained id for a different business node', async () => {
    const registry = new SqliteRegistryNode()
    const region = createCausalRegionHarness([
      registry,
      new InfoCollectorNode('sink-sqlite-writer'),
    ])
    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [textNode('reserved-id', '旧节点', '需要保留')],
    })
    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [],
    })

    await region.inject(registry.id, {
      type: 'SyncTreeInfo',
      tree: [],
      nodes: [textNode('reserved-id', '新节点')],
    })

    expect(registry.getState()).toMatchObject({
      inSync: false,
      lastError: 'ID “reserved-id” 已由保留节点 “旧节点” 占用',
    })
    const lastChange = region.events('ChangeCompleted').at(-1)
    expect(lastChange?.type === 'ChangeCompleted' ? lastChange.record.error : 'missing').toBeUndefined()
    await region.dispose()
  })

  it('makes a newly generated artifact the only current media version', async () => {
    const registry = new SqliteRegistryNode()
    const writer = new InfoCollectorNode('sink-sqlite-writer', ['PersistMetadataTaskInfo'])
    const region = createCausalRegionHarness([registry, writer])

    await region.inject(registry.id, {
      type: 'ProjectMetadataHydratedInfo',
      observedAt: 1,
      nodes: [{
        id: 'video-1',
        type: 'video',
        title: '镜头',
        description: '',
        prompt: '镜头推进',
        history: [{
          id: 'old-version',
          label: 'old.mp4',
          relativePath: 'nodes/video-1/media/old-version.mp4',
          mimeType: 'video/mp4',
          createdAt: '2026-01-01T00:00:00.000Z',
          source: 'generated',
          current: true,
        }],
      }],
    })
    await region.inject(registry.id, {
      type: 'ArtifactSavedObservedInfo',
      taskId: 'task-1',
      targetNodeId: 'video-1',
      versionId: 'new-version',
      relativePath: 'nodes/video-1/media/new-version.mp4',
      filename: 'new.mp4',
      mediaType: 'video',
    })

    const history = registry.getState().table.get('video-1')?.history ?? []
    expect(history.map((version) => ({ id: version.id, current: version.current }))).toEqual([
      { id: 'old-version', current: false },
      { id: 'new-version', current: true },
    ])
    const persisted = writer.received('PersistMetadataTaskInfo')[0]
    const persistedVideo = Array.isArray(persisted?.records)
      ? persisted.records.find((record: ProjectNode) => record.id === 'video-1')
      : undefined
    expect(persistedVideo?.history).toEqual(history)
    await region.dispose()
  })
})
