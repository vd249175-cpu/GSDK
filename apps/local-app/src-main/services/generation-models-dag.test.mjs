import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { evaluateGenerationDag } from './generation-model-store.mjs'

import { fileURLToPath } from 'node:url'
const skillsRoot = fileURLToPath(new URL('../../resources/generation-models', import.meta.url))

describe('Generation Models DAG Engine integration', () => {
  it('retains the temporary phase-4 bridge surface until graph switching', async () => {
    expect(typeof evaluateGenerationDag).toBe('function')
    expect(typeof evaluateGenerationDag).toBe('function')
  })
})
