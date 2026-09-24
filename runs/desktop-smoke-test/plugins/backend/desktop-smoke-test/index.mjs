import { defineBackendPlugin } from '@graphframework/sdk/plugin'
import { DesktopSmokeEntryNode, DesktopSmokeSessionNode } from './session.mjs'
import { BrowserCheckExecutionNode, DesktopFocusExecutionNode,
  DocEditExecutionNode, DesktopSmokeObservationNode } from './stages.mjs'
import { DocEditGateNode, WorldSaveReviewNode, WorldDocumentExecutionNode } from './review.mjs'

export { DesktopSmokeEntryNode, DesktopSmokeSessionNode } from './session.mjs'
export { BrowserCheckExecutionNode, DesktopFocusExecutionNode,
  DocEditExecutionNode, DesktopSmokeObservationNode,
  BROWSER_NAVIGATE_ADAPTER_ID, DESKTOP_CONTROL_ADAPTER_ID,
  DESKTOP_OBSERVATION_ADAPTER_ID } from './stages.mjs'
export { DocEditGateNode, WorldSaveReviewNode, WorldDocumentExecutionNode,
  WORLD_DOCUMENT_ADAPTER_ID } from './review.mjs'

export function createDesktopSmokeTest(ctx) {
  const idFor = (local) => ctx?.nodeIdFor?.(local)
    ?? `${ctx?.instanceId ?? 'test.desktop-smoke-test'}/${local}`
  const ids = Object.fromEntries([
    'entry', 'session', 'browser-execution', 'desktop-execution', 'doc-edit-gate',
    'doc-execution', 'observation', 'world-review', 'world-document',
  ].map((name) => [name, idFor(name)]))
  const dependencies = ctx?.dependencies ?? {}
  return {
    entry: new DesktopSmokeEntryNode(ids.entry, ids.session, ids['browser-execution']),
    session: new DesktopSmokeSessionNode(ids.session),
    browserExecution: new BrowserCheckExecutionNode(ids['browser-execution'], ids.session,
      ids['desktop-execution'], ids['doc-edit-gate'], dependencies.browserNavigate),
    desktopExecution: new DesktopFocusExecutionNode(ids['desktop-execution'], ids.session,
      ids.observation, dependencies.desktopControl),
    docEditGate: new DocEditGateNode(ids['doc-edit-gate'], ids.session, ids['doc-execution']),
    docExecution: new DocEditExecutionNode(ids['doc-execution'], ids.session,
      ids.observation, dependencies.desktopControl),
    observation: new DesktopSmokeObservationNode(ids.observation, ids.session,
      ids['world-review'], dependencies.desktopObservation),
    worldReview: new WorldSaveReviewNode(ids['world-review'], ids.session, ids['world-document']),
    worldDocument: new WorldDocumentExecutionNode(ids['world-document'], ids.session,
      dependencies.worldDocument),
  }
}

export const createDesktopSmokeTestGraph = (ctx) => Object.values(createDesktopSmokeTest(ctx))
createDesktopSmokeTestGraph.describe = () => ({
  kind: 'graph',
  localIds: ['entry', 'session', 'browser-execution', 'desktop-execution',
    'doc-edit-gate', 'doc-execution', 'observation', 'world-review', 'world-document'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'entry', infoType: 'TriggerSmokeTest' },
    { localId: 'doc-edit-gate', infoType: 'ConfirmStepInfo' },
  ],
})

export default defineBackendPlugin({
  id: 'test.desktop-smoke-test',
  createNodes: createDesktopSmokeTestGraph,
  rendererRoots: [
    { targetNodeId: 'test.desktop-smoke-test/entry', infoType: 'TriggerSmokeTest',
      validate: (info) => info?.type === 'TriggerSmokeTest' },
    { targetNodeId: 'test.desktop-smoke-test/doc-edit-gate', infoType: 'ConfirmStepInfo',
      validate: (info) => info?.type === 'ConfirmStepInfo'
        && (info.decision === 'approve' || info.decision === 'reject') },
  ],
})
