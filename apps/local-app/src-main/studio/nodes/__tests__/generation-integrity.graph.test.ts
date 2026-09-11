import { describe, expect, it, vi } from 'vitest';
import type { EffectAdapter } from '@graphvideo/kernel';
import type { GenerationAdapterOperationRequest, GenerationAdapterOperationObservation } from '../../effects/generation-adapter-operation';
import type { SqlitePersistRequest, SqlitePersistObservation } from '../../effects/sqlite-metadata-adapter';
import type { GenerationBatchPlannedInfo } from '../../protocol';
import { createCausalRegionHarness, InfoCollectorNode } from '../../testing/graph';
import { GenerationTaskNode } from '../generation-task';
import { SecurityGateNode } from '../generation-security';
import { GenerationSubmitSinkNode } from '../generation-submit';
import { GenerationPollSourceNode } from '../generation-poll';
import { GenerationDownloadSinkNode } from '../generation-download';
import { SqliteRegistryNode } from '../sqlite-registry';
import { SqliteWriterSinkNode } from '../sqlite-writer';
import { SqliteObserverSourceNode } from '../sqlite-observer';
import { applicationStateFromGraphProjection } from '../../../../renderer/src/studio/application/graph/application-state-projection';
import { completedGenerationBatchFromState } from '../../../../renderer/src/studio/application/host/generationBatchCompletion';

function plan(id: string, targetNodeId = 'video'): GenerationBatchPlannedInfo {
  return { type: 'GenerationBatchPlannedInfo', batchId: id, tasks: [{
    taskId: id, targetNodeId, versionId: id, mediaType: 'video', estimatedCredits: 20,
    destinationRelativePath: `nodes/${targetNodeId}/media/${id}.mp4`,
    submit: { provider: 'mock', kind: 'video' },
  }] };
}

async function setup(write?: () => Promise<void>) {
  const calls: GenerationAdapterOperationRequest[] = [];
  const adapter: EffectAdapter<GenerationAdapterOperationRequest, GenerationAdapterOperationObservation> = {
    id: 'fixture/generation-integrity',
    async execute(request) {
      calls.push(request);
      if (request.operation === 'submit') return {
        operation: 'submit', status: 'submitted', handle: { provider: 'mock', taskId: 'remote' },
      };
      if (request.operation === 'poll') return {
        operation: 'poll', status: 'ready', progress: 100,
        artifact: { provider: 'mock', taskId: 'remote', kind: 'video', filename: 'video.mp4' },
      };
      return { operation: 'download', status: 'downloaded', bytesWritten: 10,
        destinationRelativePath: request.destinationRelativePath, contentType: 'video/mp4' };
    },
  };
  const sqlite: EffectAdapter<SqlitePersistRequest, SqlitePersistObservation> = {
    id: 'fixture/sqlite-integrity',
    async execute(request) {
      await write?.();
      return { dbFilePath: request.dbFilePath, persistedRecordCount: request.records.length,
        byteLength: 10, contentRef: 'fixture:sqlite' };
    },
  };
  const task = new GenerationTaskNode();
  const gate = new SecurityGateNode();
  const registry = new SqliteRegistryNode();
  const region = createCausalRegionHarness([
    task, gate, registry, new InfoCollectorNode('n-hist'),
    new GenerationSubmitSinkNode(undefined, undefined, adapter),
    new GenerationPollSourceNode(undefined, undefined, adapter),
    new GenerationDownloadSinkNode(undefined, undefined, adapter),
    new SqliteWriterSinkNode(undefined, undefined, sqlite), new SqliteObserverSourceNode(),
  ]);
  await region.inject(registry.id, { type: 'ProjectMetadataHydratedInfo', nodes: [
    { id: 'video', type: 'video', title: 'Video', description: '', history: [] },
  ] });
  return { task, gate, registry, region, calls };
}

