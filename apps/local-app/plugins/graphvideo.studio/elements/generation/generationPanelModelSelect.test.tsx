import { afterEach, describe, expect, it } from 'vitest';
import { KernelRuntime, type EffectAdapter } from '@graphvideo/kernel';
import { ApplicationHost } from '../../../../renderer/src/studio/application/host/applicationHost';
import { registerApplicationHandlers } from '../../../../renderer/src/studio/application/host/registerApplicationHandlers';
import {
  KernelApplicationGraphHost,
} from '../../../../renderer/src/studio/application/graph/graphHost';
import {
  graphVideoRuntimeNodeIds,
} from '../../../../renderer/src/studio/graph/node-ids';
import { createStudioNodes } from '../../../../src-main/studio/nodes/studio-factories';
import { InProcessTransport } from '../../../../renderer/src/studio/application/transport/inProcessTransport';
import { ApplicationSnapshotStore, createApplicationClient } from '../../../../renderer/src/studio/client/app/applicationClient';
import { ClientStateStore } from '../../../../renderer/src/studio/client/state/clientStateStore';
import { ClientTransport } from '../../../../renderer/src/studio/client/app/clientTransport';
import type { ProjectNode } from '../../../../renderer/src/studio/core/project/types';
import {
  projectStructureAdapterId,
  type ProjectStructurePersistObservation,
  type ProjectStructurePersistRequest,
} from '../../../../src-main/studio/effects/project-structure-adapter';
import {
  sqliteMetadataAdapterId,
  type SqlitePersistObservation,
  type SqlitePersistRequest,
} from '../../../../src-main/studio/effects/sqlite-metadata-adapter';
import { setGenerationPromptModel, parseGenerationPrompt } from '../../../../src-main/shared/generation-prompt.mjs';
import { LaunchpadScheduler } from '../../../../src-main/studio/domain/launchpad-scheduler';

function createStudioRuntime(options: { dependencies: any }) {
  const runtime = new KernelRuntime();
  const nodes = createStudioNodes(options.dependencies);
  for (const node of nodes) {
    runtime.registerNode(node);
  }
  return runtime;
}

const disposers: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

const fishcanNode: ProjectNode = {
  id: 'node_prop_fishcan',
  type: 'image',
  title: '蝴蝶结小鱼干罐头',
  description: '绑着粉色丝带蝴蝶结的精致小鱼干罐头。',
  prompt: 'pure white background, commercial product photography showcase of authentic miniature gourmet dried fish tin can.',
};

async function setupTestApp() {
  let persistedNodes: ProjectNode[] = [];
  const projectAdapter: EffectAdapter<
    ProjectStructurePersistRequest,
    ProjectStructurePersistObservation
  > = {
    id: projectStructureAdapterId,
    async execute(request) {
      persistedNodes = [...request.nodes];
      return {
        nodes: request.nodes,
        retainedNodes: request.retainedNodes,
        savedAt: 1_000,
        contentRef: `fixture:project/${request.mode}`,
      };
    },
  };
  const sqliteAdapter: EffectAdapter<SqlitePersistRequest, SqlitePersistObservation> = {
    id: sqliteMetadataAdapterId,
    async execute(request) {
      persistedNodes = request.records as ProjectNode[];
      return {
        dbFilePath: request.dbFilePath,
        persistedRecordCount: request.records.length,
        byteLength: 128,
        contentRef: 'fixture:sqlite',
      };
    },
  };

  const studioRuntime = createStudioRuntime({
    dependencies: {
      projectStructurePersistAdapter: projectAdapter,
      sqlitePersistAdapter: sqliteAdapter,
    },
  });
  const graph = new KernelApplicationGraphHost(
    studioRuntime,
    { nextSubmissionId: (() => {
      let sequence = 0;
      return () => `generation-model-test/${++sequence}`;
    })() },
  );
  await graph.connect();

  const applicationHost = new ApplicationHost();
  const removeHandlers = registerApplicationHandlers({
    host: applicationHost,
    graph,
    projectPersistence: {
      async importNodeVersion() { return null; },
      async promoteNodeVersion() { return fishcanNode; },
    },
    services: {
      localProjects: {
        async listRecent() { return []; },
        async open() { return null; },
      },
      projectAssets: {
        url: () => 'graphvideo-asset://node/version',
        async copyVersionFiles() { return { count: 0, mode: 'files' as const }; },
        async exportCurrentVideos() { return { canceled: true, exported: [], skipped: [] }; },
      },
      generationModels: {
        async list() { return { models: [], issues: [] }; },
        async evaluateDag() { return []; },
        async generate() { return undefined; },
        async resolve() { throw new Error('not used'); },
        async buildRequest() { return undefined; },
        async import() { return { canceled: true }; },
        async delete() { return undefined; },
      },
      promptLibrary: {
        async list() { return []; },
        async read() { return ''; },
        async save() { return undefined; },
        async create() { return undefined; },
        async createDirectory() { return undefined; },
        async rename() { return undefined; },
        async delete() { return undefined; },
      },
      agentHost: {
        async discover() { return []; },
        onTerminalData() { return () => undefined; },
        onTerminalExit() { return () => undefined; },
      },
    },
  });
  const appTransport = new InProcessTransport(applicationHost);
  const clientTransport = new ClientTransport(appTransport, new ClientStateStore());
  const appClient = createApplicationClient(clientTransport);
  const snapshotStore = new ApplicationSnapshotStore(
    clientTransport,
    await clientTransport.request('snapshot.read', undefined),
  );

  disposers.push(
    () => snapshotStore.dispose(),
    () => appTransport.dispose(),
    () => removeHandlers(),
    () => applicationHost.dispose(),
    () => graph.dispose(),
    () => studioRuntime.dispose(),
  );

  await graph.injectRootInfo(graphVideoRuntimeNodeIds.projectSession, {
    type: 'ProjectOpenedInfo',
    project: {
      name: '测试项目',
      path: 'C:/test-project',
      markdown: `---
id-map:
  蝴蝶结小鱼干罐头: { type: @, id: node_prop_fishcan }
---
<project-structure>
# 项目
  @蝴蝶结小鱼干罐头
</project-structure>`,
      nodes: [fishcanNode],
      retainedNodes: [],
    },
  });

  return {
    graph,
    persistedNodes: () => persistedNodes,
    appClient,
    snapshotStore,
  };
}

