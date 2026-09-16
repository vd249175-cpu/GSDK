import type { GenerationDagItem } from '../../frontend/client-sdk'

export function isExecutableGenerationReadiness(
  readiness: GenerationDagItem['readiness'],
): boolean {
  return readiness?.status === 'READY' || readiness?.status === 'COMPLETED'
}
