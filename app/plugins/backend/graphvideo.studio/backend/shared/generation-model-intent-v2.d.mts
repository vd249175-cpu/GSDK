import type { GenerationModelInput } from './generation-model-input.mjs'
import type { GenerationModelPackageSnapshot } from './generation-model-package.mjs'

export function compileModelIntentV2(
  snapshot: GenerationModelPackageSnapshot,
  input: GenerationModelInput,
): Record<string, any>

export function buildModelRequestV2(
  snapshot: GenerationModelPackageSnapshot,
  input: GenerationModelInput,
): Record<string, any>

export function estimateModelBudgetV2(
  snapshot: GenerationModelPackageSnapshot,
  options?: Record<string, any>,
): Record<string, any>
