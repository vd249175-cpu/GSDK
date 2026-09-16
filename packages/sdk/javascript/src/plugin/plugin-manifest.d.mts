export interface StudioPluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly apiVersion: 1
  readonly contributes: {
    readonly backend?: string
    readonly elements: readonly string[]
    readonly workspaces: readonly string[]
  }
}

export function parseStudioPluginManifest(textOrValue: string | unknown): StudioPluginManifest
export function defineStudioPluginManifest(
  manifest: StudioPluginManifest | (Omit<StudioPluginManifest, 'contributes'> & {
    contributes?: Partial<StudioPluginManifest['contributes']>
  }),
): StudioPluginManifest

