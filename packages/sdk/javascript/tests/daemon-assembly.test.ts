import { describe, expect, it } from 'vitest';
import { Node } from '../src/node/node';
import { describeDaemonNode } from '../src/node/daemon-node';
import type { DaemonChangeOperation, DaemonPolledChange } from '../src/agent/daemon-client';
import type { DaemonNodeWorkerClient } from '../src/node/daemon-node';
import { runDaemonNodeAssembly } from '../src/node/daemon-node';

class CounterNode extends Node<{ count: number }> {
  constructor(id = 'example.counter') {
    super(id, 'Counter', { count: 0 });
  }

  protected override change(
    info: { readonly type: string; readonly [key: string]: unknown },
    ctx: {
      read(key: string): unknown;
      write(key: string, value: unknown): void;
      send(child: { readonly type: string; readonly [key: string]: unknown }, target: string): void;
    },
  ): void {
    if (info.type !== 'IncrementInfo') return;
    const count = Number(ctx.read('count')) + 1;
    ctx.write('count', count);
    ctx.send({ type: 'CountChangedInfo', count }, 'example.observer');
  }
}

class FixtureAssemblyClient implements DaemonNodeWorkerClient {
  admitted: Array<{ nodeId: string; initialState: Record<string, unknown> }> = [];
  evicted: string[] = [];
  claimed: readonly string[] = [];
  released: readonly string[] = [];
  commits: Array<{ changeId: number; operations: readonly DaemonChangeOperation[]; error?: string }> = [];
  failAdmit: string | null = null;
  constructor(
    private readonly changes: DaemonPolledChange[],
    private readonly stop: AbortController,
  ) {}

  async admit(nodeId: string, initialState: Record<string, unknown>): Promise<unknown> {
    if (this.failAdmit === nodeId) throw new Error(`admit rejected: ${nodeId}`);
    this.admitted.push({ nodeId, initialState });
    return { generation: 0 };
  }

  async evict(nodeId: string): Promise<unknown> {
    this.evicted.push(nodeId);
    return { evicted: true };
  }

  async claim(nodeIds: readonly string[]): Promise<unknown> {
    for (const nodeId of nodeIds) {
      if (!this.admitted.some((entry) => entry.nodeId === nodeId)) {
        throw new Error(`claim before admit: ${nodeId}`);
      }
    }
    this.claimed = nodeIds;
    return { claimed: nodeIds };
  }

  async release(nodeIds: readonly string[]): Promise<unknown> {
    this.released = nodeIds;
    return { released: nodeIds };
  }

  async poll(): Promise<DaemonPolledChange | null> {
    return this.changes.shift() ?? null;
  }

  async requestEffect(): Promise<{ effectId: number }> {
    throw new Error('no fixture EffectAdapter');
  }

  async awaitEffect(): Promise<{ ok: boolean; value: unknown } | null> {
    return null;
  }

  async commit(changeId: number, operations: readonly DaemonChangeOperation[], error?: string): Promise<unknown> {
    this.commits.push({ changeId, operations, error });
    this.stop.abort();
    return { settled: true };
  }
}

describe('daemon real-Node assembly', () => {
  it('reuses the real change body and seeds admit from construction-time State', async () => {
    const node = new CounterNode();
    const assembly = describeDaemonNode(node);
    expect(assembly.nodeId).toBe('example.counter');
    expect(assembly.initialState).toEqual({ count: 0 });
    const operations: DaemonChangeOperation[] = [];
    const seen: unknown[] = [];
    await assembly.handler({ type: 'IncrementInfo' }, {
      read: (key) => ({ count: 4 })[String(key)],
      write: (key, value) => { operations.push({ op: 'write', key: String(key), value }); },
      patchState: (patch) => { operations.push({ op: 'patchState', patch }); },
      send: (info, targetNodeId) => { operations.push({ op: 'send', info, targetNodeId }); },
      effect: async () => { throw new Error('unexpected effect'); },
    });
    expect(operations).toEqual([
      { op: 'write', key: 'count', value: 5 },
      { op: 'send', targetNodeId: 'example.observer', info: { type: 'CountChangedInfo', count: 5 } },
    ]);
    expect(node.getState()).toEqual({ count: 0 });
    expect(seen).toEqual([]);
  });

  it('admits before claiming and evicts plus disposes after the run', async () => {
    const stop = new AbortController();
    const client = new FixtureAssemblyClient([{
      change: {
        changeId: 3, infoId: 1, nodeId: 'example.counter', generation: 0,
        sender: 'external-root', info: { type: 'IncrementInfo' }, submissionId: 's/1',
      },
      state: { count: 1 },
    }], stop);
    const node = new CounterNode();
    let disposed = 0;
    const original = node.dispose.bind(node);
    node.dispose = async () => { disposed += 1; await original(); };
    await runDaemonNodeAssembly(client, [node], { signal: stop.signal, longPollMs: 1 });
    expect(client.admitted).toEqual([{ nodeId: 'example.counter', initialState: { count: 0 } }]);
    expect(client.claimed).toEqual(['example.counter']);
    expect(client.commits).toEqual([{
      changeId: 3,
      operations: [
        { op: 'write', key: 'count', value: 2 },
        { op: 'send', targetNodeId: 'example.observer', info: { type: 'CountChangedInfo', count: 2 } },
      ],
      error: undefined,
    }]);
    expect(client.evicted).toEqual(['example.counter']);
    expect(client.released).toEqual(['example.counter']);
    expect(disposed).toBe(1);
  });

  it('cleans the admitted prefix when a later admit fails', async () => {
    const stop = new AbortController();
    const client = new FixtureAssemblyClient([], stop);
    client.failAdmit = 'example.second';
    const first = new CounterNode();
    const second = new CounterNode();
    (second as { id: string }).id;
    Object.defineProperty(second, 'id', { value: 'example.second' });
    await expect(runDaemonNodeAssembly(client, [first, second], {
      signal: stop.signal, longPollMs: 1,
    })).rejects.toThrow('admit rejected: example.second');
    expect(client.admitted.map((entry) => entry.nodeId)).toEqual(['example.counter']);
    expect(client.evicted).toEqual(['example.counter']);
    expect(client.claimed).toEqual([]);
  });
});
