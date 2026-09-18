export interface StudioPluginManifestBase {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly contributes: {
    readonly backend?: string
    readonly frontend?: string
    readonly elements: readonly string[]
    readonly workspaces: readonly string[]
    readonly nodeFactories: readonly string[]
    readonly graphFactories: readonly string[]
  }
}

export interface StudioPluginManifestV1 extends StudioPluginManifestBase {
  readonly apiVersion: 1
  readonly kind?: undefined
}

export interface StudioBackendManifestV2 extends StudioPluginManifestBase {
  readonly apiVersion: 2
  readonly kind: 'backend'
}

export interface StudioFrontendManifestV2 extends StudioPluginManifestBase {
  readonly apiVersion: 2
  readonly kind: 'frontend'
}

export type StudioPluginManifest =
  | StudioPluginManifestV1
  | StudioBackendManifestV2
  | StudioFrontendManifestV2

export function parseStudioPluginManifest(textOrValue: string | unknown): StudioPluginManifest
export function defineStudioPluginManifest(
  manifest: StudioPluginManifest | (Omit<StudioPluginManifestV1, 'contributes'> & {
    contributes?: Partial<StudioPluginManifestV1['contributes']>
  }) | (Omit<StudioBackendManifestV2, 'contributes'> & {
    contributes?: Partial<StudioBackendManifestV2['contributes']>
  }) | (Omit<StudioFrontendManifestV2, 'contributes'> & {
    contributes?: Partial<StudioFrontendManifestV2['contributes']>
  }),
): StudioPluginManifest
