import type { GenerationAdapterSubmitSpec } from '../src/effects/generation-adapter-operation'

export function compileGenerationSubmitSpecV2(
  request: Record<string, any>,
  project: { id: string; name?: string; baseUrl?: string },
): GenerationAdapterSubmitSpec
