import type { ProjectIssue, ProjectNode, ProjectTreeItem } from '../project/types'

export type RuntimeTaskMode = 'foreground' | 'background'
export type RuntimeTaskStatus = 'queued' | 'running' | 'retrying'
  | 'succeeded' | 'failed' | 'canceled' | 'blocked'
export type RuntimeTaskGraphStatus = 'queued' | 'running' | 'completing'
  | 'succeeded' | 'failed' | 'canceled'

export interface RuntimeTaskState {
  id: string
  targetNodeId: string
  versionId: string
  destinationRelativePath: string
  phase: 'submitting' | 'polling' | 'waiting' | 'downloading' | 'persisting' | 'downloaded' | 'failed' | 'canceled'
  status: RuntimeTaskStatus
  attempt: number
  maxAttempts: number
  progress: number
  message: string
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface RuntimeTaskGraphState {
  id: string
  intentType: string
  projectId: string | null
  mode: RuntimeTaskMode
  status: RuntimeTaskGraphStatus
  progress: number
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  tasks: Record<string, RuntimeTaskState>
}

export interface ApplicationState {
  project: {
    name: string
    localPath: string | null
    markdown: string
    lastRunMarkdown: string
    nodes: Record<string, ProjectNode>
    retainedNodes: Record<string, ProjectNode>
    tree: ProjectTreeItem[]
    issues: ProjectIssue[]
    logicRevision: number
    lastLogicRunAt: number | null
  }

  runtime: {
    pendingTasks: number
    activeBackgroundTasks: number
    taskGraphs: Record<string, RuntimeTaskGraphState>
    lastSavedAt: number | null
    lastError: string | null
    generation: {
      spentCredits: number
      maxBudget: number
      lastBlockReason: string | null
    }
  }
  plugins: Record<string, {
    state: any
    version: number
    status?: string
  }>
}

export type StateMutation = (state: ApplicationState) => ApplicationState
