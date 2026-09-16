import type { ApplicationRequestMap } from './contract/application'

export interface FrontendCausalLink {
  id: string
  applicationMethod: keyof ApplicationRequestMap
  injection: { targetNodeId: string; infoType: string }
  projections: Array<{
    ownerNodeId: string
    ownerField: string
    applicationStatePath: string
    consumers: string[]
  }>
}

/** UI/Application boundary only. Node-to-Node sends are always derived from change source. */
export const FRONTEND_CAUSAL_LINKS: FrontendCausalLink[] = [
  {
    id: 'project-open',
    applicationMethod: 'project.open',
    injection: { targetNodeId: 'src-fs-source', infoType: 'ProjectOpenedInfo' },
    projections: [
      { ownerNodeId: 'src-fs-source', ownerField: 'projectName', applicationStatePath: 'project.name', consumers: ['TopToolbar', 'ProjectHome'] },
      { ownerNodeId: 'src-fs-source', ownerField: 'currentPath', applicationStatePath: 'project.localPath', consumers: ['TopToolbar', 'ProjectHome'] },
      { ownerNodeId: 'node-sqlite', ownerField: 'table', applicationStatePath: 'project.nodes', consumers: ['OutlinerPanel', 'PropertiesPanel', 'GenerationPanel'] },
    ],
  },
  {
    id: 'project-snapshot-branch',
    applicationMethod: 'project.snapshot.branch',
    injection: { targetNodeId: 'src-fs-source', infoType: 'ProjectOpenedInfo' },
    projections: [
      { ownerNodeId: 'src-fs-source', ownerField: 'projectName', applicationStatePath: 'project.name', consumers: ['TopToolbar', 'ProjectSnapshotsDialog'] },
      { ownerNodeId: 'src-fs-source', ownerField: 'currentPath', applicationStatePath: 'project.localPath', consumers: ['TopToolbar', 'ProjectSnapshotsDialog'] },
      { ownerNodeId: 'node-sqlite', ownerField: 'table', applicationStatePath: 'project.nodes', consumers: ['OutlinerPanel', 'PropertiesPanel', 'GenerationPanel'] },
    ],
  },
  {
    id: 'markdown-edit',
    applicationMethod: 'project.run-markdown',
    injection: { targetNodeId: 'node-md-source', infoType: 'UserMarkdownEditedInfo' },
    projections: [{ ownerNodeId: 'node-md-source', ownerField: 'markdown', applicationStatePath: 'project.markdown', consumers: ['MarkdownEditorPanel', 'OutlinerPanel'] }],
  },
  {
    id: 'tree-edit',
    applicationMethod: 'project.tree.edit',
    injection: { targetNodeId: 'node-md-source', infoType: 'ProjectTreeEditRequestedInfo' },
    projections: [{ ownerNodeId: 'node-outliner', ownerField: 'tree', applicationStatePath: 'project.tree', consumers: ['OutlinerPanel', 'PropertiesPanel'] }],
  },
  {
    id: 'node-metadata-patch',
    applicationMethod: 'project.node.patch',
    injection: { targetNodeId: 'node-sqlite', infoType: 'UserMetadataPatchInfo' },
    projections: [{ ownerNodeId: 'node-sqlite', ownerField: 'table', applicationStatePath: 'project.nodes', consumers: ['PropertiesPanel', 'GenerationPanel'] }],
  },
  {
    id: 'generation-budget-configure',
    applicationMethod: 'generation.budget.configure',
    injection: { targetNodeId: 'node-sec-gate', infoType: 'GenerationBudgetConfiguredInfo' },
    projections: [{ ownerNodeId: 'node-sec-gate', ownerField: 'maxCreditBudget', applicationStatePath: 'runtime.generation.maxBudget', consumers: ['GenerationPanel', 'OutlinerPanel'] }],
  },
  {
    id: 'generation-credits-reset',
    applicationMethod: 'generation.credits.reset',
    injection: { targetNodeId: 'node-sec-gate', infoType: 'GenerationCreditsResetInfo' },
    projections: [{ ownerNodeId: 'node-sec-gate', ownerField: 'spentCredits', applicationStatePath: 'runtime.generation.spentCredits', consumers: ['GenerationPanel', 'OutlinerPanel'] }],
  },
  {
    id: 'generation-model-generate',
    applicationMethod: 'generation-models.generate',
    injection: { targetNodeId: 'node-generation-model-resolver', infoType: 'GenerationBatchRequestedInfo' },
    projections: [
      { ownerNodeId: 'node-generation-task', ownerField: 'tasks', applicationStatePath: 'runtime.taskGraphs', consumers: ['GenerationPanel', 'OutlinerPanel', 'TopToolbar'] },
      { ownerNodeId: 'node-sqlite', ownerField: 'table', applicationStatePath: 'project.nodes', consumers: ['GenerationPanel', 'PropertiesPanel', 'OutlinerPanel'] },
    ],
  },
  {
    id: 'generation-model-generate-batch',
    applicationMethod: 'generation-models.generate-batch',
    injection: { targetNodeId: 'node-generation-model-resolver', infoType: 'GenerationBatchRequestedInfo' },
    projections: [
      { ownerNodeId: 'node-generation-task', ownerField: 'tasks', applicationStatePath: 'runtime.taskGraphs', consumers: ['GenerationPanel', 'OutlinerPanel', 'TopToolbar'] },
      { ownerNodeId: 'node-sqlite', ownerField: 'table', applicationStatePath: 'project.nodes', consumers: ['GenerationPanel', 'PropertiesPanel', 'OutlinerPanel'] },
    ],
  },
  {
    id: 'generation-model-generate-cancel',
    applicationMethod: 'generation-models.generate',
    injection: { targetNodeId: 'node-generation-task', infoType: 'GenerationBatchCancelRequestedInfo' },
    projections: [
      { ownerNodeId: 'node-generation-task', ownerField: 'tasks', applicationStatePath: 'runtime.taskGraphs', consumers: ['GenerationPanel', 'TopToolbar'] },
    ],
  },
  {
    id: 'generation-model-generate-batch-cancel',
    applicationMethod: 'generation-models.generate-batch',
    injection: { targetNodeId: 'node-generation-task', infoType: 'GenerationBatchCancelRequestedInfo' },
    projections: [
      { ownerNodeId: 'node-generation-task', ownerField: 'tasks', applicationStatePath: 'runtime.taskGraphs', consumers: ['GenerationPanel', 'TopToolbar'] },
    ],
  },
]

