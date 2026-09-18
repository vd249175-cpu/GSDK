import { defineBackendPlugin } from '@graphvideo/sdk/plugin';
import {
  createAuthoringNodes, createGenerationNodes, createPersistenceNodes, createPlatformNodes,
  type StudioNodeDependencies,
} from './backend/nodes/studio-node-groups'

export { createStudioNodes, type StudioNodeDependencies } from './backend/nodes/studio-factories';
export {
  createAuthoringNodes,
  createFileSystemSourceNode,
  createMarkdownSourceNode,
  createMarkdownParserNode,
  createOutlinerTreeNode,
  createHistoryManagerNode,
  createSqliteRegistryNode,
  createSqliteWriterSinkNode,
  createSqliteObserverSourceNode,
  createSecurityGateNode,
  createGenerationTaskNode,
  createGenerationModelResolverNode,
  createGenerationSubmitNode,
  createGenerationPollNode,
  createGenerationPollSchedulerNode,
  createGenerationDownloadNode,
  createElectronHostNode,
  createElectronWindowExecutionNode,
  createElectronWindowObservationNode,
  createPersistenceNodes,
  createGenerationNodes,
  createPlatformNodes,
} from './backend/nodes/studio-node-groups';

export default defineBackendPlugin<StudioNodeDependencies>({
  id: 'graphvideo.studio',
  rendererRoots: [
    { targetNodeId: 'src-fs-source', infoType: 'ProjectOpenedInfo', validate: (info) => Boolean(info.project && typeof info.project === 'object') },
    { targetNodeId: 'node-md-source', infoType: 'UserMarkdownEditedInfo', validate: (info) => typeof info.markdown === 'string' },
    { targetNodeId: 'node-md-source', infoType: 'ProjectTreeEditRequestedInfo', validate: (info) => Boolean(info.operation && typeof info.operation === 'object') },
    { targetNodeId: 'node-sqlite', infoType: 'UserMetadataPatchInfo', validate: (info) => Boolean(info.patch && typeof info.patch === 'object' && typeof (info.patch as { id?: unknown }).id === 'string') },
    { targetNodeId: 'node-sec-gate', infoType: 'GenerationBudgetConfiguredInfo', validate: (info) => typeof info.maxBudget === 'number' && Number.isFinite(info.maxBudget) && info.maxBudget >= 0 },
    { targetNodeId: 'node-sec-gate', infoType: 'GenerationCreditsResetInfo', validate: () => true },
    { targetNodeId: 'node-generation-model-resolver', infoType: 'GenerationBatchRequestedInfo', validate: (info) => typeof info.batchId === 'string' && Array.isArray(info.items) && Boolean(info.project && info.catalog) },
    { targetNodeId: 'node-generation-task', infoType: 'GenerationBatchCancelRequestedInfo', validate: (info) => typeof info.batchId === 'string' },
    { targetNodeId: 'n-hist', infoType: 'UserSnapshotActionInfo', validate: (info) => Boolean(info.action && typeof info.action === 'object' && ['UNDO', 'REDO', 'CLEAR_REDO'].includes(String((info.action as { type?: unknown }).type))) },
  ],
  createNodes: () => { throw new Error('Studio requires explicit NodeFactory/GraphFactory instances in run.config.json'); },
})
