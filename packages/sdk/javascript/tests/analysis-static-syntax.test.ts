import { describe, expect, it } from 'vitest';
import { buildCausalIndex } from '../src/analysis';
import { Node, type DomainChangeContext, type Info } from '../src/node';

class BracketGuardNode extends Node<{}> {
  private readonly targets = { worker: 'target-node' };

  constructor() {
    super('bracket-guard', 'Bracket guard', {});
  }

  protected override change(info: Info, ctx: DomainChangeContext<{}>) {
    if (!ctx || info['type'] !== 'StartInfo') return;
    ctx.send({ type: 'StartedInfo' }, this.targets['worker']);
  }
}

class ReversedComparisonNode extends Node<{}> {
  constructor() {
    super('reversed-comparison', 'Reversed comparison', {});
  }

  protected override change(info: Info, ctx: DomainChangeContext<{}>) {
    if ('AlternateInfo' === info['type']) {
      ctx.send({ type: 'AlternatedInfo' }, 'target-node');
    }
  }
}

class TargetNode extends Node<{}> {
  constructor() {
    super('target-node', 'Target', {});
  }

  protected override change() {}
}

describe('AST-backed static relation extraction', () => {
  it('recognizes equivalent Info.type syntax without source-text patterns', () => {
    const index = buildCausalIndex({
      nodeObjects: [new BracketGuardNode(), new ReversedComparisonNode(), new TargetNode()],
    });

    expect(index.changes.has('change:bracket-guard::StartInfo')).toBe(true);
    expect(index.changes.has('change:reversed-comparison::AlternateInfo')).toBe(true);
    expect(index.changes.has('change:bracket-guard::*')).toBe(false);
    expect(index.changes.has('change:reversed-comparison::*')).toBe(false);
    expect(index.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'send',
        from: 'change:bracket-guard::StartInfo',
        to: 'info:StartedInfo@target-node',
      }),
      expect.objectContaining({
        type: 'send',
        from: 'change:reversed-comparison::AlternateInfo',
        to: 'info:AlternatedInfo@target-node',
      }),
    ]));
  });
});
