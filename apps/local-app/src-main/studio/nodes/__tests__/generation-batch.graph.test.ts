import { describe, expect, it } from 'vitest';
import {
  type EffectAdapter,
  type EffectContext,
} from '@graphvideo/kernel';
import type {
  GenerationAdapterOperationObservation,
  GenerationAdapterOperationRequest,
} from '../../effects/generation-adapter-operation';
import type {
  GenerationPollDelayObservation,
  GenerationPollDelayRequest,
} from '../../effects/generation-poll-delay';
import { GenerationDownloadSinkNode } from '../generation-download';
import { GenerationModelResolverNode } from '../generation-model-resolver';
import { GenerationPollSourceNode } from '../generation-poll';
import { GenerationPollSchedulerNode } from '../generation-poll-scheduler';
import { GenerationSubmitSinkNode } from '../generation-submit';
import { GenerationTaskNode } from '../generation-task';
import { SecurityGateNode } from '../generation-security';
import { SqliteRegistryNode } from '../sqlite-registry';
import { SqliteWriterSinkNode } from '../sqlite-writer';
import { SqliteObserverSourceNode } from '../sqlite-observer';
import type { GenerationTaskState } from '../generation-task';
import type { GenerationBatchRequestedInfo } from '../../protocol';
import { createCausalRegionHarness, InfoCollectorNode } from '../../testing/graph';
import { loadGenerationCatalogSnapshot } from '../../../services/generation-catalog-snapshot.mjs';
import { fileURLToPath } from 'node:url';

class BatchAdapter implements EffectAdapter<GenerationAdapterOperationRequest, GenerationAdapterOperationObservation> {
  readonly id = 'fixture/batch-adapter';
  readonly calls: GenerationAdapterOperationRequest[] = [];
  readonly pollCounts = new Map<string, number>();
  activeSubmits = 0;
  maxActiveSubmits = 0;
  submitSequence = 0;

  async execute(request: GenerationAdapterOperationRequest, _context: EffectContext): Promise<GenerationAdapterOperationObservation> {
    this.calls.push(request);
    if (request.operation === 'submit') {
      this.submitSequence += 1;
      const taskId = `remote-${this.submitSequence}`;
      this.activeSubmits += 1;
      this.maxActiveSubmits = Math.max(this.maxActiveSubmits, this.activeSubmits);
      await new Promise((resolve) => setTimeout(resolve, 5));
      this.activeSubmits -= 1;
      return { operation: 'submit', status: 'submitted', handle: { provider: request.spec.provider, taskId } };
    }
    if (request.operation === 'poll') {
      const count = (this.pollCounts.get(request.handle.taskId) ?? 0) + 1;
      this.pollCounts.set(request.handle.taskId, count);
      if (count === 1) return { operation: 'poll', status: 'pending', progress: 30, remoteStatus: 'running' };
      return { operation: 'poll', status: 'ready', progress: 100, artifact: { provider: request.handle.provider, taskId: request.handle.taskId, kind: 'audio', filename: `${request.handle.taskId}.wav`, token: request.handle.taskId } };
    }
    return { operation: 'download', status: 'downloaded', bytesWritten: 10, destinationRelativePath: request.destinationRelativePath, contentType: 'audio/wav' };
  }
}

class ImmediateDelay implements EffectAdapter<GenerationPollDelayRequest, GenerationPollDelayObservation> {
  readonly id = 'fixture/immediate-delay';
  async execute(request: GenerationPollDelayRequest) {
    return { elapsed: true as const, taskIds: request.taskIds };
  }
}

describe('one snapshot generation batch', () => {
  it('compiles once, submits three tasks in parallel, and delegates later polls to another Node', async () => {
    const catalogStore = await loadGenerationCatalogSnapshot(fileURLToPath(new URL('../../../resources/generation-models', import.meta.url)));
    const adapter = new BatchAdapter();
    const resolver = new GenerationModelResolverNode();
    const task = new GenerationTaskNode();
    const gate = new SecurityGateNode();
    const saved = new SqliteRegistryNode();
    const region = createCausalRegionHarness([
      resolver,
      gate,
      task,
      new GenerationSubmitSinkNode(undefined, undefined, adapter),
      new GenerationPollSourceNode(undefined, undefined, adapter),
      new GenerationPollSchedulerNode(undefined, undefined, new ImmediateDelay()),
      new GenerationDownloadSinkNode(undefined, undefined, adapter),
      saved,
      new InfoCollectorNode('n-hist'),
      new SqliteObserverSourceNode(),
      new SqliteWriterSinkNode(undefined, undefined, {
        id: 'fixture/sqlite-batch',
        async execute(request) {
          return { dbFilePath: request.dbFilePath, persistedRecordCount: request.records.length,
            byteLength: 10, contentRef: 'fixture:sqlite' };
        },
      }),
    ]);
    const info: GenerationBatchRequestedInfo = {
      type: 'GenerationBatchRequestedInfo',
      batchId: 'batch-one-snapshot',
      project: {
        name: 'Fixture',
        path: 'C:/fixture',
        markdown: '<project-structure>\n~Audio A\n~Audio B\n~Audio C\n</project-structure>',
        nodes: ['a', 'b', 'c'].map((id) => ({
          id: `audio-${id}`,
          type: 'audio' as const,
          title: `Audio ${id.toUpperCase()}`,
          description: '',
          prompt: `---\nmodel: audio-sfx\n---\nSound ${id}`,
        })),
      },
      items: ['a', 'b', 'c'].map((id) => ({ nodeId: `audio-${id}` })),
      catalog: catalogStore.select(['audio-sfx']),
      maxGenerationWaitMs: 30 * 60_000,
    };
    expect(structuredClone(info.catalog)).toEqual(info.catalog);
    await region.inject(saved.id, { type: 'ProjectMetadataHydratedInfo', nodes: info.project.nodes });
    await region.inject(resolver.id, info);
    expect(adapter.maxActiveSubmits).toBe(3);
    expect(adapter.calls.filter((request) => request.operation === 'submit')).toHaveLength(3);
    expect(adapter.calls.filter((request) => request.operation === 'poll')).toHaveLength(6);
    expect(adapter.calls.filter((request) => request.operation === 'download')).toHaveLength(3);
    expect([...region.state<GenerationTaskState>(task.id).tasks.values()].every((record) => record.phase === 'downloaded')).toBe(true);
    expect([...region.state<GenerationTaskState>(task.id).tasks.values()].every((record) => (
      record.maxGenerationWaitMs === 30 * 60_000
    ))).toBe(true);
    expect(region.deliveredInfos('ArtifactSavedObservedInfo', saved.id)).toHaveLength(3);
    expect(gate.getState().spentCredits).toBeGreaterThanOrEqual(0);
    expect(region.events('ChangeStarted').length).toBeGreaterThan(10);
    await region.dispose();
  });
});
