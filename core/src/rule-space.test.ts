import { describe, expect, it, vi } from 'vitest';
import { Node, WorldNode } from './node';
import { KernelRuntime } from './runtime';
import type {
  ChangeRecord,
  DeliveryFeedback,
  DomainChangeContext,
  Info,
  NodeErrorInfo,
  WorldChangeContext,
} from './types';
import type { EffectAdapter } from './effects';

class ProbeSource extends Node<{ feedback: DeliveryFeedback | null }> {
  constructor(private readonly targetId: string) {
    super('probe-source', 'ProbeSource', { feedback: null });
  }

  protected override change(info: Info, ctx: DomainChangeContext<{ feedback: DeliveryFeedback | null }>): void {
    if (info.type !== 'GoInfo') return;
    const feedback = ctx.send({ type: 'PingInfo' }, this.targetId);
    ctx.write('feedback', feedback);
  }
}

class Sink extends Node<{ received: string[] }> {
  constructor(id = 'sink') {
    super(id, 'Sink', { received: [] });
  }

  protected override change(info: Info, ctx: DomainChangeContext<{ received: string[] }>): void {
    ctx.write('received', [...ctx.read('received'), info.type]);
  }
}

class Failer extends Node<Record<string, never>> {
  constructor(id = 'failer') {
    super(id, 'Failer', {});
  }

  protected override change(info: Info): void {
    if (info.type === 'WorkInfo' || info.type === '@error/NodeFailed') {
      throw new Error('boom');
    }
  }
}

class Sibling extends Node<{ done: boolean }> {
  constructor() {
    super('sibling', 'Sibling', { done: false });
  }

  protected override change(info: Info, ctx: DomainChangeContext<{ done: boolean }>): void {
    if (info.type === 'WorkInfo') ctx.write('done', true);
  }
}

class FanOut extends Node<Record<string, never>> {
  constructor() {
    super('fanout', 'FanOut', {});
  }

  protected override change(info: Info, ctx: DomainChangeContext<Record<string, never>>): void {
    if (info.type !== 'StartInfo') return;
    ctx.send({ type: 'WorkInfo' }, 'failer');
    ctx.send({ type: 'WorkInfo' }, 'sibling');
  }
}

class Supervisor extends Node<{ errors: NodeErrorInfo[] }> {
  constructor() {
    super('supervisor', 'Supervisor', { errors: [] });
  }

  protected override change(info: Info, ctx: DomainChangeContext<{ errors: NodeErrorInfo[] }>): void {
    if (info.type !== '@error/NodeFailed') return;
    ctx.write('errors', [...ctx.read('errors'), info as NodeErrorInfo]);
  }
}

class GatedWorker extends Node<{ processed: string[] }> {
  constructor(
    id: string,
    private readonly gate: Promise<void>,
    private readonly isGatedValue: (value: unknown) => boolean,
  ) {
    super(id, 'GatedWorker', { processed: [] });
  }

  protected override async change(
    info: Info,
    ctx: DomainChangeContext<{ processed: string[] }>,
  ): Promise<void> {
    if (info.type === 'WorkInfo' && this.isGatedValue(info.value)) await this.gate;
    ctx.write('processed', [...ctx.read('processed'), String(info.value)]);
  }
}

