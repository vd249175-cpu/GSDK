import { describe, expect, it } from 'vitest';
import { Node } from '../src/node/node';
import { buildCausalIndex } from '../src/analysis/scan-index';
import { locateNativeBinding, NativeRuleSpace } from '../src/node/native-space';
import { mountDomainNode } from '../src/node/native-node';

class Source extends Node<{ count: number }> {
  constructor() { super('source', 'Source', { count: 0 }); }
  protected change(info: any, ctx: any) {
    if (info.type === 'StartInfo') {
      if (info.first) { ctx.write('count', 1); ctx.send({ type: 'DoneInfo' }, 'target'); }
      else { ctx.write('count', 2); ctx.send({ type: 'DoneInfo' }, 'target'); }
    }
  }
}
class Target extends Node<Record<string, never>> {
  constructor() { super('target', 'Target', {}); }
  protected change() {}
}

describe('repeated analysis sites', () => {
  it('keeps separate evidence sites with unique relation identities', () => {
    const index = buildCausalIndex({ nodeObjects: [new Source(), new Target()] });
    const sends = index.edges.filter((edge) => edge.type === 'send');
    expect(sends).toHaveLength(2);
    expect(new Set(index.edges.map((edge) => edge.id)).size).toBe(index.edges.length);
  });
  it.skipIf(!locateNativeBinding())('accepts the resulting portable facts in Rust analysis', async () => {
    const space = new NativeRuleSpace();
    mountDomainNode(space, new Source());
    mountDomainNode(space, new Target());
    try { expect((await space.analyze({ op: 'validate' })).valid).toBe(true); }
    finally { await space.dispose(); }
  });
});
