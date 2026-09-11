import {
  defaultValueCodec,
  type GraphProjection,
  type GraphProjectionNode,
} from '@graphvideo/kernel'
import { createInitialState } from '../../core/state/initialState'
import type { ApplicationState } from '../../core/state/types'
import type { RuntimeTaskGraphState, RuntimeTaskState } from '../../core/state/types'
import type { ProjectNode } from '../../core/project/types'
import type { ApplicationSnapshot } from '../contract/application'
import { graphVideoRuntimeNodeIds } from '../../graph/node-ids'

function decodedState(
  projection: GraphProjection,
  nodeId: string,
): Record<string, unknown> | null {
  const node = projection.nodes.find((candidate) => candidate.nodeId === nodeId)
  if (!node) return null
  const value = defaultValueCodec.decode(node.state)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function projectNode(record: unknown): ProjectNode | null {
  if (!record || typeof record !== 'object') return null
  const value = record as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return null
  const type = typeof value.type === 'string' && value.type ? (value.type as ProjectNode['type']) : 'text'
  const title = typeof value.title === 'string' ? value.title : '未命名'
  return {
    id,
    type,
    title,
    description: typeof value.description === 'string' ? value.description : '',
    ...(typeof value.content === 'string' ? { content: value.content } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(Array.isArray(value.history) ? { history: value.history as ProjectNode['history'] } : {}),
  }
}

function nodeRecord(value: unknown): Record<string, ProjectNode> {
  if (!value) return {}
  const entries: Array<[string, ProjectNode]> = []
  if (value instanceof Map) {
    for (const [key, record] of value) {
      const node = projectNode(record)
      if (typeof key === 'string' && node) entries.push([key, node])
    }
  } else if (typeof value === 'object') {
    for (const [key, record] of Object.entries(value)) {
      const node = projectNode(record)
      if (node) entries.push([key, node])
    }
  }
  return Object.fromEntries(entries)
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function taskEntries(value: unknown): Array<[string, Record<string, unknown>]> {
  if (value instanceof Map) {
    return [...value.entries()].filter((entry): entry is [string, Record<string, unknown>] => (
      typeof entry[0] === 'string' && Boolean(entry[1]) && typeof entry[1] === 'object'
    ))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => (
    Boolean(entry[1]) && typeof entry[1] === 'object'
  ))
}

function generationTaskGraphs(value: unknown): Record<string, RuntimeTaskGraphState> {
  const grouped = new Map<string, RuntimeTaskState[]>()
  for (const [taskKey, raw] of taskEntries(value)) {
    const batchId = typeof raw.batchId === 'string' ? raw.batchId : ''
    const targetNodeId = typeof raw.targetNodeId === 'string' ? raw.targetNodeId : ''
    const versionId = typeof raw.versionId === 'string' ? raw.versionId : ''
    const destinationRelativePath = typeof raw.destinationRelativePath === 'string'
      ? raw.destinationRelativePath
      : ''
    const phase = typeof raw.phase === 'string' ? raw.phase : ''
    if (
      !batchId || !targetNodeId || !versionId || !destinationRelativePath
      || !['submitting', 'polling', 'waiting', 'downloading', 'persisting', 'downloaded', 'failed', 'canceled'].includes(phase)
    ) continue
    const error = typeof raw.error === 'string' ? raw.error : ''
    const status = phase === 'downloaded'
      ? 'succeeded'
      : phase === 'failed'
        ? 'failed'
        : phase === 'canceled'
          ? 'canceled'
          : phase === 'waiting' ? 'retrying' : 'running'
    const task: RuntimeTaskState = {
      id: typeof raw.taskId === 'string' ? raw.taskId : taskKey,
      targetNodeId,
      versionId,
      destinationRelativePath,
      phase: phase as RuntimeTaskState['phase'],
      status,
      attempt: 1,
      maxAttempts: 1,
      progress: finiteNumber(raw.progress),
      message: error || (phase === 'persisting' ? '正在保存生成产物元数据' : phase),
      error: error || null,
      startedAt: finiteNumber(raw.startedAt) || null,
      finishedAt: null,
    }
    grouped.set(batchId, [...(grouped.get(batchId) ?? []), task])
  }
  return Object.fromEntries([...grouped.entries()].map(([batchId, tasks]) => {
    const active = tasks.some((task) => !['succeeded', 'failed', 'canceled'].includes(task.status))
    const failed = tasks.some((task) => task.status === 'failed')
    const canceled = tasks.some((task) => task.status === 'canceled')
    const progress = tasks.reduce((sum, task) => sum + task.progress, 0) / Math.max(1, tasks.length)
    return [batchId, {
      id: batchId,
      intentType: 'generation.batch',
      projectId: null,
      mode: 'foreground',
      status: active ? 'running' : failed ? 'failed' : canceled ? 'canceled' : 'succeeded',
      progress,
      error: tasks.find((task) => task.error)?.error ?? null,
      createdAt: Math.min(...tasks.map((task) => task.startedAt ?? 0)),
      startedAt: Math.min(...tasks.map((task) => task.startedAt ?? 0)) || null,
      finishedAt: null,
      tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    } satisfies RuntimeTaskGraphState]
  }))
}

/** Builds the Studio read model exclusively from the authoritative Kernel Node projection. */
export function applicationStateFromGraphProjection(
  projection: GraphProjection,
): ApplicationState {
  const initial = createInitialState()
  const projectSession = decodedState(projection, graphVideoRuntimeNodeIds.projectSession)
  const document = decodedState(projection, graphVideoRuntimeNodeIds.document)
  const parser = decodedState(projection, graphVideoRuntimeNodeIds.parser)
  const outline = decodedState(projection, graphVideoRuntimeNodeIds.outline)
  const registry = decodedState(projection, graphVideoRuntimeNodeIds.registry)
  const securityGate = decodedState(projection, graphVideoRuntimeNodeIds.securityGate)
  const generationTasks = decodedState(projection, graphVideoRuntimeNodeIds.generationTask)
  const revision = finiteNumber(document?.revision)
  const lastUpdatedAt = finiteNumber(document?.lastUpdatedAt)
  const registryUpdatedAt = finiteNumber(registry?.lastUpdatedAt)
  const escapedNode = projection.nodes.find((node: GraphProjectionNode) => node.status === 'ERROR')

  return {
    project: {
      name: typeof projectSession?.projectName === 'string'
        ? projectSession.projectName
        : initial.project.name,
      localPath: typeof projectSession?.currentPath === 'string'
        && projectSession.currentPath !== '.graphvideo/nodes.sqlite'
        ? projectSession.currentPath
        : null,
      markdown: typeof document?.markdown === 'string' ? document.markdown : '',
      lastRunMarkdown: typeof document?.markdown === 'string' ? document.markdown : '',
      nodes: nodeRecord(registry?.table),
      retainedNodes: nodeRecord(registry?.retainedTable),
      tree: Array.isArray(outline?.tree) ? outline.tree as ApplicationState['project']['tree'] : [],
      issues: Array.isArray(parser?.issues) ? parser.issues as ApplicationState['project']['issues'] : [],
      logicRevision: revision,
      lastLogicRunAt: lastUpdatedAt > 0 ? lastUpdatedAt : null,
    },
    runtime: {
      pendingTasks: (projection.scheduler?.pendingDeliveries ?? 0) + (projection.scheduler?.activeChanges ?? 0),
      activeBackgroundTasks: projection.scheduler?.scheduledGraphMicrotasks ?? 0,
      taskGraphs: generationTaskGraphs(generationTasks?.tasks),
      lastSavedAt: registryUpdatedAt > 0 && registry?.inSync === true ? registryUpdatedAt : null,
      lastError: typeof registry?.lastError === 'string'
        ? registry.lastError
        : escapedNode ? `Node 实现异常: ${escapedNode.nodeId}` : null,
      generation: {
        spentCredits: finiteNumber(securityGate?.spentCredits),
        maxBudget: finiteNumber(securityGate?.maxCreditBudget, 10000),
        lastBlockReason: typeof securityGate?.lastBlockReason === 'string'
          ? securityGate.lastBlockReason
          : null,
      },
    },
    plugins: Object.fromEntries(
      (projection.nodes ?? []).map((node) => [
        node.nodeId,
        {
          state: defaultValueCodec.decode(node.state),
          version: node.version,
          status: node.status,
        },
      ]),
    ),
  }
}

export function initialKernelApplicationState() {
  return createInitialState()
}

export interface KernelHistoryReadModel {
  readonly snapshot: ApplicationSnapshot['history']
  readonly currentEntry: { id: string; label: string | null } | null
}

export function historyFromGraphProjection(
  projection: GraphProjection | null,
): KernelHistoryReadModel {
  if (!projection) {
    return {
      snapshot: {
        canUndo: false,
        canRedo: false,
        undoLabel: null,
        redoLabel: null,
        revision: 0,
      },
      currentEntry: null,
    }
  }
  const history = decodedState(projection, graphVideoRuntimeNodeIds.history)
  const past = Array.isArray(history?.past) ? history.past as Array<Record<string, unknown>> : []
  const future = Array.isArray(history?.future) ? history.future as Array<Record<string, unknown>> : []
  const current = history?.currentEntry && typeof history.currentEntry === 'object'
    ? history.currentEntry as Record<string, unknown>
    : null
  const label = (entry: Record<string, unknown> | null | undefined) => (
    typeof entry?.label === 'string' ? entry.label : null
  )
  return {
    snapshot: {
      canUndo: current !== null,
      canRedo: future.length > 0,
      undoLabel: label(current),
      redoLabel: label(future.at(-1)),
      revision: (() => {
        const hNode = projection.nodes.find((node) => node.nodeId === graphVideoRuntimeNodeIds.history);
        return hNode?.version ?? 0;
      })(),
    },
    currentEntry: current && typeof current.id === 'string'
      ? { id: current.id, label: label(current) }
      : null,
  }
}
