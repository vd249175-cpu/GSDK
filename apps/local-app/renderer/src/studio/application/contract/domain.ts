import type { GenerationModelManifest } from '../../../shared/generation-model.mjs'
import type { ProjectNode } from '../../core/project/types'

export interface LocalPathRef {
  kind: 'local-path'
  path: string
}

export interface GenerationModelReference {
  id: string
  type: string
  title: string
  ordinal: number
  content?: string
}

export interface GenerationModelResolveInput {
  nodeType: string
  prompt: string
  references: GenerationModelReference[]
}

export interface GenerationBatchItemInput {
  nodeId: string
  prompt?: string
}

export interface GenerationBatchExecutionItem {
  nodeId: string
  taskId: string
  versionId: string
  status: 'downloaded'
}

export interface GenerationBatchExecutionResult {
  status: 'completed'
  batchId: string
  items: GenerationBatchExecutionItem[]
}

export interface ResolvedGenerationPrompt {
  model: GenerationModelManifest
  body: string
  prompt: string
  aliases: Record<string, string>
  effectiveConfig: Record<string, unknown>
}

export interface GenerationDagDependency {
  id: string
  type: string
  title: string
  ordinal: number
  hasMedia: boolean
  filePath?: string
  content?: string
}

export interface GenerationDagReadiness {
  status: 'READY' | 'COMPLETED' | 'MANUAL' | 'BLOCKED' | 'MISSING_DEPENDENCIES' | 'ERROR'
  missingDependencies: string[]
  reason?: string
}

export interface GenerationDagItem {
  id: string
  type: string
  title: string
  modelId?: string | null
  level: number
  dependencies: string[]
  resolvedDependencies: GenerationDagDependency[]
  hasCompletedMedia: boolean
  currentMediaPath?: string
  readiness?: GenerationDagReadiness
  estimatedCredits?: number
}

export interface AgentDefinitionDto {
  id: string
  name: string
}

export interface AgentTemplateDto {
  id: string
  name: string
  agents: AgentDefinitionDto[]
}

export interface AgentTerminalLaunchDto {
  templateId: string
  agentId: string
  title: string
  terminal: 'windows-terminal' | 'windows-console' | 'macos-terminal' | 'linux-terminal'
}

export interface PromptLibraryEntryDto {
  kind: 'directory' | 'file'
  path: string
}

export interface RecentProjectDto {
  name: string
  path: string
  openedAt: number
}

export interface LocalProjectSourceDto {
  name: string
  path: string
  markdown: string
  nodes: ProjectNode[]
  retainedNodes: ProjectNode[]
}

export interface ProjectSnapshotDto {
  id: string
  branchId: string
  parentId: string | null
  label: string
  createdAt: string
  sizeBytes: number
  kind: 'manual' | 'recovery'
}

export interface ProjectSnapshotBranchDto {
  id: string
  name: string
  createdAt: string
  sourceSnapshotId: string | null
  headSnapshotId: string | null
}

export interface ProjectSnapshotGraphDto {
  activeBranchId: string
  branches: ProjectSnapshotBranchDto[]
  snapshots: ProjectSnapshotDto[]
}

export interface ProjectVideoExportResultDto {
  canceled: boolean
  directory?: string
  exported: Array<{ nodeId: string; fileName: string; destinationPath: string }>
  skipped: Array<{ nodeId: string; title: string; reason: string }>
}
