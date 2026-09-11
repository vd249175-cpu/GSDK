import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';
import { loadGenerationCatalogSnapshot } from '../../../services/generation-catalog-snapshot.mjs';
import type {
  GenerationAdapterOperationObservation,
  GenerationAdapterOperationRequest,
} from '../../effects/generation-adapter-operation';
import type {
  GenerationPollDelayObservation,
  GenerationPollDelayRequest,
} from '../../effects/generation-poll-delay';
import type {
  SqlitePersistObservation,
  SqlitePersistRequest,
} from '../../effects/sqlite-metadata-adapter';
import type { GenerationBatchRequestedInfo } from '../../protocol';
import { createCausalRegionHarness } from '../../testing/graph';
import { GenerationDownloadSinkNode } from '../generation-download';
import { GenerationModelResolverNode } from '../generation-model-resolver';
import { GenerationPollSourceNode } from '../generation-poll';
import { GenerationPollSchedulerNode } from '../generation-poll-scheduler';
import { SecurityGateNode } from '../generation-security';
import { GenerationSubmitSinkNode } from '../generation-submit';
import { GenerationTaskNode, type GenerationTaskState } from '../generation-task';
import { HistoryManagerNode, type HistoryState } from '../history-manager';
import { SqliteObserverSourceNode } from '../sqlite-observer';
import { SqliteRegistryNode } from '../sqlite-registry';
import { SqliteWriterSinkNode } from '../sqlite-writer';

const fixtureMp4 = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x00, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x6d, 0x70, 0x34, 0x32,
]);

class CompleteFlowGenerationAdapter implements EffectAdapter<
  GenerationAdapterOperationRequest,
  GenerationAdapterOperationObservation
> {
  readonly id = 'fixture/complete-flow-generation';
  readonly calls: GenerationAdapterOperationRequest[] = [];
  private pollCount = 0;

  constructor(private readonly projectRoot: string) {}

  async execute(
    request: GenerationAdapterOperationRequest,
    _context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    this.calls.push(request);
    if (request.operation === 'submit') {
      return {
        operation: 'submit',
        status: 'submitted',
        handle: { provider: request.spec.provider, taskId: 'remote-video-1' },
      };
    }
    if (request.operation === 'poll') {
      this.pollCount += 1;
      if (this.pollCount === 1) {
        return {
          operation: 'poll',
          status: 'pending',
          progress: 45,
          remoteStatus: 'running',
        };
      }
      return {
        operation: 'poll',
        status: 'ready',
        progress: 100,
        artifact: {
          provider: request.handle.provider,
          taskId: request.handle.taskId,
          kind: 'video',
          filename: 'video/seedance-result.mp4',
          token: 'asset-video-1',
        },
      };
    }

    const destination = resolve(this.projectRoot, request.destinationRelativePath);
    if (!destination.startsWith(resolve(this.projectRoot))) {
      throw new Error('fixture download escaped its project root');
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, fixtureMp4);
    return {
      operation: 'download',
      status: 'downloaded',
      bytesWritten: fixtureMp4.byteLength,
      destinationRelativePath: request.destinationRelativePath,
      contentType: 'video/mp4',
    };
  }
}

class ImmediatePollDelay implements EffectAdapter<
  GenerationPollDelayRequest,
  GenerationPollDelayObservation
> {
  readonly id = 'fixture/immediate-poll-delay';

  async execute(request: GenerationPollDelayRequest) {
    return { elapsed: true as const, taskIds: request.taskIds };
  }
}

class RecordingSqliteAdapter implements EffectAdapter<
  SqlitePersistRequest,
  SqlitePersistObservation
> {
  readonly id = 'fixture/recording-sqlite';
  readonly requests: SqlitePersistRequest[] = [];

  async execute(request: SqlitePersistRequest) {
    this.requests.push(request);
    return {
      dbFilePath: request.dbFilePath,
      persistedRecordCount: request.records.length,
      byteLength: JSON.stringify(request.records).length,
      contentRef: 'fixture:sqlite:latest',
    };
  }
}

