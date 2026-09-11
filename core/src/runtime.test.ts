import { describe, it, expect } from 'vitest';
import { Node, WorldNode } from './node';
import { KernelRuntime } from './runtime';
import type { DomainChangeContext, WorldChangeContext, Info, ChangeRecord } from './types';
import type { EffectAdapter } from './effects';

interface TestCounterState {
  count: number;
}

class CounterNode extends Node<TestCounterState> {
  constructor(id: string = 'counter-1') {
    super(id, 'CounterNode', { count: 0 });
  }

  override async change(info: Info, ctx: DomainChangeContext<TestCounterState>) {
    if (info.type === 'IncrementInfo') {
      const current = ctx.read('count');
      const step = info.payload?.step ?? 1;
      ctx.write('count', current + step);
      return;
    }
    if (info.type === 'PingInfo') {
      ctx.send({ type: 'PongInfo', payload: { pingCount: ctx.read('count') } }, 'target-sink');
    }
  }
}

class SinkNode extends Node<{ received: any[] }> {
  constructor(id: string = 'target-sink') {
    super(id, 'SinkNode', { received: [] });
  }

  override change(info: Info, ctx: DomainChangeContext<{ received: any[] }>) {
    if (info.type === 'PongInfo') {
      const list = ctx.read('received');
      ctx.write('received', [...list, info.payload]);
    }
  }
}

class EffectWorldNode extends WorldNode<{ lastResult?: string }> {
  private readonly adapter: EffectAdapter<{ data: string }, string> = {
    id: 'fixture/test-effect',
    execute: async ({ data }) => `Effect executed: ${data}`,
  };

  constructor(id: string = 'effect-node') {
    super(id, 'EffectWorldNode', {});
  }

  override async change(info: Info, ctx: WorldChangeContext<{ lastResult?: string }>) {
    if (info.type === 'DoEffectInfo') {
      const result = await ctx.effectAdapter(this.adapter, { data: info.payload?.data });
      ctx.write('lastResult', result);
    }
  }
}

describe('In-Process KernelRuntime Contract', () => {
  it('rejects duplicate Node identities instead of silently skipping one', () => {
    const runtime = new KernelRuntime();
    runtime.mount(new CounterNode('duplicate-node'));

    expect(() => runtime.mount(new CounterNode('duplicate-node'))).toThrow(
      '不能挂载重复的 Node ID: duplicate-node',
    );
  });

  it('mounts nodes, delivers messages, and updates state deterministically', async () => {
    const runtime = new KernelRuntime();
    const counter = new CounterNode();
    const sink = new SinkNode();

    runtime.mount(counter, sink);
    expect(runtime.getNode('counter-1')).toBe(counter);
    expect(runtime.getNode('target-sink')).toBe(sink);

    runtime.injectRootInfo(counter, { type: 'IncrementInfo', payload: { step: 5 } });
    await runtime.waitForQuiescence();

    expect(counter.getState().count).toBe(5);

    runtime.injectRootInfo(counter, { type: 'PingInfo' });
    await runtime.waitForQuiescence();

    expect(sink.getState().received).toEqual([{ pingCount: 5 }]);
  });

  it('supports capturing and restoring state snapshots', async () => {
    const runtime = new KernelRuntime();
    const counter = new CounterNode();
    runtime.mount(counter);

    runtime.injectRootInfo(counter, { type: 'IncrementInfo', payload: { step: 10 } });
    await runtime.waitForQuiescence();
    expect(counter.getState().count).toBe(10);

    const snapshot = runtime.captureStateSnapshot('manual');
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.nodes[0].nodeId).toBe('counter-1');

    runtime.injectRootInfo(counter, { type: 'IncrementInfo', payload: { step: 5 } });
    await runtime.waitForQuiescence();
    expect(counter.getState().count).toBe(15);

    runtime.restoreStateSnapshot(snapshot);
    expect(counter.getState().count).toBe(10);
  });

  it('rejects duplicate submission identities instead of executing twice', async () => {
    const runtime = new KernelRuntime();
    const counter = new CounterNode();
    runtime.mount(counter);

    const first = await runtime.inject({
      submissionId: 'submission/duplicate',
      targetNodeId: counter.id,
      info: { type: 'IncrementInfo' },
    });
    expect(first.status).toBe('accepted');
    await runtime.waitForSubmission(first.submissionId);

    const duplicate = await runtime.inject({
      submissionId: 'submission/duplicate',
      targetNodeId: counter.id,
      info: { type: 'IncrementInfo' },
    });
    expect(duplicate).toMatchObject({
      status: 'rejected',
      submissionId: 'submission/duplicate',
    });
    expect(counter.getState().count).toBe(1);
  });

  it('executes WorldNode effects cleanly and commits observation to state', async () => {
    const runtime = new KernelRuntime();
    const worldNode = new EffectWorldNode();
    runtime.mount(worldNode);

    runtime.injectRootInfo(worldNode, { type: 'DoEffectInfo', payload: { data: 'hello-world' } });
    await runtime.waitForQuiescence();

    expect(worldNode.getState().lastResult).toBe('Effect executed: hello-world');
  });

  it('rejects effect calls on pure Domain nodes', async () => {
    class InvalidDomainNode extends Node<{}> {
      private readonly adapter: EffectAdapter<void, string> = {
        id: 'fixture/invalid-domain-effect',
        execute: async () => 'bad',
      };

      constructor() {
        super('invalid-domain', 'InvalidDomainNode', {});
      }

      override async change(info: Info, ctx: DomainChangeContext<{}>) {
        if (info.type === 'TryEffectInfo') {
          await (ctx as WorldChangeContext<{}>).effectAdapter(this.adapter, undefined);
        }
      }
    }

    const runtime = new KernelRuntime();
    const records: ChangeRecord[] = [];
    runtime.addProbe({ onChangeRecord: (r) => records.push(r) });
    const invalid = new InvalidDomainNode();
    runtime.mount(invalid);

    runtime.injectRootInfo(invalid, { type: 'TryEffectInfo' });
    await runtime.waitForQuiescence();
    expect(records[0].error).toMatch(/Side effects are strictly restricted to World nodes/);
  });
});
