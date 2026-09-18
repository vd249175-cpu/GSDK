import { defineGraphFactory } from '@graphvideo/sdk/plugin';
import type { GraphFactoryContext } from '@graphvideo/sdk/plugin';
import {
  createAuthoringNodes,
  createGenerationNodes,
  createPersistenceNodes,
  createPlatformNodes,
  type StudioNodeDependencies,
} from './studio-node-groups'

export type { StudioNodeDependencies } from './studio-node-groups'

const AUTHORING_LOCALS = ['src-fs-source', 'node-md-source', 'node-md-parser', 'node-outliner', 'n-hist'] as const;
const PERSISTENCE_LOCALS = ['node-sqlite', 'sink-sqlite-writer', 'src-sqlite-observer'] as const;
const GENERATION_LOCALS = [
  'node-sec-gate',
  'node-generation-model-resolver',
  'node-generation-task',
  'sink-generation-submit',
  'src-generation-poll',
  'src-generation-poll-scheduler',
  'sink-generation-download',
] as const;
const PLATFORM_LOCALS = [
  'node-application-lifecycle',
  'host-el',
  'sink-electron-window',
  'src-electron-window',
] as const;
const STUDIO_LOCALS = [
  ...AUTHORING_LOCALS,
  ...PERSISTENCE_LOCALS,
  ...GENERATION_LOCALS,
  ...PLATFORM_LOCALS,
] as const;

/** The production composition factory creating all 19 Studio Nodes under one namespace. */
export const createStudioNodes = defineGraphFactory(
  (ctx: GraphFactoryContext<StudioNodeDependencies>) => {
    if (!ctx.instanceId) throw new Error('createStudioNodes requires ctx.instanceId');
    return [
      ...createAuthoringNodes(ctx),
      ...createPersistenceNodes(ctx),
      ...createGenerationNodes(ctx),
      ...createPlatformNodes(ctx),
    ];
  },
);
createStudioNodes.describe = () => ({
  kind: 'graph',
  localIds: [...STUDIO_LOCALS.map((local) => local)],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'src-fs-source', infoType: 'ProjectOpenedInfo' },
    { localId: 'node-md-source', infoType: 'UserMarkdownEditedInfo' },
    { localId: 'node-md-source', infoType: 'ProjectTreeEditRequestedInfo' },
    { localId: 'node-sqlite', infoType: 'UserMetadataPatchInfo' },
    { localId: 'node-sec-gate', infoType: 'GenerationBudgetConfiguredInfo' },
    { localId: 'node-sec-gate', infoType: 'GenerationCreditsResetInfo' },
    { localId: 'node-generation-model-resolver', infoType: 'GenerationBatchRequestedInfo' },
    { localId: 'node-generation-task', infoType: 'GenerationBatchCancelRequestedInfo' },
    { localId: 'n-hist', infoType: 'UserSnapshotActionInfo' },
  ],
});