describe('complete generated video causal flow', () => {
  it('downloads the video, replaces the current asset version, persists it, and journals the change', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'graphvideo-generation-flow-'));
    const generationAdapter = new CompleteFlowGenerationAdapter(projectRoot);
    const sqliteAdapter = new RecordingSqliteAdapter();
    const resolver = new GenerationModelResolverNode();
    const task = new GenerationTaskNode();
    const security = new SecurityGateNode();
    const registry = new SqliteRegistryNode();
    const history = new HistoryManagerNode();
    const region = createCausalRegionHarness([
      resolver,
      task,
      new GenerationSubmitSinkNode(undefined, undefined, generationAdapter),
      new GenerationPollSourceNode(undefined, undefined, generationAdapter),
      new GenerationPollSchedulerNode(undefined, undefined, new ImmediatePollDelay()),
      new GenerationDownloadSinkNode(undefined, undefined, generationAdapter),
      security,
      registry,
      new SqliteWriterSinkNode(undefined, undefined, sqliteAdapter),
      new SqliteObserverSourceNode(),
      history,
    ]);

    const referenceVersion = {
      id: 'reference-v1',
      label: 'reference.png',
      relativePath: 'nodes/image-reference/media/reference-v1.png',
      mimeType: 'image/png',
      createdAt: '2026-08-30T00:00:00.000Z',
      source: 'imported' as const,
      current: true,
    };
    const oldVideoVersion = {
      id: 'video-old',
      label: 'old.mp4',
      relativePath: 'nodes/video-target/media/video-old.mp4',
      mimeType: 'video/mp4',
      createdAt: '2026-08-29T00:00:00.000Z',
      source: 'generated' as const,
      current: true,
    };
    const projectNodes = [
      {
        id: 'image-reference',
        type: 'image' as const,
        title: '参考图',
        description: '',
        prompt: '',
        history: [referenceVersion],
      },
      {
        id: 'video-target',
        type: 'video' as const,
        title: '生成镜头',
        description: '',
        prompt: [
          '---',
          'model: seedance-video',
          'duration: 4',
          'resolution: 480p',
          'generateAudio: false',
          '---',
          '让 [@参考图] 中的红球缓慢向前滚动。',
        ].join('\n'),
        history: [oldVideoVersion],
      },
    ];

    try {
      await region.inject(registry.id, {
        type: 'ProjectMetadataHydratedInfo',
        observedAt: 1,
        nodes: projectNodes,
      });

      const catalog = (await loadGenerationCatalogSnapshot(
        fileURLToPath(new URL('../../../../resources/generation-models', import.meta.url)),
      )).select(['seedance-video']);
      const request: GenerationBatchRequestedInfo = {
        type: 'GenerationBatchRequestedInfo',
        batchId: 'complete-video-flow',
        project: {
          name: 'Complete flow fixture',
          path: projectRoot,
          markdown: [
            '<project-structure>',
            '@参考图',
            '%生成镜头',
            '  @参考图',
            '</project-structure>',
          ].join('\n'),
          nodes: projectNodes,
        },
        items: [{ nodeId: 'video-target' }],
        catalog,
        maxGenerationWaitMs: 5 * 60_000,
      };

      await region.inject(resolver.id, request, 'complete-flow-submission');

      const submit = generationAdapter.calls.find((call) => call.operation === 'submit');
      expect(submit?.operation === 'submit' ? submit.spec : null).toMatchObject({
        provider: 'comfy',
        expectedOutputKind: 'video',
      });
      expect(submit?.operation === 'submit' && submit.spec.provider === 'comfy' ? submit.spec.uploads : []).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourcePath: expect.stringContaining('reference-v1.png') }),
      ]));
      expect(generationAdapter.calls.map((call) => call.operation)).toEqual([
        'submit', 'poll', 'poll', 'download',
      ]);

      const [taskRecord] = [...region.state<GenerationTaskState>(task.id).tasks.values()];
      expect(taskRecord).toMatchObject({
        targetNodeId: 'video-target',
        phase: 'downloaded',
        progress: 100,
        maxGenerationWaitMs: 5 * 60_000,
      });
      const downloaded = await readFile(resolve(projectRoot, taskRecord.destinationRelativePath));
      expect(downloaded).toEqual(fixtureMp4);

      const video = registry.getState().table.get('video-target');
      const currentVersions = video?.history?.filter((version) => version.current) ?? [];
      expect(video).toMatchObject({
        mediaUrl: taskRecord.destinationRelativePath,
        activeVersionId: taskRecord.versionId,
      });
      expect(video?.history?.map((version) => ({ id: version.id, current: version.current }))).toEqual([
        { id: 'video-old', current: false },
        { id: taskRecord.versionId, current: true },
      ]);
      expect(currentVersions).toHaveLength(1);
      expect(registry.getState().inSync).toBe(true);

      const persistedVideo = sqliteAdapter.requests.at(-1)?.records.find(
        (record) => record.id === 'video-target',
      );
      expect(persistedVideo).toMatchObject({
        mediaUrl: taskRecord.destinationRelativePath,
        activeVersionId: taskRecord.versionId,
        history: expect.arrayContaining([
          expect.objectContaining({ id: taskRecord.versionId, current: true }),
        ]),
      });
      expect(region.state<HistoryState>(history.id).past).toHaveLength(1);
      expect(security.getState().lastVerifiedArtifact).toMatchObject({
        id: taskRecord.versionId,
        kind: 'video',
        url: taskRecord.destinationRelativePath,
      });
      expect(region.deliveredInfos('ArtifactSavedObservedInfo', registry.id)).toHaveLength(1);
      expect(region.deliveredInfos('DatabaseSavedObservedInfo', registry.id)).toHaveLength(1);
    } finally {
      await region.dispose();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
