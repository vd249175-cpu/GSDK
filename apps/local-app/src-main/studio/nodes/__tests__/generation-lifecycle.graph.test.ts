import { describe, expect, it, vi } from 'vitest';
import {
  type Clock,
  type EffectAdapter,
  type EffectContext,
} from '@graphvideo/kernel';
import type {
  GenerationAdapterOperationObservation,
  GenerationAdapterOperationRequest,
} from '../../effects/generation-adapter-operation';
import { GenerationDownloadSinkNode } from '../generation-download';
import { GenerationPollSourceNode } from '../generation-poll';
import { GenerationSubmitSinkNode } from '../generation-submit';
import { GenerationTaskNode } from '../generation-task';
import type { GenerationBatchPlannedInfo } from '../../protocol';
import { createCausalRegionHarness, InfoCollectorNode } from '../../testing/graph';
import { SecurityGateNode } from '../generation-security';
import { SqliteRegistryNode } from '../sqlite-registry';
import { SqliteWriterSinkNode } from '../sqlite-writer';
import { SqliteObserverSourceNode } from '../sqlite-observer';

function fixtureWriter() {
  return new SqliteWriterSinkNode(undefined, undefined, {
    id: 'fixture/sqlite-lifecycle',
    async execute(request) {
      return { dbFilePath: request.dbFilePath, persistedRecordCount: request.records.length,
        byteLength: 10, contentRef: 'fixture:sqlite' };
    },
  });
}

class FixtureGenerationAdapter implements EffectAdapter<
  GenerationAdapterOperationRequest,
  GenerationAdapterOperationObservation
> {
  readonly id = 'fixture/generation-adapter';
  readonly calls: GenerationAdapterOperationRequest[] = [];
  pollStatus: 'pending' | 'ready' = 'ready';
  private remoteSequence = 0;

  async execute(
    request: GenerationAdapterOperationRequest,
    _context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    this.calls.push(request);
    if (request.operation === 'submit') {
      this.remoteSequence += 1;
      return {
        operation: 'submit',
        status: 'submitted',
        handle: {
          provider: request.spec.provider,
          taskId: `remote-${this.remoteSequence}`,
        },
      };
    }
    if (request.operation === 'poll') {
      if (this.pollStatus === 'pending') {
        return {
          operation: 'poll',
          status: 'pending',
          progress: 30,
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
          kind: request.handle.provider === 'audio' ? 'audio' : 'video',
          filename: `${request.handle.taskId}.bin`,
          url: `fixture://${request.handle.taskId}`,
        },
      };
    }
    return {
      operation: 'download',
      status: 'downloaded',
      bytesWritten: 100,
      destinationRelativePath: request.destinationRelativePath,
      contentType: request.artifact.kind === 'audio' ? 'audio/wav' : 'video/mp4',
    };
  }
}

class MutableClock implements Clock {
  value = 0;
  now() { return this.value; }
  monotonicNow() { return this.value; }
}

function plannedBatch(maxGenerationWaitMs?: number): GenerationBatchPlannedInfo {
  return {
    type: 'GenerationBatchPlannedInfo',
    batchId: 'batch-1',
    tasks: [
      {
        taskId: 'task-video-1',
        targetNodeId: 'node-video-1',
        destinationRelativePath: 'nodes/node-video-1/media/v1.mp4',
        versionId: 'v1',
        mediaType: 'video',
        estimatedCredits: 20,
        maxGenerationWaitMs,
        submit: { provider: 'comfy', prompt: { '1': { class_type: 'SaveVideo' } }, expectedOutputKind: 'video' },
      },
      {
        taskId: 'task-video-2',
        targetNodeId: 'node-video-2',
        destinationRelativePath: 'nodes/node-video-2/media/v1.mp4',
        versionId: 'v1',
        mediaType: 'video',
        estimatedCredits: 20,
        maxGenerationWaitMs,
        submit: { provider: 'comfy', prompt: { '1': { class_type: 'SaveVideo' } }, expectedOutputKind: 'video' },
      },
      {
        taskId: 'task-audio-1',
        targetNodeId: 'node-audio-1',
        destinationRelativePath: 'nodes/node-audio-1/media/v1.wav',
        versionId: 'v1',
        mediaType: 'audio',
        estimatedCredits: 0,
        maxGenerationWaitMs,
        submit: {
          provider: 'audio',
          taskType: 'SFX',
          projectId: 'fixture',
          payload: { prompt: 'fixture ambience' },
        },
      },
    ],
  };
}

async function mountedLifecycle(adapter: FixtureGenerationAdapter, clock?: Clock) {
  const task = new GenerationTaskNode();
  const registry = new SqliteRegistryNode();
  const region = createCausalRegionHarness([
    task,
    new SecurityGateNode(), registry, fixtureWriter(), new SqliteObserverSourceNode(),
    new InfoCollectorNode('n-hist'),
    new GenerationSubmitSinkNode(undefined, undefined, adapter),
    new GenerationPollSourceNode(undefined, undefined, adapter),
    new GenerationDownloadSinkNode(undefined, undefined, adapter),
  ], { clock });
  await region.inject(registry.id, { type: 'ProjectMetadataHydratedInfo', nodes: plannedBatch().tasks.map((item) => ({
    id: item.targetNodeId, type: item.mediaType, title: item.targetNodeId, description: '', history: [],
  })) });
  return { region, task };
}

