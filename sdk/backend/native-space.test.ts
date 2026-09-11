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

  it('reports dropped for missing targets and settles', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const space = new NativeRuleSpace();
    let feedback: unknown = null;
    space.register('source', {}, (_info, ctx) => {
      feedback = ctx.send({ type: 'PingInfo' }, 'ghost');
    });
    await space.waitForSubmission(space.injectRoot('source', { type: 'GoInfo' }));
    expect(feedback).toMatchObject({ status: 'dropped' });
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
});
