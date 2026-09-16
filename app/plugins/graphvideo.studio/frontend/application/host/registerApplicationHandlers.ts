import type { ProjectPersistenceAdapter } from '../../core/system/desktopAdapter'
import type { ProjectNode } from '../../core/project/types'
import type { ApplicationSnapshot } from '../contract/application'
import type { GraphHost } from '../graph/graphHost'
import { graphVideoRuntimeNodeIds } from '../../graph/node-ids'
import { completedGenerationBatchFromState } from './generationBatchCompletion'
import type { ApplicationHost } from './applicationHost'
import type { ApplicationServices } from '../services/applicationServices'

interface ApplicationHandlerDependencies {
  host: ApplicationHost
  graph: GraphHost
  projectPersistence: Pick<
    ProjectPersistenceAdapter,
    'importNodeVersion' | 'promoteNodeVersion'
  >
  services: ApplicationServices
}

export function registerApplicationHandlers({
  host, graph, projectPersistence, services,
}: ApplicationHandlerDependencies) {
  const {
    agentHost, generationModels, localProjects, projectAssets, projectSnapshots, promptLibrary,
  } = services
  const disposers: Array<() => void> = []
  let snapshotRevision = 0
  let lastHistoryId = graph.history.read().currentEntry?.id ?? null
  let snapshot: ApplicationSnapshot

  const captureSnapshot = () => {
    snapshotRevision += 1
    snapshot = {
      revision: snapshotRevision,
      state: graph.projection.read(),
      history: graph.history.read().snapshot,
    }
    return snapshot
  }
  captureSnapshot()

  const publishProjection = () => {
    const history = graph.history.read()
    host.emit('snapshot.changed', captureSnapshot())
    if (history.currentEntry && history.currentEntry.id !== lastHistoryId) {
      host.emit('history.recorded', {
        historyId: history.currentEntry.id,
        label: history.currentEntry.label ?? '应用状态变更',
      })
    }
    lastHistoryId = history.currentEntry?.id ?? null
  }
  disposers.push(graph.projection.subscribe(publishProjection))

  const injectProject = (project: {
    name: string
    path: string
    markdown: string
    nodes: ProjectNode[]
    retainedNodes: ProjectNode[]
  }, signal?: AbortSignal) => graph.injectRootInfo(graphVideoRuntimeNodeIds.projectSession, {
    type: 'ProjectOpenedInfo',
    project,
  }, { signal })

  const patchNode = (node: ProjectNode, signal?: AbortSignal) => graph.injectRootInfo(
    graphVideoRuntimeNodeIds.registry,
    {
      type: 'UserMetadataPatchInfo',
      patch: node,
    }, { signal },
  )

  const register = host.register.bind(host)
  const executeGenerationBatch = async (
    items: Parameters<typeof generationModels.prepareBatch>[0],
    options: Parameters<typeof generationModels.prepareBatch>[1],
    signal: AbortSignal,
  ) => {
    const prepared = await generationModels.prepareBatch(items, options)
    signal.throwIfAborted()
    try {
      await graph.injectRootInfo(
        graphVideoRuntimeNodeIds.generationModelResolver,
        prepared.info,
        { signal },
      )
      signal.throwIfAborted()
      return completedGenerationBatchFromState({
        batchId: prepared.batchId,
        requests: items,
        state: graph.projection.read(),
      })
    } catch (error) {
      if (signal.aborted) {
        await graph.injectRootInfo(graphVideoRuntimeNodeIds.generationTask, {
          type: 'GenerationBatchCancelRequestedInfo',
          batchId: prepared.batchId,
          reason: '用户已取消生成',
        })
      }
      throw error
    }
  }
  disposers.push(
    register('snapshot.read', () => snapshot),
    register('project.open', async ({ path }, { signal }) => {
      const project = await localProjects.open(path)
      if (!project) return { opened: false }
      signal.throwIfAborted()
      await injectProject(project, signal)
      return { opened: true }
    }),
    register('project.list-recent', () => localProjects.listRecent()),
    register('project.remove-recent', ({ path }) => localProjects.removeRecent(path)),
    register('project.snapshot.list', () => projectSnapshots.list()),
    register('project.snapshot.create', ({ label }) => projectSnapshots.create(label)),
    register('project.snapshot.branch', async ({ snapshotId, branchName }, { signal }) => {
      const result = await projectSnapshots.branch(snapshotId, branchName)
      signal.throwIfAborted()
      await injectProject(result.project, signal)
      return result.graph
    }),
    register('project.run-markdown', ({ markdown }, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.document,
      { type: 'UserMarkdownEditedInfo', markdown }, { signal },
    )),
    register('project.tree.edit', (operation, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.document,
      { type: 'ProjectTreeEditRequestedInfo', operation }, { signal },
    )),
    register('project.node.patch', async ({ id, patch }, { signal }) => {
      await graph.injectRootInfo(
        graphVideoRuntimeNodeIds.registry,
        {
          type: 'UserMetadataPatchInfo',
          patch: { ...patch, id },
        }, { signal },
      )
      // The settled projection is accepted before injectRootInfo resolves.
      return { revision: snapshot.revision }
    }),
    register('project.node.import-version', async ({ id, source }, { signal }) => {
      const node = await projectPersistence.importNodeVersion(id, source)
      signal.throwIfAborted()
      if (node) await patchNode(node, signal)
    }),
    register('project.node.promote-version', async ({ id, versionId }, { signal }) => {
      const node = await projectPersistence.promoteNodeVersion(id, versionId)
      signal.throwIfAborted()
      await patchNode(node, signal)
    }),
    register('generation.budget.configure', ({ maxBudget }, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.securityGate,
      { type: 'GenerationBudgetConfiguredInfo', maxBudget },
      { signal },
    )),
    register('generation.credits.reset', (_input, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.securityGate,
      { type: 'GenerationCreditsResetInfo' },
      { signal },
    )),
    register('generation-models.list', () => generationModels.list()),
    register('generation-models.evaluate-dag', (input) => generationModels.evaluateDag(input?.projectRoot)),
    register('generation-models.generate', (input, { signal }) => executeGenerationBatch(
      [{ nodeId: input.nodeId, ...(input.prompt ? { prompt: input.prompt } : {}) }],
      { audioUrl: input.audioUrl, maxGenerationWaitMs: input.maxGenerationWaitMs },
      signal,
    )),
    register('generation-models.generate-batch', (input, { signal }) => executeGenerationBatch(
      input.items,
      { audioUrl: input.audioUrl, maxGenerationWaitMs: input.maxGenerationWaitMs },
      signal,
    )),
    register('generation-models.resolve', (input) => generationModels.resolve(input)),
    register('generation-models.build-request', (input) => (
      generationModels.buildRequest(input)
    )),
    register('generation-models.import', () => generationModels.import()),
    register('generation-models.delete', ({ modelId }) => generationModels.delete(modelId)),
    register('prompt-library.list', () => promptLibrary.list()),
    register('prompt-library.read', ({ path }) => promptLibrary.read(path)),
    register('prompt-library.save', ({ path, content }) => promptLibrary.save(path, content)),
    register('prompt-library.create', ({ path, content }) => promptLibrary.create(path, content)),
    register('prompt-library.create-directory', ({ path }) => promptLibrary.createDirectory(path)),
    register('prompt-library.rename', ({ sourcePath, targetPath }) => (
      promptLibrary.rename(sourcePath, targetPath)
    )),
    register('prompt-library.delete', ({ path }) => promptLibrary.delete(path)),
    register('assets.url', ({ nodeId, versionId }) => projectAssets.url(nodeId, versionId)),
    register('assets.copy-versions', ({ items }) => projectAssets.copyVersionFiles(items)),
    register('assets.export-videos', ({ nodeIds }) => projectAssets.exportCurrentVideos(nodeIds)),
    register('agent.discover', () => agentHost.discover()),
    register('agent.launch-terminal', ({ templateId, agentId }) => (
      agentHost.launchTerminal(templateId, agentId)
    )),
    register('agent.open-directory', ({ templateId, agentId }) => (
      agentHost.openDirectory(templateId, agentId)
    )),
    register('history.undo', (_input, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.history,
      { type: 'UserSnapshotActionInfo', action: { type: 'UNDO' } }, { signal },
    )),
    register('history.redo', (_input, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.history,
      { type: 'UserSnapshotActionInfo', action: { type: 'REDO' } }, { signal },
    )),
    register('history.clear-redo', (_input, { signal }) => graph.injectRootInfo(
      graphVideoRuntimeNodeIds.history,
      { type: 'UserSnapshotActionInfo', action: { type: 'CLEAR_REDO' } }, { signal },
    )),
    register('graph.inject-root-info', ({ targetNodeId, info }, { signal }) => (
      graph.injectRootInfo(targetNodeId, info, { signal })
    )),
  )

  return () => {
    for (const dispose of [...disposers].reverse()) dispose()
  }
}