describe('generation lifecycle Node chain', () => {
  it('publishes each downloaded version and failure without waiting for a slower sibling download', async () => {
    let finishSlowDownload!: () => void;
    const slowDownload = new Promise<void>((resolve) => { finishSlowDownload = resolve; });
    class StaggeredAdapter extends FixtureGenerationAdapter {
      override async execute(request: GenerationAdapterOperationRequest, context: EffectContext) {
        if (request.operation === 'download') {
          if (request.destinationRelativePath.includes('node-video-2')) await slowDownload;
          if (request.artifact.kind === 'audio') throw new Error('fixture download failed');
        }
        return super.execute(request, context);
      }
    }
    const adapter = new StaggeredAdapter();
    const task = new GenerationTaskNode();
    const registry = new SqliteRegistryNode();
    const writer = fixtureWriter();
    const region = createCausalRegionHarness([
      task, registry, writer, new SqliteObserverSourceNode(), new SecurityGateNode(),
      new InfoCollectorNode('n-hist', ['TaskFactObservedInfo']),
      new GenerationSubmitSinkNode(undefined, undefined, adapter),
      new GenerationPollSourceNode(undefined, undefined, adapter),
      new GenerationDownloadSinkNode(undefined, undefined, adapter),
    ]);
    const plan = plannedBatch();
    await region.inject(registry.id, {
      type: 'ProjectMetadataHydratedInfo',
      nodes: plan.tasks.map((item) => ({
        id: item.targetNodeId, type: item.mediaType, title: item.targetNodeId, description: '', history: [],
      })),
    });
    const running = region.inject(task.id, plan);
    try {
      await vi.waitFor(() => {
        expect(task.getState().tasks.get('task-video-1')?.phase).toBe('downloaded');
        expect(task.getState().tasks.get('task-audio-1')?.phase).toBe('failed');
        expect(registry.getRecord('node-video-1')?.history).toEqual([
          expect.objectContaining({ id: 'v1', current: true, relativePath: 'nodes/node-video-1/media/v1.mp4' }),
        ]);
        expect(region.deliveredInfos('PersistMetadataTaskInfo', writer.id)).toHaveLength(1);
      });
      expect(task.getState().tasks.get('task-video-2')?.phase).toBe('downloading');
      expect(registry.getRecord('node-video-2')?.history).toEqual([]);
    } finally {
      finishSlowDownload();
      await running;
      await region.dispose();
    }
  });
  it('stops after one pending status check and resumes only after a new poll intent', async () => {
    const adapter = new FixtureGenerationAdapter();
    adapter.pollStatus = 'pending';
    const { region, task } = await mountedLifecycle(adapter);

    await region.inject(task.id, plannedBatch());

    expect(adapter.calls.filter((request) => request.operation === 'poll')).toHaveLength(3);
    expect(adapter.calls.filter((request) => request.operation === 'download')).toHaveLength(0);
    expect([...task.getState().tasks.values()].every((record) => record.phase === 'waiting')).toBe(true);
    expect([...task.getState().tasks.values()].every((record) => record.maxGenerationWaitMs === 0)).toBe(true);

    adapter.pollStatus = 'ready';
    await region.inject(task.id, {
      type: 'GenerationTasksPollRequestedInfo',
      taskIds: ['task-video-1', 'task-video-2', 'task-audio-1'],
    });

    expect(adapter.calls.filter((request) => request.operation === 'poll')).toHaveLength(6);
    expect(adapter.calls.filter((request) => request.operation === 'download')).toHaveLength(3);
    expect([...task.getState().tasks.values()].every((record) => record.phase === 'downloaded')).toBe(true);
    await region.dispose();
  });

  it('fails waiting tasks at the configured deadline without issuing another physical poll', async () => {
    const adapter = new FixtureGenerationAdapter();
    adapter.pollStatus = 'pending';
    const clock = new MutableClock();
    const { region, task } = await mountedLifecycle(adapter, clock);

    await region.inject(task.id, plannedBatch(60_000));
    expect(adapter.calls.filter((request) => request.operation === 'poll')).toHaveLength(3);

    clock.value = 60_000;
    await region.inject(task.id, {
      type: 'GenerationTasksPollRequestedInfo',
      taskIds: ['task-video-1', 'task-video-2', 'task-audio-1'],
    });

    expect(adapter.calls.filter((request) => request.operation === 'poll')).toHaveLength(3);
    expect([...task.getState().tasks.values()].every((record) => (
      record.phase === 'failed' && record.error === '生成等待超过 1 分钟'
    ))).toBe(true);
    await region.dispose();
  });

  it('records cancellation as a terminal task fact', async () => {
    const adapter = new FixtureGenerationAdapter();
    adapter.pollStatus = 'pending';
    const { region, task } = await mountedLifecycle(adapter);

    await region.inject(task.id, plannedBatch());
    await region.inject(task.id, {
      type: 'GenerationBatchCancelRequestedInfo',
      batchId: 'batch-1',
      reason: 'test cancellation',
    });

    expect([...task.getState().tasks.values()].every((record) => (
      record.phase === 'canceled' && record.error === 'test cancellation'
    ))).toBe(true);
    await region.dispose();
  });
});
