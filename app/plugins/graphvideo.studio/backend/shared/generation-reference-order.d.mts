export interface GenerationReferenceOrderNode {
  readonly id: string
  readonly type: string
  readonly title?: string
}

export interface GenerationReferenceOrderInput {
  readonly prompt?: string
  readonly nodes?: readonly GenerationReferenceOrderNode[]
  readonly targetNodeId: string
  readonly structuralIds?: readonly string[]
}

export function orderedGenerationReferenceIds(input: GenerationReferenceOrderInput): string[]
