export type GenerationModelMediaType = 'image' | 'video' | 'audio'

export interface GenerationModelPackageSnapshot {
  readonly schemaVersion: 2
  readonly model: {
    readonly schemaVersion: 2
    readonly id: string
    readonly name: string
    readonly description: string
    readonly mediaType: GenerationModelMediaType
    readonly provider: string
    readonly apiModel: string
    readonly parameters: Readonly<Record<string, unknown>>
    readonly defaults: Readonly<Record<string, unknown>>
    readonly capabilities: Readonly<Record<string, unknown>>
    readonly prompt: Readonly<Record<string, unknown>>
    readonly dependencies: Readonly<Record<string, unknown>>
    readonly budget: Readonly<Record<string, unknown>>
    readonly variants: readonly unknown[]
    readonly aliases: readonly string[]
    readonly aliasDefaults: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  }
  readonly execution: Readonly<Record<string, unknown>> & {
    readonly schemaVersion: 2
    readonly kind: 'mock' | 'audio-task' | 'comfy-template'
  }
  readonly workflow?: Readonly<Record<string, unknown>>
}

export function parseGenerationModelPackage(input: {
  directoryName: string
  files: Readonly<Record<string, string>>
}): GenerationModelPackageSnapshot

export const generationModelPackageLimits: Readonly<{
  maxFileBytes: number
  maxPackageBytes: number
}>
