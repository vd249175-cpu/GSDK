import { describe, expect, it } from 'vitest';
import type { DaemonChangeOperation, DaemonPolledChange } from './daemon-client';
import type { DaemonNodeWorkerClient } from './daemon-node';
import { runDaemonNodeWorker } from './daemon-node';

class FixtureClient implements DaemonNodeWorkerClient {
  claimed: readonly string[] = [];
  released: readonly string[] = [];
  commits: Array<{ changeId: number; operations: readonly DaemonChangeOperation[]; error?: string }> = [];
  constructor(
    private readonly changes: DaemonPolledChange[],
    private readonly stop: AbortController,
  ) {}
  async claim(nodeIds: readonly string[]) { this.claimed = nodeIds; }
  async release(nodeIds: readonly string[]) { this.released = nodeIds; }
  async poll() { return this.changes.shift() ?? null; }
  async requestEffect() { throw new Error('no fixture EffectAdapter'); }
  async awaitEffect() { return null; }
  async commit(changeId: number, operations: readonly DaemonChangeOperation[], error?: string) {
    this.commits.push({ changeId, operations, error });
    this.stop.abort();
  }
}

describe('runDaemonNodeWorker', () => {
  it('executes reads locally and commits ordered writes and sends as one batch', async () => {
    const stop = new AbortController();
    const client = new FixtureClient([{
      change: {
        changeId: 9, infoId: 4, nodeId: 'counter', generation: 0,
        sender: 'external-root', info: { type: 'IncrementInfo' }, submissionId: 's1',
      },
      state: { count: 2 },
    }], stop);
    await runDaemonNodeWorker(client, {
      signal: stop.signal,
      handlers: {
        counter(info, ctx) {
          expect(info.type).toBe('IncrementInfo');
          const count = ctx.read('count') as number + 1;
          ctx.write('count', count);
          ctx.send({ type: 'CountChangedInfo', count }, 'observer');
        },
      },
    });
    expect(client.claimed).toEqual(['counter']);
    expect(client.commits).toEqual([{
      changeId: 9,
      operations: [
        { op: 'write', key: 'count', value: 3 },
        { op: 'send', targetNodeId: 'observer', info: { type: 'CountChangedInfo', count: 3 } },
      ],
      error: undefined,
    }]);
    expect(client.released).toEqual(['counter']);
  });

  it('commits a thrown error as a causal failure instead of breaking the worker boundary', async () => {
    const stop = new AbortController();
    const client = new FixtureClient([{
      change: {
        changeId: 5, infoId: 3, nodeId: 'broken', generation: 0,
        sender: 'external-root', info: { type: 'RunInfo' }, submissionId: 's2',
      },
      state: {},
    }], stop);
    await runDaemonNodeWorker(client, {
      signal: stop.signal,
      handlers: { broken() { throw new Error('worker failed'); } },
    });
    expect(client.commits).toEqual([{ changeId: 5, operations: [], error: 'worker failed' }]);
  });
});
