/** Namespaced Node identities: local IDs resolve under a run instance namespace. */
export function nodeIds(namespace: string): Record<string, string> {
  const scoped = (local: string): string => `${namespace}/${local}`;
  return {
    projectSession: scoped('src-fs-source'),
    document: scoped('node-md-source'),
    parser: scoped('node-md-parser'),
    outline: scoped('node-outliner'),
    registry: scoped('node-sqlite'),
    persistence: scoped('sink-sqlite-writer'),
    persistenceObservation: scoped('src-sqlite-observer'),
    securityGate: scoped('node-sec-gate'),
    generationModelResolver: scoped('node-generation-model-resolver'),
    generationTask: scoped('node-generation-task'),
    history: scoped('n-hist'),
    lifecycle: scoped('node-application-lifecycle'),
    host: scoped('host-el'),
    windowExec: scoped('sink-electron-window'),
    windowObs: scoped('src-electron-window'),
    submit: scoped('sink-generation-submit'),
    poll: scoped('src-generation-poll'),
    pollScheduler: scoped('src-generation-poll-scheduler'),
    download: scoped('sink-generation-download'),
  };
}

/** Default namespace keeps single-Studio readers working; run frontends override it. */
const DEFAULT_NAMESPACE = typeof window === 'undefined' ? 'studio' : window.graphvideoDesktop?.graphNamespace ?? 'studio';

function scopedIds(): Record<string, string> {
  return nodeIds(DEFAULT_NAMESPACE);
}

export const projectStructureRuntimeNodeIds = {
  document: `${DEFAULT_NAMESPACE}/node-md-source`,
  parser: `${DEFAULT_NAMESPACE}/node-md-parser`,
  outline: `${DEFAULT_NAMESPACE}/node-outliner`,
  registry: `${DEFAULT_NAMESPACE}/node-sqlite`,
  persistence: `${DEFAULT_NAMESPACE}/sink-sqlite-writer`,
  persistenceObservation: `${DEFAULT_NAMESPACE}/src-sqlite-observer`,
} as const

export const graphVideoRuntimeNodeIds = {
  projectSession: `${DEFAULT_NAMESPACE}/src-fs-source`,
  document: `${DEFAULT_NAMESPACE}/node-md-source`,
  parser: `${DEFAULT_NAMESPACE}/node-md-parser`,
  outline: `${DEFAULT_NAMESPACE}/node-outliner`,
  registry: `${DEFAULT_NAMESPACE}/node-sqlite`,
  securityGate: `${DEFAULT_NAMESPACE}/node-sec-gate`,
  generationModelResolver: `${DEFAULT_NAMESPACE}/node-generation-model-resolver`,
  generationTask: `${DEFAULT_NAMESPACE}/node-generation-task`,
  history: `${DEFAULT_NAMESPACE}/n-hist`,
} as const

export { scopedIds };
