import type {
  ApplicationEventMap, ApplicationSnapshot,
} from '../../application/contract/application'
import type { ApplicationTransport } from '../../application/contract/transport'
import type { ApplicationRequestOptions } from '../../application/contract/transport'

export class ApplicationSnapshotStore {
  private snapshot: ApplicationSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void

  constructor(
    private readonly transport: ApplicationTransport,
    initialSnapshot: ApplicationSnapshot,
  ) {
    this.snapshot = initialSnapshot
    this.unsubscribe = transport.subscribe('snapshot.changed', (snapshot) => {
      if (snapshot.revision < this.snapshot.revision) return
      this.snapshot = snapshot
      this.listeners.forEach((listener) => listener())
    })
  }

  read = () => this.snapshot
  readState = () => this.snapshot.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async refresh() {
    const snapshot = await this.transport.request('snapshot.read', undefined)
    if (snapshot.revision >= this.snapshot.revision) {
      this.snapshot = snapshot
      this.listeners.forEach((listener) => listener())
    }
  }

  dispose() {
    this.unsubscribe()
    this.listeners.clear()
  }
}

export function createApplicationClient(transport: ApplicationTransport) {
  return {
    project: {
      open: (path?: string) => transport.request('project.open', { path }),
      listRecent: () => transport.request('project.list-recent', undefined),
      removeRecent: (path: string) => transport.request('project.remove-recent', { path }),
      listSnapshots: () => transport.request('project.snapshot.list', undefined),
      createSnapshot: (label?: string) => transport.request('project.snapshot.create', { label }),
      branchFromSnapshot: (snapshotId: string, branchName: string) => (
        transport.request('project.snapshot.branch', { snapshotId, branchName })
      ),
      runMarkdown: (markdown: string) => transport.request('project.run-markdown', { markdown }),
      editTree: (input: Parameters<typeof transport.request<'project.tree.edit'>>[1]) => (
        transport.request('project.tree.edit', input)
      ),
      patchNode: (input: Parameters<typeof transport.request<'project.node.patch'>>[1]) => (
        transport.request('project.node.patch', input)
      ),
      importVersion: (id: string, source?: import('../../application/contract/domain').LocalPathRef) => (
        transport.request('project.node.import-version', { id, source })
      ),
      promoteVersion: (id: string, versionId: string) => (
        transport.request('project.node.promote-version', { id, versionId })
      ),
    },
    generation: {
      configureBudget: (maxBudget: number) => transport.request(
        'generation.budget.configure', { maxBudget },
      ),
      resetCredits: () => transport.request('generation.credits.reset', undefined),
    },
    generationModels: {
      list: () => transport.request('generation-models.list', undefined),
      evaluateDag: (projectRoot?: string) => transport.request('generation-models.evaluate-dag', { projectRoot }),
      generate: (nodeId: string, options?: { prompt?: string; audioUrl?: string; maxGenerationWaitMs?: number }, requestOptions?: ApplicationRequestOptions) => (
        transport.request('generation-models.generate', { nodeId, ...options }, requestOptions)
      ),
      generateBatch: (items: Parameters<typeof transport.request<'generation-models.generate-batch'>>[1]['items'], options?: { audioUrl?: string; maxGenerationWaitMs?: number }, requestOptions?: ApplicationRequestOptions) => (
        transport.request('generation-models.generate-batch', { items, ...options }, requestOptions)
      ),
      resolve: (input: Parameters<typeof transport.request<'generation-models.resolve'>>[1]) => (
        transport.request('generation-models.resolve', input)
      ),
      buildRequest: (input: Parameters<typeof transport.request<'generation-models.build-request'>>[1]) => (
        transport.request('generation-models.build-request', input)
      ),
      import: () => transport.request('generation-models.import', undefined),
      delete: (modelId: string) => transport.request('generation-models.delete', { modelId }),
      onCatalogChanged: (listener: (payload: ApplicationEventMap['generation-models.catalog-changed']) => void) => (
        transport.subscribe('generation-models.catalog-changed', listener)
      ),
    },
    promptLibrary: {
      list: () => transport.request('prompt-library.list', undefined),
      read: (path: string) => transport.request('prompt-library.read', { path }),
      save: (path: string, content: string) => transport.request('prompt-library.save', { path, content }),
      create: (path: string, content: string) => transport.request('prompt-library.create', { path, content }),
      createDirectory: (path: string) => transport.request('prompt-library.create-directory', { path }),
      rename: (sourcePath: string, targetPath: string) => (
        transport.request('prompt-library.rename', { sourcePath, targetPath })
      ),
      delete: (path: string) => transport.request('prompt-library.delete', { path }),
    },
    assets: {
      url: (nodeId: string, versionId: string) => transport.request('assets.url', { nodeId, versionId }),
      copyVersions: (items: Array<{ nodeId: string; versionId: string }>) => (
        transport.request('assets.copy-versions', { items })
      ),
      exportVideos: (nodeIds: string[]) => transport.request('assets.export-videos', { nodeIds }),
    },
    agent: {
      discover: () => transport.request('agent.discover', undefined),
      launchTerminal: (templateId: string, agentId: string) => (
        transport.request('agent.launch-terminal', { templateId, agentId })
      ),
      openDirectory: (templateId: string, agentId: string) => (
        transport.request('agent.open-directory', { templateId, agentId })
      ),
    },
    history: {
      undo: () => transport.request('history.undo', undefined),
      redo: () => transport.request('history.redo', undefined),
      clearRedo: () => transport.request('history.clear-redo', undefined),
      onRecorded: (listener: (payload: ApplicationEventMap['history.recorded']) => void) => (
        transport.subscribe('history.recorded', listener)
      ),
      onCleared: (listener: () => void) => transport.subscribe('history.cleared', listener),
    },
    injectRootInfo: (
      targetNodeId: string,
      info: any,
      options?: ApplicationRequestOptions,
    ) => transport.request('graph.inject-root-info', {
      targetNodeId,
      info,
    }, options),
    graph: {
      injectRootInfo: (
        targetNodeId: string,
        info: any,
        options?: ApplicationRequestOptions,
      ) => transport.request('graph.inject-root-info', {
        targetNodeId,
        info,
      }, options),
    },
    events: {
      subscribe: <K extends keyof ApplicationEventMap>(
        event: K,
        listener: (payload: ApplicationEventMap[K]) => void,
      ) => transport.subscribe(event, listener),
    },
  }
}

export type GraphVideoApplicationClient = ReturnType<typeof createApplicationClient>
