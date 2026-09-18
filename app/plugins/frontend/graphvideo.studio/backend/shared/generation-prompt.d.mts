export interface GenerationPromptDocument {
  body: string
  config: Record<string, unknown>
  hasFrontMatter: boolean
  modelId: string | null
}

export function validateGenerationModelId(value: unknown): string
export function parseGenerationPrompt(source: string): GenerationPromptDocument
export function stripGenerationPromptFrontMatter(source: string): string
export function setGenerationPromptModel(source: string, modelId: string): string
export function generationPromptModelId(source: string): string | null
