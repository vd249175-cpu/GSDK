import type { GenerationDagItem } from '@graphvideo/client-sdk'

export function isExecutableGenerationReadiness(
  readiness: GenerationDagItem['readiness'],
): boolean {
  return readiness?.status === 'READY' || readiness?.status === 'COMPLETED'
}