describe('RuleSpace delivery feedback and error-as-Info', () => {
  it('reports dropped for a missing target and still settles the submission', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kernel = new KernelRuntime();
    const source = new ProbeSource('ghost-node');
    kernel.mount(source);
    const submissionId = kernel.injectRootInfo(source, { type: 'GoInfo' });
    await kernel.waitForSubmission(submissionId);
    expect(source.getState().feedback).toMatchObject({ status: 'dropped' });
    expect(kernel.events.some((event) => event.type === 'InfoDropped')).toBe(true);
    await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
    warning.mockRestore();
    await kernel.dispose();
  });

  it('completes the submission on business failure instead of cancelling it', async () => {
    const kernel = new KernelRuntime();
    kernel.mount(new Failer('failer'));
    const submissionId = kernel.injectRootInfo('failer', { type: 'WorkInfo' });
    await expect(kernel.waitForSubmission(submissionId)).resolves.toBeUndefined();
    expect(kernel.getSchedulerSnapshot().isQuiescent).toBe(true);
    await kernel.dispose();
  });

  it('drops root injects addressed to a stale instance', async () => {
    const kernel = new KernelRuntime();
    const old = new Sink('solo');
    kernel.mount(old);
    kernel.evict('solo');
    const submissionId = kernel.injectRootInfo(old, { type: 'WorkInfo' });
    await kernel.waitForSubmission(submissionId);
    expect(old.getState().received).toEqual([]);
    expect(
      kernel.events.some(
        (event) => event.type === 'InfoDropped' && event.nodeId === 'solo',
      ),
    ).toBe(true);
    await kernel.dispose();
  });

  it('isolates a business failure: siblings continue and the submission completes', async () => {
    const kernel = new KernelRuntime({ errorTargetNodeId: 'supervisor' });
    const records: ChangeRecord[] = [];
    kernel.addProbe({ onChangeRecord: (record) => records.push(record) });
    const supervisor = new Supervisor();
    kernel.mount(new FanOut(), new Failer(), new Sibling(), supervisor);
    await kernel.waitForSubmission(kernel.injectRootInfo('fanout', { type: 'StartInfo' }));
    expect(kernel.getNode<Sibling>('sibling')?.getState().done).toBe(true);
    expect(records.find((record) => record.nodeId === 'failer')?.error).toBe('boom');
    expect(records.find((record) => record.nodeId === 'sibling')?.error).toBeUndefined();
    expect(supervisor.getState().errors).toHaveLength(1);
    expect(supervisor.getState().errors[0]).toMatchObject({
      type: '@error/NodeFailed',
      nodeId: 'failer',
      message: 'boom',
    });
    await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
    await kernel.dispose();
  });

  it('terminates automatic error recursion when the error target also fails', async () => {
    const kernel = new KernelRuntime({ errorTargetNodeId: 'failer-b' });
    const records: ChangeRecord[] = [];
    kernel.addProbe({ onChangeRecord: (record) => records.push(record) });
    kernel.mount(new Failer('failer-a'), new Failer('failer-b'));
    await kernel.waitForSubmission(kernel.injectRootInfo('failer-a', { type: 'WorkInfo' }));
    const failures = records.filter((record) => record.error === 'boom');
    expect(failures).toHaveLength(2);
    await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
    await kernel.dispose();
  });

  it('routes an async rejection to the error target and completes the submission', async () => {
    class AsyncFailer extends Node<Record<string, never>> {
      constructor() {
        super('async-failer', 'AsyncFailer', {});
      }

      protected override async change(info: Info): Promise<void> {
        if (info.type !== 'WorkInfo') return;
        await Promise.resolve();
        throw new Error('async boom');
      }
    }
    const kernel = new KernelRuntime({ errorTargetNodeId: 'supervisor' });
    const supervisor = new Supervisor();
    kernel.mount(new AsyncFailer(), supervisor);
    await expect(
      kernel.waitForSubmission(kernel.injectRootInfo('async-failer', { type: 'WorkInfo' })),
    ).resolves.toBeUndefined();
    expect(supervisor.getState().errors).toMatchObject([
      { type: '@error/NodeFailed', nodeId: 'async-failer', message: 'async boom' },
    ]);
    await kernel.dispose();
  });

  it('settles the submission when the error target is missing', async () => {
    const kernel = new KernelRuntime({ errorTargetNodeId: 'ghost-supervisor' });
    kernel.mount(new Failer('failer'));
    await expect(
      kernel.waitForSubmission(kernel.injectRootInfo('failer', { type: 'WorkInfo' })),
    ).resolves.toBeUndefined();
    await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
    await kernel.dispose();
  });
});

