import { describe, expect, it } from 'vitest';
import { Node } from './index';
import type { DomainChangeContext, Info } from '@graphvideo/kernel';
import { locateNativeBinding, mountDomainNode, NativeRuleSpace } from './index';

const binary = locateNativeBinding();

class ProbeNode extends Node<{ count: number }> {
  public feedback: unknown = null;

  constructor() {
    super('probe-source', 'ProbeSource', { count: 0 });
  }

  protected override change(info: Info, ctx: DomainChangeContext<{ count: number }>): void {
    if (info.type !== 'GoInfo') return;
    ctx.patchState({ count: ctx.read('count') + 1 });
    this.feedback = ctx.send({ type: 'PingInfo' }, 'probe-sink');
  }
}

class SinkNode extends Node<{ seen: number[] }> {
  constructor() {
    super('probe-sink', 'ProbeSink', { seen: [] });
  }
  protected override change(info: Info, ctx: DomainChangeContext<{ seen: number[] }>): void {
    if (info.type !== 'PingInfo') return;
    ctx.write('seen', [...ctx.read('seen'), 1]);
  }
}

describe.skipIf(!binary)('Native domain-node bridge', () => {
  it('runs unmodified Node logic on Rust scheduling with live state', async () => {
    const space = new NativeRuleSpace();
    const source = new ProbeNode();
    mountDomainNode(space, source);
    mountDomainNode(space, new SinkNode());
    await space.waitForSubmission(space.injectRoot('probe-source', { type: 'GoInfo' }));
    expect(space.getState('probe-source')).toEqual({ count: 1 });
    expect(space.getState('probe-sink')).toEqual({ seen: [1] });
    expect(source.feedback).toMatchObject({ status: 'enqueued' });
    expect(space.pendingTotal()).toBe(0);
  });

  it('refuses WorldNodes without an effect host', () => {
    const space = new NativeRuleSpace();
    const world = new SinkNode();
    (world as unknown as { isWorldNode: boolean }).isWorldNode = true;
    expect(() => mountDomainNode(space, world)).toThrow('WorldNodes cannot mount');
  });

  it('treats Start/Stop as ordinary FIFO Infos with no membership change', async () => {
    class LifecycleNode extends Node<{ running: boolean; log: string[] }> {
      constructor() {
        super('lifecycle-node', 'LifecycleNode', { running: false, log: [] });
      }

      protected override change(
        info: Info,
        ctx: DomainChangeContext<{ running: boolean; log: string[] }>,
      ): void {
        if (info.type === '@lifecycle/StartRequested') {
          ctx.write('running', true);
          ctx.write('log', [...ctx.read('log'), 'start']);
          return;
        }
        if (info.type === '@lifecycle/StopRequested') {
          ctx.write('running', false);
          ctx.write('log', [...ctx.read('log'), 'stop']);
          return;
        }
        if (info.type !== 'WorkInfo') return;
        ctx.write('log', [
          ...ctx.read('log'),
          ctx.read('running') ? `work:${String((info as { value?: unknown }).value)}` : 'refused',
        ]);
      }
    }
    const space = new NativeRuleSpace();
    mountDomainNode(space, new LifecycleNode());
    const run = (info: Record<string, unknown>) =>
      space.waitForSubmission(space.injectRoot('lifecycle-node', { type: 'x', ...info }));
    await run({ type: 'WorkInfo', value: 'early' });
    await run({ type: '@lifecycle/StartRequested' });
    await run({ type: 'WorkInfo', value: 'one' });
    await run({ type: '@lifecycle/StopRequested' });
    await run({ type: 'WorkInfo', value: 'late' });
    expect(space.getState('lifecycle-node')).toEqual({
      running: false,
      log: ['refused', 'start', 'work:one', 'stop', 'refused'],
    });
    expect(space.generation('lifecycle-node')).toBe(0);
  });

  it('propagates lifecycle control through chained sends with no membership change', async () => {
    class LifecycleNode extends Node<{ running: boolean; log: string[] }> {
      constructor() {
        super('lifecycle-node', 'LifecycleNode', { running: false, log: [] });
      }

      protected override change(
        info: Info,
        ctx: DomainChangeContext<{ running: boolean; log: string[] }>,
      ): void {
        if (info.type === '@lifecycle/StartRequested') {
          ctx.write('running', true);
          ctx.write('log', [...ctx.read('log'), 'start']);
          return;
        }
        if (info.type !== 'WorkInfo') return;
        ctx.write('log', [
          ...ctx.read('log'),
          ctx.read('running') ? `work:${String((info as { value?: unknown }).value)}` : 'refused',
        ]);
      }
    }
    class RelayNode extends Node<Record<string, never>> {
      constructor() {
        super('relay', 'Relay', {});
      }

      protected override change(info: Info, ctx: DomainChangeContext<Record<string, never>>): void {
        if (info.type !== 'GoInfo') return;
        ctx.send({ type: '@lifecycle/StartRequested' }, 'lifecycle-node');
        ctx.send({ type: 'WorkInfo', value: 'one' }, 'lifecycle-node');
      }
    }
    const space = new NativeRuleSpace();
    mountDomainNode(space, new LifecycleNode());
    mountDomainNode(space, new RelayNode());
    await space.waitForSubmission(space.injectRoot('relay', { type: 'GoInfo' }));
    expect(space.getState('lifecycle-node')).toEqual({ running: true, log: ['start', 'work:one'] });
    expect(space.generation('lifecycle-node')).toBe(0);
  });
});
