import { describe, expect, it, vi } from 'vitest';
import { Node } from './node';
import { KernelRuntime } from './runtime';
import type {
  ChangeRecord,
  DeliveryFeedback,
  DomainChangeContext,
  Info,
  NodeErrorInfo,
} from './types';

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
    await expect(kernel.waitForQuiescence()).resolves.toMatchObject({ isQuiescent: true });
    warning.mockRestore();
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
});

describe('RuleSpace admit / evict / replace', () => {
  it('evicts an entity, drops its sends, and re-admits with a new generation', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kernel = new KernelRuntime();
    kernel.admit(new Sink('ephemeral'), new ProbeSource('ephemeral'));
    expect(kernel.getGeneration('ephemeral')).toBe(0);
    expect(kernel.evict('ephemeral')).toBe(true);
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
});