describe('RuleSpace admit / evict / replace', () => {
  it('evicts an entity, drops its sends, and re-admits with a new generation', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kernel = new KernelRuntime();
    let unmounts = 0;
    const ephemeral = new Sink('ephemeral');
    const originalUnmount = ephemeral.onUnmount.bind(ephemeral);
    ephemeral.onUnmount = () => {
      unmounts++;
      originalUnmount();
    };
    kernel.admit(ephemeral, new ProbeSource('ephemeral'));
    expect(kernel.getGeneration('ephemeral')).toBe(0);
    expect(kernel.evict('ephemeral')).toBe(true);
    expect(unmounts).toBe(1);
    expect(kernel.evict('ephemeral')).toBe(false);
    const submissionId = kernel.injectRootInfo('probe-source', { type: 'GoInfo' });
    await kernel.waitForSubmission(submissionId);
    expect(kernel.getNode<ProbeSource>('probe-source')?.getState().feedback).toMatchObject({
      status: 'dropped',
    });
    kernel.admit(new Sink('ephemeral'));
    expect(kernel.getGeneration('ephemeral')).toBe(1);
    const secondId = kernel.injectRootInfo('probe-source', { type: 'GoInfo' });
    await kernel.waitForSubmission(secondId);
    expect(kernel.getNode<Sink>('ephemeral')?.getState().received).toEqual(['PingInfo']);
    warning.mockRestore();
    await kernel.dispose();
  });

  it('replaces a node in the single-flight gap, discards backlog, and keeps revision monotonic', async () => {
    const kernel = new KernelRuntime();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const oldWorker = new GatedWorker('worker', gate, (value) => value === 'first');
    kernel.mount(oldWorker);
    const revisionBefore = kernel.readProjection().revision;
    const first = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'first' });
    while (!oldWorker.getActiveChangeId()) {
      await Promise.resolve();
    }
    const second = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'second' });
    const third = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'third' });
    const replacement = new GatedWorker('worker', Promise.resolve(), () => false);
    const replacing = kernel.replace(replacement);
    const sealedInject = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'late' });
    release();
    await kernel.waitForSubmission(first);
    await expect(replacing).resolves.toBeUndefined();
    await kernel.waitForSubmission(second);
    await kernel.waitForSubmission(third);
    await kernel.waitForSubmission(sealedInject);
    expect(kernel.getGeneration('worker')).toBe(1);
    expect(kernel.getNode('worker')).toBe(replacement);
    expect(replacement.getState().processed).not.toContain('second');
    expect(replacement.getState().processed).not.toContain('third');
    const fourth = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'fourth' });
    await kernel.waitForSubmission(fourth);
    expect(replacement.getState().processed).toEqual(['fourth']);
    expect(kernel.readProjection().revision).toBeGreaterThan(revisionBefore);
    await kernel.dispose();
  });

  it('keeps the old instance when replace targets a missing id or itself', async () => {
    const kernel = new KernelRuntime();
    const worker = new Sink('solo');
    kernel.mount(worker);
    await expect(kernel.replace(new Sink('ghost'))).rejects.toThrow('Cannot replace missing node');
    await expect(kernel.replace(worker)).rejects.toThrow('itself');
    expect(kernel.getNode('solo')).toBe(worker);
    await kernel.dispose();
  });

  it('retains the old instance when the replacement is bound to another runtime', async () => {
    const other = new KernelRuntime();
    const foreign = new Sink('worker');
    other.mount(foreign);
    const kernel = new KernelRuntime();
    const oldWorker = new Sink('worker');
    kernel.mount(oldWorker);
    await expect(kernel.replace(foreign)).rejects.toThrow('其他 Runtime');
    expect(kernel.getNode('worker')).toBe(oldWorker);
    expect(other.getNode('worker')).toBe(foreign);
    await kernel.dispose();
    await other.dispose();
  });

  it('retains the old instance when the replacement onMount throws', async () => {
    class BrokenMount extends Sink {
      override onMount(): void {
        throw new Error('mount boom');
      }
    }
    const kernel = new KernelRuntime();
    const worker = new Sink('worker');
    kernel.mount(worker);
    await expect(kernel.replace(new BrokenMount('worker'))).rejects.toThrow('mount boom');
    expect(kernel.getNode('worker')).toBe(worker);
    expect(kernel.getGeneration('worker')).toBe(0);
    const submission = kernel.injectRootInfo(worker, { type: 'PingInfo' });
    await kernel.waitForSubmission(submission);
    expect(kernel.readState('worker')).toEqual({ received: ['PingInfo'] });
    await kernel.dispose();
  });

  it('keeps the in-flight result on the old instance across replace', async () => {
    const kernel = new KernelRuntime();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const oldWorker = new GatedWorker('worker', gate, (value) => value === 'first');
    kernel.mount(oldWorker);
    const first = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'first' });
    while (!oldWorker.getActiveChangeId()) {
      await Promise.resolve();
    }
    const replacing = kernel.replace(new GatedWorker('worker', Promise.resolve(), () => false));
    release();
    await replacing;
    await kernel.waitForSubmission(first);
    expect(oldWorker.getState().processed).toEqual(['first']);
    const fresh = kernel.getNode('worker');
    expect(fresh).not.toBe(oldWorker);
    expect(kernel.getGeneration('worker')).toBe(1);
    const second = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'second' });
    await kernel.waitForSubmission(second);
    expect(kernel.readState('worker')).toEqual({ processed: ['second'] });
    expect(oldWorker.getState().processed).toEqual(['first']);
    await kernel.dispose();
  });
});

