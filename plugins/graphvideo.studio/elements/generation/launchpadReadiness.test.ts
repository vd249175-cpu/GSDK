import { describe, expect, it } from 'vitest'
import type { GenerationDagReadiness } from '@graphvideo/client-sdk'
import { isExecutableGenerationReadiness } from './launchpadReadiness'

describe('launchpad generation readiness', () => {
  it.each<GenerationDagReadiness['status']>(['READY', 'COMPLETED'])(
    'allows %s media to execute',
    (status) => {
      expect(isExecutableGenerationReadiness({ status, missingDependencies: [] })).toBe(true)
    },
  )

  it.each<GenerationDagReadiness['status']>([
    'MANUAL', 'BLOCKED', 'MISSING_DEPENDENCIES', 'ERROR',
  ])('blocks %s media from executing', (status) => {
    expect(isExecutableGenerationReadiness({ status, missingDependencies: [] })).toBe(false)
  })

  it('blocks media while DAG evaluation is pending', () => {
    expect(isExecutableGenerationReadiness(undefined)).toBe(false)
  })
})
