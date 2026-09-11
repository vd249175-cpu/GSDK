import { describe, expect, it } from 'vitest';
import { ExecutionWorldNode, Node } from './index';
import type { DomainChangeContext, EffectAdapter, Info, WorldChangeContext } from '@graphvideo/kernel';
import {
  locateNativeBinding,
  mountDomainNode,
  NativeRuleSpace,
  replaceDomainNode,
} from './index';

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

  it('runs an ExecutionWorldNode effect and feeds it the submission abort signal', async () => {
    const space = new NativeRuleSpace();
    let effectSignal: AbortSignal | undefined;
    const adapter: EffectAdapter<{ value: number }, { value: number }> = {
      id: 'native-test-effect',
      async execute(request, context) {
        effectSignal = context.signal;
        return { value: request.value + 1 };
      },
    };
    class EffectNode extends ExecutionWorldNode<{ value: number }> {
      constructor() {
        super('effect-node', 'EffectNode', { value: 0 });
      }
      protected override async change(
        info: Info,
        ctx: WorldChangeContext<{ value: number }>,
      ): Promise<void> {
        if (info.type !== 'RunInfo') return;
        const observed = await ctx.effectAdapter(adapter, { value: Number(info.value) });
        ctx.write('value', observed.value);
      }
    }
    mountDomainNode(space, new EffectNode());
    await space.waitForSubmission(
      space.injectRoot('effect-node', { type: 'RunInfo', value: 4 }, 'sub/effect'),
    );
    expect(effectSignal).toBeInstanceOf(AbortSignal);
    expect(space.getState('effect-node')).toEqual({ value: 5 });
  });

  it('aborts a running WorldNode adapter and keeps its State unchanged', async () => {
    const space = new NativeRuleSpace();
    let entered = false;
    const adapter: EffectAdapter<void, number> = {
      id: 'native-cancellable-effect',
      execute(_request, context) {
        entered = true;
        return new Promise<number>((_resolve, reject) => {
          context.signal?.addEventListener('abort', () => reject(context.signal?.reason), {
            once: true,
          });
        });
      },
    };
    class CancellableNode extends ExecutionWorldNode<{ value: number }> {
      constructor() {
        super('cancellable-node', 'CancellableNode', { value: 0 });
      }
      protected override async change(
        info: Info,
        ctx: WorldChangeContext<{ value: number }>,
      ): Promise<void> {
        if (info.type !== 'RunInfo') return;
        ctx.write('value', await ctx.effectAdapter(adapter, undefined));
      }
    }
    mountDomainNode(space, new CancellableNode());
    const submission = space.injectRoot('cancellable-node', { type: 'RunInfo' }, 'sub/cancel');
    const pumping = space.pump();
    while (!entered) await Promise.resolve();
    expect(space.cancel(submission)).toBe(true);
    await pumping;
    expect(space.getState('cancellable-node')).toEqual({ value: 0 });
    await expect(space.waitForSubmission(submission)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('runs Node lifecycle cleanup across replace and space disposal', async () => {
    const events: string[] = [];
    class LifecycleProbe extends Node<Record<string, never>> {
      constructor(id: string, private readonly label: string) {
        super(id, label, {});
        this.registerDisposer(() => events.push(`dispose:${this.label}`));
      }
      override onMount(): void {
        events.push(`mount:${this.label}`);
      }
      override onUnmount(): void {
        events.push(`unmount:${this.label}`);
      }
    }
    const space = new NativeRuleSpace();
    mountDomainNode(space, new LifecycleProbe('lifecycle-probe', 'v1'));
    await replaceDomainNode(space, new LifecycleProbe('lifecycle-probe', 'v2'));
    await space.dispose();
    expect(events).toEqual([
      'mount:v1',
      'mount:v2',
      'dispose:v1',
      'unmount:v1',
      'dispose:v2',
      'unmount:v2',
    ]);
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