describe('RuleSpace replace timeout and seal feedback', () => {
  it('retains the old instance when replace times out waiting for idle', async () => {
    const kernel = new KernelRuntime();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const oldWorker = new GatedWorker('worker', gate, () => true);
    kernel.mount(oldWorker);
    const first = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'first' });
    while (!oldWorker.getActiveChangeId()) {
      await Promise.resolve();
    }
    await expect(kernel.replace(new Sink('worker'), { timeoutMs: 10 })).rejects.toThrow(
      'timed out',
    );
    expect(kernel.getNode('worker')).toBe(oldWorker);
    release();
    await kernel.waitForSubmission(first);
    const second = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'second' });
    await kernel.waitForSubmission(second);
    expect(oldWorker.getState().processed).toEqual(['first', 'second']);
    await kernel.dispose();
  });

  it('reports dropped for sends issued while the target is sealed for replace', async () => {
    const kernel = new KernelRuntime();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const oldWorker = new GatedWorker('worker', gate, (value) => value === 'first');
    const source = new ProbeSource('worker');
    kernel.mount(oldWorker, source);
    const first = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'first' });
    while (!oldWorker.getActiveChangeId()) {
      await Promise.resolve();
    }
    const replacing = kernel.replace(new GatedWorker('worker', Promise.resolve(), () => false));
    const probe = kernel.injectRootInfo('probe-source', { type: 'GoInfo' });
    await kernel.waitForSubmission(probe);
    expect(source.getState().feedback).toMatchObject({ status: 'dropped' });
    release();
    await kernel.waitForSubmission(first);
    await replacing;
    expect(
      kernel.events.some(
        (event) => event.type === 'InfoDropped' && event.nodeId === 'worker',
      ),
    ).toBe(true);
    await kernel.dispose();
  });
});

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
      ctx.read('running') ? `work:${String(info.value)}` : 'refused',
    ]);
  }
}

