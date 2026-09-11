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
});