export interface FrontendServiceLink {
  id: string
  applicationMethod: keyof ApplicationRequestMap
  provider: string
  consumers: string[]
}

/** Stable non-causal capabilities that must exist before optional Elements load. */
export const FRONTEND_SERVICE_LINKS: FrontendServiceLink[] = [
  { id: 'local-project-open', applicationMethod: 'project.open', provider: 'application/services/applicationServices', consumers: ['MarkdownEditorPanel'] },
  { id: 'local-project-recent', applicationMethod: 'project.list-recent', provider: 'application/services/applicationServices', consumers: ['MarkdownEditorPanel'] },
  { id: 'project-snapshot-list', applicationMethod: 'project.snapshot.list', provider: 'application/services/applicationServices', consumers: ['ProjectSnapshotsDialog'] },
  { id: 'project-snapshot-create', applicationMethod: 'project.snapshot.create', provider: 'application/services/applicationServices', consumers: ['ProjectSnapshotsDialog'] },
  { id: 'project-snapshot-branch-service', applicationMethod: 'project.snapshot.branch', provider: 'application/services/applicationServices', consumers: ['ProjectSnapshotsDialog'] },
  { id: 'local-media-url', applicationMethod: 'assets.url', provider: 'application/services/projectAssetsService', consumers: ['PropertiesPanel', 'GenerationPanel', 'AudioPlayer'] },
  { id: 'copy-media-versions', applicationMethod: 'assets.copy-versions', provider: 'application/services/projectAssetsService', consumers: ['PropertiesPanel', 'OutlinerPanel'] },
  { id: 'export-current-videos', applicationMethod: 'assets.export-videos', provider: 'application/services/projectAssetsService', consumers: ['OutlinerPanel'] },
  { id: 'generation-model-list', applicationMethod: 'generation-models.list', provider: 'application/services/applicationServices', consumers: ['GenerationPanel', 'PropertiesPanel'] },
  { id: 'generation-model-evaluate-dag', applicationMethod: 'generation-models.evaluate-dag', provider: 'application/services/applicationServices', consumers: ['OutlinerPanel'] },
  { id: 'generation-model-resolve', applicationMethod: 'generation-models.resolve', provider: 'application/services/applicationServices', consumers: ['GenerationPanel'] },
  { id: 'generation-model-build-request', applicationMethod: 'generation-models.build-request', provider: 'application/services/applicationServices', consumers: ['GenerationPanel'] },
  { id: 'generation-model-import', applicationMethod: 'generation-models.import', provider: 'application/services/applicationServices', consumers: ['GenerationPanel'] },
  { id: 'generation-model-delete', applicationMethod: 'generation-models.delete', provider: 'application/services/applicationServices', consumers: ['GenerationPanel'] },
  { id: 'prompt-library-list', applicationMethod: 'prompt-library.list', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'prompt-library-read', applicationMethod: 'prompt-library.read', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'prompt-library-save', applicationMethod: 'prompt-library.save', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'prompt-library-create', applicationMethod: 'prompt-library.create', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'prompt-library-create-directory', applicationMethod: 'prompt-library.create-directory', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'prompt-library-rename', applicationMethod: 'prompt-library.rename', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'prompt-library-delete', applicationMethod: 'prompt-library.delete', provider: 'application/services/applicationServices', consumers: ['PromptLibraryPanel'] },
  { id: 'agent-discover', applicationMethod: 'agent.discover', provider: 'application/services/applicationServices', consumers: ['AgentConsolePanel'] },
  { id: 'agent-launch-native-terminal', applicationMethod: 'agent.launch-terminal', provider: 'application/services/applicationServices', consumers: ['AgentConsolePanel'] },
  { id: 'agent-open-directory', applicationMethod: 'agent.open-directory', provider: 'application/services/applicationServices', consumers: ['AgentConsolePanel'] },
]
