/** Stable Node identities shared by graph assembly and the read-only application projection. */
export const projectStructureRuntimeNodeIds = {
  document: 'node-md-source',
  parser: 'node-md-parser',
  outline: 'node-outliner',
  registry: 'node-sqlite',
  persistence: 'sink-sqlite-writer',
  persistenceObservation: 'src-sqlite-observer',
} as const

export const graphVideoRuntimeNodeIds = {
  projectSession: 'src-fs-source',
  document: 'node-md-source',
  parser: 'node-md-parser',
  outline: 'node-outliner',
  registry: 'node-sqlite',
  securityGate: 'node-sec-gate',
  generationModelResolver: 'node-generation-model-resolver',
  generationTask: 'node-generation-task',
  history: 'n-hist',
} as const
