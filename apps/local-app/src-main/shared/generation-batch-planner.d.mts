import type { ProjectNode } from '../src/core/project/types'
import type { GenerationModelInput } from './generation-model-input.mjs'
import type { GenerationModelPackageSnapshot } from './generation-model-package.mjs'

export interface GenerationBatchProject {
  readonly name: string
  readonly path: string
  readonly markdown: string
  readonly nodes: readonly ProjectNode[]
}

export interface GenerationBatchRequestItem {
  readonly nodeId: string
  readonly prompt?: string
}

export interface GenerationBatchPlanOptions {
  readonly batchId: string
  readonly audioUrl?: string
  readonly nextId: () => string
}

export interface GenerationBatchPlanItem {
  readonly taskId: string
  readonly targetNodeId: string
  readonly versionId: string
  readonly destinationRelativePath: string
  readonly mediaType: 'image' | 'video' | 'audio'
  readonly input: GenerationModelInput
}

export interface GenerationBatchPlan {
  readonly batchId: string
  readonly project: { readonly id: string; readonly name?: string; readonly baseUrl?: string }
  readonly tasks: readonly GenerationBatchPlanItem[]
}

export interface GenerationDagItem {
  readonly id: string
  readonly type: 'image' | 'video' | 'audio'
  readonly title: string
  readonly modelId: string | null
  readonly level: number
  readonly dependencies: readonly string[]
  readonly resolvedDependencies: readonly Record<string, unknown>[]
  readonly hasCompletedMedia: boolean
  readonly readiness: {
    readonly status: 'READY' | 'MANUAL' | 'MISSING_DEPENDENCIES' | 'COMPLETED' | 'BLOCKED'
    readonly missingDependencies: readonly string[]
    readonly reason: string
  }
  readonly estimatedCredits: number
}

export function audioProjectIdentity(projectRoot: string): { id: string; name: string }
export function evaluateGenerationProject(
  project: GenerationBatchProject,
  catalog?: { readonly revision: string; readonly models: readonly GenerationModelPackageSnapshot[] },
): GenerationDagItem[]
export function planGenerationBatch(
  project: GenerationBatchProject,
  requests: readonly GenerationBatchRequestItem[],
  options: GenerationBatchPlanOptions,
): GenerationBatchPlan