describe('RuleSpace lifecycle Info and late-result isolation', () => {
  it('treats Start/Stop as ordinary FIFO Infos with node-side refuse and no membership change', async () => {
    const kernel = new KernelRuntime();
    const node = new LifecycleNode();
    kernel.mount(node);
    const now = Date.now();
    await kernel.waitForSubmission(
      kernel.injectRootInfo('lifecycle-node', { type: 'WorkInfo', value: 'early' }),
    );
    await kernel.waitForSubmission(
      kernel.injectRootInfo('lifecycle-node', { type: '@lifecycle/StartRequested', timestamp: now }),
    );
    await kernel.waitForSubmission(
      kernel.injectRootInfo('lifecycle-node', { type: 'WorkInfo', value: 'one' }),
    );
    await kernel.waitForSubmission(
      kernel.injectRootInfo('lifecycle-node', { type: '@lifecycle/StopRequested', reason: 'test' }),
    );
    await kernel.waitForSubmission(
      kernel.injectRootInfo('lifecycle-node', { type: 'WorkInfo', value: 'late' }),
    );
    expect(node.getState()).toEqual({
      running: false,
      log: ['refused', 'start', 'work:one', 'stop', 'refused'],
    });
    expect(kernel.getNode('lifecycle-node')).toBe(node);
    await kernel.dispose();
  });

  it('keeps late results of an evicted entity off the re-admitted instance', async () => {
    const kernel = new KernelRuntime();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const oldWorker = new GatedWorker('worker', gate, (value) => value === 'first');
    kernel.mount(oldWorker);
    const first = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'first' });
    while (!oldWorker.getActiveChangeId()) {
      await Promise.resolve();
    }
    expect(kernel.evict('worker')).toBe(true);
    const fresh = new GatedWorker('worker', Promise.resolve(), () => false);
    kernel.admit(fresh);
    expect(kernel.getGeneration('worker')).toBe(1);
    release();
    await kernel.waitForSubmission(first);
    expect(oldWorker.getState().processed).toEqual(['first']);
    expect(fresh.getState().processed).toEqual([]);
    const second = kernel.injectRootInfo('worker', { type: 'WorkInfo', value: 'second' });
    await kernel.waitForSubmission(second);
    expect(fresh.getState().processed).toEqual(['second']);
    expect(oldWorker.getState().processed).toEqual(['first']);
    await kernel.dispose();
  });

  it('routes a late EffectAdapter result to the detached instance, never the re-admitted one', async () => {
    let resolveAdapter!: (value: { ok: true }) => void;
    const adapter: EffectAdapter<{}, { ok: true }> = {
      id: 'fixture/late-world',
      execute: async () => new Promise<{ ok: true }>((resolve) => {
        resolveAdapter = resolve;
      }),
    };
    class LateWorld extends WorldNode<{ observed: string[] }> {
      constructor(id: string) {
        super(id, 'LateWorld', { observed: [] });
      }

      protected override async change(
        info: Info,
        ctx: WorldChangeContext<{ observed: string[] }>,
      ): Promise<void> {
        if (info.type !== 'WorkInfo') return;
        await ctx.effectAdapter(adapter, {});
        ctx.write('observed', [...ctx.read('observed'), String(info.value)]);
      }
    }
    const kernel = new KernelRuntime();
    const oldWorld = new LateWorld('world');
    kernel.mount(oldWorld);
    const first = kernel.injectRootInfo('world', { type: 'WorkInfo', value: 'first' });
    while (!oldWorld.getActiveChangeId()) {
      await Promise.resolve();
    }
    expect(kernel.evict('world')).toBe(true);
    const fresh = new LateWorld('world');
    kernel.admit(fresh);
    resolveAdapter({ ok: true });
    await kernel.waitForSubmission(first);
    expect(oldWorld.getState().observed).toEqual(['first']);
    expect(fresh.getState().observed).toEqual([]);
    await kernel.dispose();
  });

  it('propagates lifecycle control through chained sends with no membership change', async () => {
    class Relay extends Node<Record<string, never>> {
      constructor() {
        super('relay', 'Relay', {});
      }

      protected override change(info: Info, ctx: DomainChangeContext<Record<string, never>>): void {
        if (info.type !== 'GoInfo') return;
        ctx.send({ type: '@lifecycle/StartRequested' }, 'lifecycle-node');
        ctx.send({ type: 'WorkInfo', value: 'one' }, 'lifecycle-node');
      }
    }
    const kernel = new KernelRuntime();
    const node = new LifecycleNode();
    kernel.mount(node, new Relay());
    await kernel.waitForSubmission(kernel.injectRootInfo('relay', { type: 'GoInfo' }));
    expect(node.getState()).toEqual({ running: true, log: ['start', 'work:one'] });
    expect(kernel.getNode('lifecycle-node')).toBe(node);
    expect(kernel.getGeneration('lifecycle-node')).toBe(0);
    await kernel.dispose();
  });
});