describe('Generation Model Selection and Global Inter-component Broadcast', () => {
  it('persists model header through Kernel and broadcasts its projection', async () => {
    const { graph, persistedNodes, appClient, snapshotStore } = await setupTestApp();

    const initialNode = graph.projection.read().project.nodes.node_prop_fishcan;
    expect(initialNode.prompt).toBe('pure white background, commercial product photography showcase of authentic miniature gourmet dried fish tin can.');

    const nextPrompt = setGenerationPromptModel(initialNode.prompt!, 'nano-banana-image');
    expect(nextPrompt).toContain('model: nano-banana-image');

    await appClient.project.patchNode({
      id: 'node_prop_fishcan',
      patch: { prompt: nextPrompt },
    });

    const updatedNode = graph.projection.read().project.nodes.node_prop_fishcan;
    expect(updatedNode.prompt).toBe(nextPrompt);
    expect(persistedNodes().find((node) => node.id === 'node_prop_fishcan')?.prompt).toBe(nextPrompt);

    const clientSnapshot = snapshotStore.readState();
    expect(clientSnapshot.project.nodes.node_prop_fishcan.prompt).toBe(nextPrompt);

    const items = LaunchpadScheduler.buildLaunchpadItems(clientSnapshot.project.nodes, clientSnapshot.project.tree);
    const lpFishcan = items.find((item) => item.id === 'node_prop_fishcan');
    expect(lpFishcan).toBeDefined();
    expect(lpFishcan?.hasHeader).toBe(true);
    expect(lpFishcan?.modelId).toBe('nano-banana-image');
    expect(lpFishcan?.status).toBe('ready');
    expect(lpFishcan?.areDependenciesReady).toBe(true);

    const parsed = parseGenerationPrompt(updatedNode.prompt!);
    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.modelId).toBe('nano-banana-image');

    const secondPrompt = setGenerationPromptModel(updatedNode.prompt!, 'minimax-h3-video');
    expect(secondPrompt).toContain('model: minimax-h3-video');
    expect(secondPrompt).not.toContain('nano-banana-image');

    await appClient.project.patchNode({
      id: 'node_prop_fishcan',
      patch: { prompt: secondPrompt },
    });

    const secondUpdated = graph.projection.read().project.nodes.node_prop_fishcan;
    expect(secondUpdated.prompt).toBe(secondPrompt);
    expect(snapshotStore.readState().project.nodes.node_prop_fishcan.prompt).toBe(secondPrompt);

    const secondItems = LaunchpadScheduler.buildLaunchpadItems(
      snapshotStore.readState().project.nodes,
      snapshotStore.readState().project.tree,
    );
    const secondLpFishcan = secondItems.find((item) => item.id === 'node_prop_fishcan');
    expect(secondLpFishcan?.modelId).toBe('minimax-h3-video');
    expect(secondLpFishcan?.hasHeader).toBe(true);
  });
});
