export type GenerationMediaType = 'image' | 'video' | 'audio'
export type GenerationParameterType = 'string' | 'number' | 'integer' | 'boolean'

export interface GenerationParameterDefinition {
  type: GenerationParameterType
  description?: string
  enum?: string[]
  minimum?: number
  maximum?: number
}

export interface GenerationModelManifest {
  schemaVersion: 1
  id: string
  name: string
  description: string
  mediaType: GenerationMediaType
  provider: string
  apiModel: string
  entrypoints: { promptParser: string; apiAdapter: string }
  capabilities: { modes: string[]; references: string[]; nativeAudio: boolean }
  parameters: Record<string, GenerationParameterDefinition>
  defaults: Record<string, unknown>
  prompt: Record<string, unknown>
  api: Record<string, unknown>
}

export function validateGenerationModelManifest(input: unknown): GenerationModelManifest
export function validateGenerationParameters(
  definitions: Record<string, GenerationParameterDefinition>, values: unknown,
): Record<string, unknown>
