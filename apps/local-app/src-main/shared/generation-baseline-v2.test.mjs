import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import baseline from './__fixtures__/generation-model-baseline.json' with { type: 'json' }
import { estimateModelBudgetV2 } from './generation-model-intent-v2.mjs'
import { loadGenerationCatalogSnapshot } from '../services/generation-catalog-snapshot.mjs'

let catalog
beforeAll(async () => {
  catalog = (await loadGenerationCatalogSnapshot(fileURLToPath(new URL('../resources/generation-models', import.meta.url)))).read()
})

describe('generation model migration baseline', () => {
  it('locks the production model identities, media types and default budgets', () => {
    expect(catalog.models.map((entry) => entry.model.id)).toEqual(baseline.modelIds)
    expect(Object.fromEntries(catalog.models.map((entry) => [entry.model.id, entry.model.mediaType]))).toEqual(baseline.mediaTypes)
    expect(Object.fromEntries(catalog.models.map((entry) => [
      entry.model.id,
      estimateModelBudgetV2(entry, { model: entry.model.id }).estimatedCredits,
    ]))).toEqual(baseline.budgets)
  })
})