describe('generation task integrity', () => {
  it('waits for its own durable metadata acknowledgement and rejects duplicate targets before charging', async () => {
    let finish!: () => void;
    const write = new Promise<void>((resolve) => { finish = resolve; });
    const { task, gate, region, calls } = await setup(() => write);
    const running = region.inject(task.id, plan('first'));
    try {
      await vi.waitFor(() => expect(task.getState().tasks.get('first')?.phase).toBe('persisting'));
      await region.inject(gate.id, plan('second'));
      expect(task.status).toBe('ERROR');
      expect(task.lastErrorMessage).toMatch(/仍在执行/);
      expect(gate.getState().spentCredits).toBe(20);
      expect(calls.filter((call) => call.operation === 'submit')).toHaveLength(1);
      expect(task.getState().tasks.has('second')).toBe(false);
      finish();
      await running;
      expect(task.getState().tasks.get('first')?.phase).toBe('downloaded');
    } finally { finish(); await running; await region.dispose(); }
  });

  it('reports failed SQLite writes as task failures even though the bytes were downloaded', async () => {
    const { task, registry, region } = await setup(async () => { throw new Error('FIXTURE_DISK_FULL'); });
    try {
      await region.inject(task.id, plan('failed-write'));
      expect(registry.getState().inSync).toBe(false);
      expect(task.getState().tasks.get('failed-write')).toMatchObject({ phase: 'failed', error: 'FIXTURE_DISK_FULL' });
      expect(() => completedGenerationBatchFromState({
        batchId: 'failed-write', requests: [{ nodeId: 'video' }],
        state: applicationStateFromGraphProjection(region.runtime.readProjection()),
      })).toThrow(/FIXTURE_DISK_FULL/);
      await region.inject(task.id, { type: 'DatabaseSavedObservedInfo', taskId: 'failed-write' });
      expect(task.getState().tasks.get('failed-write')?.phase).toBe('failed');
    } finally { await region.dispose(); }
  });

  it('rejects duplicate targets within a batch atomically and permits a retry after failure', async () => {
    const { task, gate, region, calls } = await setup(async () => { throw new Error('write failed'); });
    try {
      await region.inject(task.id, { ...plan('a'), tasks: [...plan('a').tasks, ...plan('b').tasks] });
      expect(task.status).toBe('ERROR');
      expect(task.lastErrorMessage).toMatch(/重复|仍在执行/);
      expect(task.getState().tasks.size).toBe(0);
      expect(gate.getState().spentCredits).toBe(0);
      expect(calls).toHaveLength(0);
      await region.inject(task.id, plan('a'));
      await region.inject(task.id, plan('b'));
      expect(calls.filter((call) => call.operation === 'submit')).toHaveLength(2);
    } finally { await region.dispose(); }
  });

  it('fails a downloaded task when its target metadata no longer exists', async () => {
    const { task, region } = await setup();
    try {
      await region.inject(task.id, plan('missing-task', 'missing'));
      expect(task.getState().tasks.get('missing-task')).toMatchObject({ phase: 'failed' });
    } finally { await region.dispose(); }
  });

  it('does not revive canceled tasks with late submit, poll, download or persistence observations', async () => {
    let finish!: () => void;
    const write = new Promise<void>((resolve) => { finish = resolve; });
    const { task, region, calls } = await setup(() => write);
    const running = region.inject(task.id, plan('cancel'));
    try {
      await vi.waitFor(() => expect(task.getState().tasks.get('cancel')?.phase).toBe('persisting'));
      await region.inject(task.id, { type: 'GenerationBatchCancelRequestedInfo', batchId: 'cancel' });
      const before = calls.length;
      await region.inject(task.id, { type: 'GenerationBatchSubmittedObservedInfo', batchId: 'cancel',
        results: [{ taskId: 'cancel', ok: true, handle: { provider: 'mock', taskId: 'remote' } }] });
      await region.inject(task.id, { type: 'GenerationBatchPolledObservedInfo', batchId: 'cancel',
        results: [{ taskId: 'cancel', ok: true, status: 'pending', progress: 20 }] });
      await region.inject(task.id, { type: 'GenerationBatchDownloadedObservedInfo', batchId: 'cancel',
        results: [{ taskId: 'cancel', ok: false, error: 'late failure' }] });
      finish();
      await running;
      expect(task.getState().tasks.get('cancel')?.phase).toBe('canceled');
      expect(calls).toHaveLength(before);
    } finally { finish(); await running; await region.dispose(); }
  });
});
