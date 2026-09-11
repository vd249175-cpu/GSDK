export type ComfyUiMediaType = 'image' | 'video' | 'audio'

export type ComfyUiScalar = string | number | boolean

export type ComfyUiBindingValue = ComfyUiScalar | string[]

export interface ComfyUiGraphNode {
  class_type: string
  inputs: Record<string, unknown>
}

export type ComfyUiGraph = Record<string, ComfyUiGraphNode>

export interface ComfyUiScalarBinding {
  node: string
  input: string
  kind?: 'scalar'
}

export interface ComfyUiMediaListBinding {
  node: string
  input: string
  kind: 'media-list'
  media: ComfyUiMediaType
  /** list：写入链接列表（空数组删除输入键）；slots：写入编号槽位键 `<input><slotPrefix>_N`。 */
  shape: 'list' | 'slots'
  /** slots 形状的槽位键段名（如 image → image_1、image_2…），可选。 */
  slotPrefix?: string
  /** 文件数量上限，可选。 */
  maxCount?: number
}

export type ComfyUiBindingTarget = ComfyUiScalarBinding | ComfyUiMediaListBinding

export interface ComfyUiWorkflow {
  schemaVersion: 1
  id: string
  name: string
  description: string
  mediaType: ComfyUiMediaType
  provider: string
  baseUrl?: string
  graph: ComfyUiGraph
  bindings: Record<string, ComfyUiBindingTarget>
  defaults: Record<string, ComfyUiBindingValue>
}

export type ComfyUiOutputKind = 'image' | 'gif' | 'video' | 'audio'

export interface ComfyUiOutputEntry {
  kind: ComfyUiOutputKind
  filename: string
  subfolder: string
  type: string
  url: string
}

export interface ComfyUiFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type ComfyUiFetch = (
  input: string,
  init?: Record<string, unknown>,
) => Promise<ComfyUiFetchResponse>

export interface ComfyUiRunOptions {
  values?: Record<string, ComfyUiBindingValue>
  baseUrl?: string
  clientId?: string
  fetch?: ComfyUiFetch
  timeoutMs?: number
  pollIntervalMs?: number
}

export interface ComfyUiRunResult {
  promptId: string
  outputs: ComfyUiOutputEntry[]
}

export declare function validateComfyUiWorkflow(input: unknown): ComfyUiWorkflow

export declare function applyComfyUiBindings(
  config: ComfyUiWorkflow,
  values?: Record<string, ComfyUiBindingValue>,
): ComfyUiGraph

export declare function buildComfyUiPrompt(
  config: ComfyUiWorkflow,
  values?: Record<string, ComfyUiBindingValue>,
  clientId?: string,
): { prompt: ComfyUiGraph; client_id?: string }

export declare function comfyUiViewUrl(
  baseUrl: string,
  output: { filename?: string; subfolder?: string; type?: string },
): string

export declare function runComfyUiWorkflow(
  config: ComfyUiWorkflow,
  options?: ComfyUiRunOptions,
): Promise<ComfyUiRunResult>
