import { describe, expect, it, vi } from 'vitest';
import { locateNativeBinding, NativeRuleSpace } from './native-space';
import type { NativeChangeContext, NativeInfo } from './native-space';

const binary = locateNativeBinding();

describe.skipIf(!binary)('Native rule space (JS entities on Rust scheduling)', () => {
  it('runs a JS fan-out chain through Rust dispatch', async () => {
    const space = new NativeRuleSpace();
    space.register('source', {}, (_info, ctx) => {
      ctx.send({ type: 'WorkInfo', value: 41 }, 'worker');
    });
    space.register<{ total: number }>('worker', { total: 0 }, (info, ctx) => {
      const total = (ctx.read('total') as number) + Number(info.value);
      ctx.write('total', total);
      ctx.send({ type: 'DoneInfo', total }, 'sink');
    });
    const seen: unknown[] = [];
    space.register('sink', {}, (info) => {
      seen.push(info.total);
    });
    const submission = space.injectRoot('source', { type: 'StartInfo' });
    await space.waitForSubmission(submission);
    expect(space.getState('worker')).toEqual({ total: 41 });
    expect(seen).toEqual([41]);
    expect(space.pendingTotal()).toBe(0);
  });

  it('uses an injected id provider and publishes encoded projections', async () => {
    let sequence = 0;
    const space = new NativeRuleSpace({
      idProvider: { nextId: () => `submission/${++sequence}` },
    });
    space.register<{ count: number }>('counter', { count: 0 }, (_info, ctx) => {
      ctx.write('count', ctx.read('count') + 1);
    });
    const revisions: number[] = [];
    const unsubscribe = space.subscribeProjection((projection) => {
      revisions.push(projection.revision);
    });
    const submission = space.injectRoot('counter', { type: 'IncrementInfo' });
    expect(submission).toBe('submission/1');
    await space.waitForSubmission(submission);
    const projection = space.readProjection();
    const counter = projection.nodes.find((node) => node.nodeId === 'counter');
    expect(counter?.version).toBe(1);
    expect(space.valueCodec.decode(counter?.state as never)).toEqual({ count: 1 });
    expect(projection.scheduler.pendingDeliveries).toBe(0);
    expect(projection.scheduler.activeChanges).toBe(0);
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    unsubscribe();
  });

  it('reports dropped for missing targets and settles', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const space = new NativeRuleSpace();
    let feedback: unknown = null;
    space.register('source', {}, (_info, ctx) => {
      feedback = ctx.send({ type: 'PingInfo' }, 'ghost');
    });
    const submission = space.injectRoot('source', { type: 'GoInfo' });
    await space.waitForSubmission(submission);
    expect(feedback).toMatchObject({ status: 'dropped' });
    expect(space.drops()).toContainEqual(
      expect.objectContaining({ target: 'ghost', submission }),
    );
    warning.mockRestore();
  });

  it('isolates JS failures as causal facts without stopping siblings', async () => {
    const space = new NativeRuleSpace({ errorTargetNodeId: 'supervisor' });
    const errors: NativeInfo[] = [];
    space.register('supervisor', {}, (info) => {
      if (info.type === '@error/NodeFailed') errors.push(info);
    });
    space.register('fanout', {}, (_info, ctx) => {
      ctx.send({ type: 'WorkInfo' }, 'failer');
      ctx.send({ type: 'WorkInfo' }, 'sibling');
    });
    space.register('failer', {}, (info) => {
      if (info.type === 'WorkInfo') throw new Error('native boom');
    });
    space.register<{ done: boolean }>('sibling', { done: false }, (info, ctx) => {
      if (info.type === 'WorkInfo') ctx.write('done', true);
    });
    await space.waitForSubmission(space.injectRoot('fanout', { type: 'StartInfo' }));
    expect(space.getState('sibling')).toEqual({ done: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: '@error/NodeFailed',
      nodeId: 'failer',
      message: 'native boom',
    });
    expect(space.submissionState(errors[0].submission as string)).toBe('completed');
  });

  it('cuts error recursion after a single hop when the error target also fails', async () => {
    const space = new NativeRuleSpace({ errorTargetNodeId: 'failer-b' });
    let runsB = 0;
    space.register('failer-a', {}, (info) => {
      if (info.type === 'WorkInfo') throw new Error('boom-a');
    });
    space.register('failer-b', {}, () => {
      runsB++;
      throw new Error('boom-b');
    });
    await space.waitForSubmission(space.injectRoot('failer-a', { type: 'WorkInfo' }));
    expect(runsB).toBe(1);
    expect(space.pendingTotal()).toBe(0);
  });

  it('skips cancelled submissions without running handlers', async () => {
    const space = new NativeRuleSpace();
    let runs = 0;
    space.register('worker', {}, () => {
      runs++;
    });
    const submission = space.injectRoot('worker', { type: 'WorkInfo' });
    expect(space.cancel(submission)).toBe(true);
    await expect(space.waitForSubmission(submission)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(runs).toBe(0);
  });

  it('settles async handlers across awaits and replaces entities cleanly', async () => {
    const space = new NativeRuleSpace();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    space.register<{ processed: string[] }>('worker', { processed: [] }, (async (
      info: NativeInfo,
      ctx: NativeChangeContext<{ processed: string[] }>,
    ) => {
      if (info.value === 'first') await gate;
      ctx.write('processed', [...ctx.read('processed'), String(info.value)]);
    }) as (info: NativeInfo, ctx: NativeChangeContext<any>) => Promise<void>);
    const first = space.injectRoot('worker', { type: 'WorkInfo', value: 'first' });
    const pumping = space.pump();
    await Promise.resolve();
    release();
    await pumping;
    await space.waitForSubmission(first);
    expect(space.getState('worker')).toEqual({ processed: ['first'] });
    const generation = await space.replace('worker', { processed: [] }, (info, ctx) => {
      ctx.write('processed', [...(ctx.read('processed') as string[]), `v2:${String(info.value)}`]);
    });
    expect(generation).toBe(1);
    await space.waitForSubmission(space.injectRoot('worker', { type: 'WorkInfo', value: 'x' }));
    expect(space.getState('worker')).toEqual({ processed: ['v2:x'] });
  });

  it('accepts replace while a JS change is active, seals backlog, and swaps at the gap', async () => {
    const space = new NativeRuleSpace();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    let entered = false;
    space.register<{ processed: string[] }>('worker', { processed: [] }, async (info, ctx) => {
      entered = true;
      await gate;
      ctx.write('processed', [...ctx.read('processed'), `v1:${String(info.value)}`]);
    });
    const first = space.injectRoot('worker', { type: 'WorkInfo', value: 'first' }, 'sub/first');
    const pumping = space.pump();
    while (!entered) await Promise.resolve();
    const stale = space.injectRoot('worker', { type: 'WorkInfo', value: 'stale' }, 'sub/stale');
    const replacing = space.replace('worker', { processed: [] }, (info, ctx) => {
      ctx.write('processed', [...ctx.read('processed'), `v2:${String(info.value)}`]);
    });
    const sealed = space.injectRoot('worker', { type: 'WorkInfo', value: 'sealed' }, 'sub/sealed');
    release();
    await pumping;
    await expect(replacing).resolves.toBe(1);
    await Promise.all([
      space.waitForSubmission(first),
      space.waitForSubmission(stale),
      space.waitForSubmission(sealed),
    ]);
    expect(space.getState('worker')).toEqual({ processed: [] });
    expect(space.drops()).toEqual(expect.arrayContaining([
      expect.objectContaining({ submission: 'sub/stale', reason: 'evicted' }),
      expect.objectContaining({ submission: 'sub/sealed', reason: 'sealed-target' }),
    ]));
    await space.waitForSubmission(
      space.injectRoot('worker', { type: 'WorkInfo', value: 'fresh' }, 'sub/fresh'),
    );
    expect(space.getState('worker')).toEqual({ processed: ['v2:fresh'] });
  });
  it('drops the backlog on replace and starts the new handler clean', async () => {
    const space = new NativeRuleSpace();
    const seen: unknown[] = [];
    space.register('worker', {}, (info) => {
      seen.push(info.value);
    });
    const stale = space.injectRoot('worker', { type: 'WorkInfo', value: 'stale' });
    const generation = await space.replace('worker', {}, (info) => {
      seen.push(`v2:${String(info.value)}`);
    });
    expect(generation).toBe(1);
    await space.waitForSubmission(stale);
    expect(seen).toEqual([]);
    await space.waitForSubmission(space.injectRoot('worker', { type: 'WorkInfo', value: 'fresh' }));
    expect(seen).toEqual(['v2:fresh']);
    expect(space.pendingTotal()).toBe(0);
  });

  it('rejects replace on missing entities without touching the space', async () => {
    const space = new NativeRuleSpace();
    space.register('worker', { n: 1 }, () => {});
    await expect(space.replace('ghost', {}, () => {})).rejects.toThrow('Cannot replace missing entity');
    expect(space.generation('worker')).toBe(0);
    expect(space.getState('worker')).toEqual({ n: 1 });
  });

  it('settles an unregistered mid-flight change normally, never on the new entity', async () => {
    const space = new NativeRuleSpace();
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    space.register<{ processed: string[] }>('worker', { processed: [] }, (async (
      info: NativeInfo,
      ctx: NativeChangeContext<{ processed: string[] }>,
    ) => {
      entered = true;
      await gate;
      ctx.write('processed', [...ctx.read('processed'), String(info.value)]);
    }) as (info: NativeInfo, ctx: NativeChangeContext<any>) => Promise<void>);
    const first = space.injectRoot('worker', { type: 'WorkInfo', value: 'first' });
    const pumping = space.pump();
    while (!entered) {
      await Promise.resolve();
    }
    expect(space.unregister('worker')).toBe(true);
    space.register('worker', { processed: [] }, (info, ctx) => {
      ctx.write('processed', [...(ctx.read('processed') as string[]), String(info.value)]);
    });
    expect(space.generation('worker')).toBe(1);
    release();
    await pumping;
    // Tombstone parity: the evicted in-flight change settles normally, while
    // its stale context cannot read or write the newly admitted entity.
    await space.waitForSubmission(first);
    expect(space.getState('worker')).toEqual({ processed: [] });
    await space.waitForSubmission(space.injectRoot('worker', { type: 'WorkInfo', value: 'second' }));
    expect(space.getState('worker')).toEqual({ processed: ['second'] });
    expect(space.pendingTotal()).toBe(0);
  });

  it('invalidates an in-flight native context after cancel', async () => {
    const space = new NativeRuleSpace();
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    space.register<{ done: boolean }>('worker', { done: false }, (async (
      _info: NativeInfo,
      ctx: NativeChangeContext<{ done: boolean }>,
    ) => {
      entered = true;
      await gate;
      ctx.write('done', true);
    }) as (info: NativeInfo, ctx: NativeChangeContext<any>) => Promise<void>);
    const submission = space.injectRoot('worker', { type: 'WorkInfo' });
    const pumping = space.pump();
    while (!entered) {
      await Promise.resolve();
    }
    expect(space.cancel(submission)).toBe(true);
    release();
    await pumping;
    expect(space.getState('worker')).toEqual({ done: false });
    await expect(space.waitForSubmission(submission)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
