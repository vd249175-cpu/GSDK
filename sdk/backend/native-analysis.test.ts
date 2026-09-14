import { describe, expect, it } from 'vitest';
import { Node } from '@graphvideo/kernel';
import { mountDomainNode } from './native-node';
import { locateNativeBinding, NativeRuleSpace } from './native-space';
import type { PortableAnalysisSnapshot } from '../analysis/model';

class Source extends Node<{ count: number }> {
  constructor() { super('source', 'Source', { count: 0 }); }
  protected change(info: any, ctx: any) {
    if (info.type === 'StartInfo') ctx.send({ type: 'WorkInfo' }, 'target');
  }
}
class Target extends Node<{ count: number }> {
  constructor() { super('target', 'Target', { count: 0 }); }
  protected change(info: any, ctx: any) {
    if (info.type === 'WorkInfo') ctx.write('count', ctx.read('count') + 1);
  }
}

describe.skipIf(!locateNativeBinding())('native rule space analysis', () => {
  it('analyzes a foreign-language Node from kernel-owned portable facts', async () => {
    const space = new NativeRuleSpace();
    const facts: PortableAnalysisSnapshot = {
      version: 1, nodeId: 'python.worker',
      entities: [
        { address: 'node:python.worker', kind: 'node', id: 'python.worker', name: 'Python worker' },
        { address: 'change:python.worker::RunInfo', kind: 'change', id: 'python.worker', nodeId: 'python.worker', subId: 'RunInfo' },
        { address: 'info:RunInfo@python.worker', kind: 'info', id: 'RunInfo', nodeId: 'python.worker', subId: 'python.worker' },
        { address: 'info:DoneInfo@target', kind: 'info', id: 'DoneInfo', nodeId: 'target', subId: 'target' },
      ],
      edges: [
        { id: 'trigger:python:run', from: 'info:RunInfo@python.worker', to: 'change:python.worker::RunInfo', type: 'trigger', confidence: 'high' },
        { id: 'send:python:done', from: 'change:python.worker::RunInfo', to: 'info:DoneInfo@target', type: 'send', confidence: 'high' },
      ],
    };
    space.register('python.worker', { runs: 0 }, () => {}, { analysisFacts: facts });
    mountDomainNode(space, new Target());
    expect((await space.analyze({ op: 'view' })).routes[0]).toMatchObject({
      from: 'python.worker', to: 'target', infoType: 'DoneInfo',
    });
    expect((await space.analyze({ op: 'entity', address: 'change:python.worker::RunInfo' }))?.nodeId).toBe('python.worker');
    expect((await space.analyze({ op: 'facts' }))[0].nodeId).toBe('python.worker');
    await space.replace('python.worker', { runs: 0 }, () => {});
    expect(await space.analyze({ op: 'entity', address: 'change:python.worker::RunInfo' })).toBeNull();
  });
  it('embeds complete static analysis and changes fold resolution on request', async () => {
    const space = new NativeRuleSpace();
    mountDomainNode(space, new Source());
    mountDomainNode(space, new Target());
    const collapsed = await space.analyze({ op: 'view', foldDepth: 0 });
    expect(collapsed.nodes.size).toBe(1);
    expect(collapsed.routes[0].internal).toBe(true);
    const expanded = await space.analyze({ op: 'view', foldDepth: 1 });
    expect([...expanded.nodes.keys()]).toEqual(['source', 'target']);
    expect(expanded.routes[0]).toMatchObject({ from: 'source', to: 'target', infoType: 'WorkInfo' });
    const folds = {
      version: 1 as const, root: 'world', groups: {
        world: { children: ['pair'] }, pair: { children: ['source', 'target'] },
      },
    };
    expect([...(await space.analyze({ op: 'view', folds, foldDepth: 1 })).nodes.keys()])
      .toEqual(['fold:pair']);
    expect([...(await space.analyze({ op: 'view', folds, foldDepth: 2 })).nodes.keys()])
      .toEqual(['source', 'target']);
    expect((await space.analyze({ op: 'health', foldDepth: 1 })).nodeCount).toBe(2);
    expect((await space.analyze({ op: 'reach', nodeId: 'source', foldDepth: 1 })).downstream)
      .toEqual([{ nodeId: 'target', distance: 1 }]);
    expect((await space.analyze({ op: 'centrality', foldDepth: 1 })).nodeCount).toBe(2);
    expect((await space.analyze({ op: 'communities', foldDepth: 1 })).vertexCount).toBe(2);
    expect((await space.analyze({
      op: 'compareCommunities', foldDepth: 1,
      referenceFolds: folds, referenceFoldDepth: 1,
    })).comparedVertexCount).toBe(2);
    expect((await space.analyze({ op: 'granularCommunities' })).resolution).toBe('granular');
    expect((await space.analyze({ op: 'validate' })).valid).toBe(true);
    expect((await space.analyze({ op: 'entity', address: 'node:source' }))?.id).toBe('source');
    expect((await space.analyze({ op: 'path', addresses: ['change:source::StartInfo', 'state:target::count'] })).connected).toBe(true);
    expect(space.getState('target')).toEqual({ count: 0 });
  });

  it('tracks live membership and State fields without inventing routes for opaque handlers', async () => {
    const space = new NativeRuleSpace();
    mountDomainNode(space, new Source());
    space.register('opaque', { initial: 1 }, () => {});
    expect((await space.analyze({ op: 'view', foldDepth: 1 })).nodes.has('opaque')).toBe(true);
    await space.interveneState('opaque', { added: 2 }, {
      actor: 'agent/test', reason: 'repair', expectedGeneration: 0, expectedVersion: 0,
    });
    expect((await space.analyze({ op: 'entity', address: 'state:opaque::added' }))?.nodeId).toBe('opaque');
    space.unregister('source');
    expect((await space.analyze({ op: 'view', foldDepth: 1 })).nodes.has('source')).toBe(false);
    await space.replace('opaque', { replacement: true }, () => {});
    expect((await space.analyze({ op: 'entity', address: 'state:opaque::replacement' }))?.nodeId).toBe('opaque');
    expect(await space.analyze({ op: 'entity', address: 'state:opaque::added' })).toBeNull();
  });
});
