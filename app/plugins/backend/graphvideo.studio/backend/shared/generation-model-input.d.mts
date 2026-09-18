export interface GenerationModelReference {
  id: string
  type: 'image' | 'video' | 'audio' | 'text' | 'style'
  title?: string
  ordinal?: number
  filePath?: string
  content?: string
  isReady?: boolean
  duration?: number
  metadata?: Record<string, unknown>
}

export interface GenerationModelInput {
  prompt: string
  nodeType?: 'image' | 'video' | 'audio'
  references?: GenerationModelReference[]
}
