import type { GenerationModelManifest } from '../../../shared/generation-model.mjs'
import type {
  AgentTemplateDto, AgentTerminalLaunchDto, GenerationDagItem, GenerationModelReference,
  GenerationModelResolveInput, PromptLibraryEntryDto, RecentProjectDto,
  ResolvedGenerationPrompt, LocalPathRef,
  ProjectSnapshotGraphDto,
} from './domain'
import type { ProjectTreeEditOperation } from '../../core/project/treeEditor'
import type { NodeVersion, ProjectNode } from '../../core/project/types'
import type { ApplicationState } from '../../core/state/types'

export interface ApplicationSnapshot {
  revision: number
  state: ApplicationState
  history: {
    canUndo: boolean
    canRedo: boolean
    undoLabel: string | null
    redoLabel: string | null
    revision: number
  }
}

export interface ApplicationRequestMap {
  'snapshot.read': { input: undefined; output: ApplicationSnapshot }
  'project.open': { input: { path?: string }; output: { opened: boolean } }
  'project.list-recent': { input: undefined; output: RecentProjectDto[] }
  'project.snapshot.list': { input: undefined; output: ProjectSnapshotGraphDto }
  'project.snapshot.create': { input: { label?: string }; output: ProjectSnapshotGraphDto }
  'project.snapshot.branch': {
    input: { snapshotId: string; branchName: string }
    output: ProjectSnapshotGraphDto
  }
  'project.run-markdown': { input: { markdown: string }; output: void }
  'project.tree.edit': { input: ProjectTreeEditOperation; output: void }
  'project.node.patch': {
    input: { id: string; patch: Partial<ProjectNode>; historyGroupId?: string }
    output: { revision: number }
  }
  'project.node.import-version': { input: { id: string; source?: LocalPathRef }; output: void }
  'project.node.promote-version': { input: { id: string; versionId: string }; output: void }
  'generation-models.list': {
    input: undefined
    output: { models: GenerationModelManifest[]; issues: string[] }
  }
  'generation-models.evaluate-dag': {
    input: { projectRoot?: string } | undefined
    output: GenerationDagItem[]
  }
  'generation-models.generate': {
    input: { nodeId: string; prompt?: string; audioUrl?: string; maxGenerationWaitMs?: number }
    output: import('./domain').GenerationBatchExecutionResult
  }
  'generation.budget.configure': { input: { maxBudget: number }; output: void }
  'generation.credits.reset': { input: undefined; output: void }
  'generation-models.generate-batch': {
    input: { items: import('./domain').GenerationBatchItemInput[]; audioUrl?: string; maxGenerationWaitMs?: number }
    output: import('./domain').GenerationBatchExecutionResult
  }
  'generation-models.resolve': {
    input: GenerationModelResolveInput
    output: ResolvedGenerationPrompt
  }
  'generation-models.build-request': { input: GenerationModelResolveInput; output: unknown }
  'generation-models.import': {
    input: undefined
    output: { canceled: boolean; model?: GenerationModelManifest }
  }
  'generation-models.delete': { input: { modelId: string }; output: void }
  'prompt-library.list': { input: undefined; output: PromptLibraryEntryDto[] }
  'prompt-library.read': { input: { path: string }; output: string }
  'prompt-library.save': { input: { path: string; content: string }; output: void }
  'prompt-library.create': { input: { path: string; content: string }; output: void }
  'prompt-library.create-directory': { input: { path: string }; output: void }
  'prompt-library.rename': { input: { sourcePath: string; targetPath: string }; output: void }
  'prompt-library.delete': { input: { path: string }; output: void }
  'assets.url': { input: { nodeId: string; versionId: string }; output: string }
  'assets.copy-versions': {
    input: { items: Array<{ nodeId: string; versionId: string }> }
    output: { count: number; mode: 'files' | 'paths' }
  }
  'assets.export-videos': {
    input: { nodeIds: string[] }
    output: {
      canceled: boolean
      directory?: string
      exported: Array<{ nodeId: string; fileName: string; destinationPath: string }>
      skipped: Array<{ nodeId: string; title: string; reason: string }>
    }
  }
  'agent.discover': { input: undefined; output: AgentTemplateDto[] }
  'agent.launch-terminal': {
    input: { templateId: string; agentId: string }
    output: AgentTerminalLaunchDto
  }
  'agent.open-directory': { input: { templateId: string; agentId: string }; output: void }
  'history.undo': { input: undefined; output: void }
  'history.redo': { input: undefined; output: void }
  'history.clear-redo': { input: undefined; output: void }
  'graph.inject-root-info': {
    input: { targetNodeId: string; info: any }
    output: void
  }
}

export interface ApplicationEventMap {
  'snapshot.changed': ApplicationSnapshot
  'generation-models.catalog-changed': { reason: 'import' | 'delete'; modelId?: string }
  'history.recorded': { historyId: string; label: string }
  'history.cleared': Record<string, never>
}

export type ApplicationMethod = keyof ApplicationRequestMap
export type ApplicationEvent = keyof ApplicationEventMap
export type GenerationReferenceDto = GenerationModelReference
export type ProjectVersionDto = NodeVersion
