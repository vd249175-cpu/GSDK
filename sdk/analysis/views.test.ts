import { describe, expect, it } from 'vitest';
import { analyzeViewHealth } from './health';
import { analyzeViewReachability } from './reachability';
import { buildAllNodesView } from './views';
import type { CausalEdge, CausalEntity, CausalIndex } from './model';

function nodeEntity(id: string): CausalEntity {
  return { address: `node:${id}`, kind: 'node', id, name: id };
}

function sendEdge(n: number, from: string, to: string, info = 'PingInfo'): CausalEdge {
  return {
    id: `send:e${n}`,
    from: `change:${from}::${info}`,
    to: `info:${info}@${to}`,
    type: 'send',
    confidence: 'high',
  };
}

function emptyIndex(entities: CausalEntity[], edges: CausalEdge[]): CausalIndex {
  return {
    timestamp: 0,
    entities: new Map(entities.map((entity) => [entity.address, entity])),
    edges,
    nodes: new Map(entities.filter((entity) => entity.kind === 'node').map((entity) => [entity.id, entity])),
    changes: new Map(),
    states: new Map(),
    infos: new Map(),
    effects: new Map(),
    entries: new Map(),
    uiPaths: new Map(),
    frontendLinks: [],
    frontendServiceLinks: [],
    nodeObjectFacts: [],
    unresolvedInfoTypes: [],
    unresolvedSendTargets: [],
  };
}

describe('buildAllNodesView', () => {
  it('aggregates duplicate sends, marks self-sends internal, skips non-send edges', () => {
    const index = emptyIndex(
      [nodeEntity('a'), nodeEntity('b')],
      [
        sendEdge(1, 'a', 'b'),
        sendEdge(2, 'a', 'b'),
        sendEdge(3, 'b', 'b', 'PongInfo'),
        { id: 'trigger:t', from: 'info:PingInfo@b', to: 'change:b::PingInfo', type: 'trigger', confidence: 'high' },
        { id: 'inject:i', from: 'entry:app.start', to: 'info:PingInfo@a', type: 'inject', confidence: 'high' },
        sendEdge(4, 'a', 'ghost'),
      ],
    );
    const view = buildAllNodesView(index);
    expect(view.id).toBe('all-nodes');
    expect(view.routes.map((route) => route.id)).toEqual([
      'route:a->b:PingInfo',
      'route:b->b:PongInfo',
    ]);
    const cross = view.routes[0];
    expect(cross.routeCount).toBe(2);
    expect(cross.internal).toBe(false);
    expect(cross.witnesses.map((witness) => witness.edgeId)).toEqual(['send:e1', 'send:e2']);
    expect(view.routes[1].internal).toBe(true);
    expect(view.nodes.get('a')).toMatchObject({ outbound: [cross], inbound: [], internal: [] });
    expect(view.nodes.get('b')?.inbound).toEqual([cross]);
    expect(view.nodes.get('b')?.internal).toEqual([view.routes[1]]);
  });

  it('reports an isolated node as isolated with empty reachability', () => {
    const view = buildAllNodesView(emptyIndex([nodeEntity('solo')], []));
    expect(analyzeViewHealth(view)).toMatchObject({
      nodeCount: 1,
      routeCount: 0,
      isolatedNodeIds: ['solo'],
    });
    expect(analyzeViewReachability(view, 'solo')).toMatchObject({
      upstream: [],
      downstream: [],
      unreachableNodeIds: [],
    });
  });

  it('measures one-hop upstream and downstream distances', () => {
    const view = buildAllNodesView(emptyIndex(
      [nodeEntity('a'), nodeEntity('b')],
      [sendEdge(1, 'a', 'b')],
    ));
    expect(analyzeViewReachability(view, 'a').downstream).toEqual([{ nodeId: 'b', distance: 1 }]);
    expect(analyzeViewReachability(view, 'b').upstream).toEqual([{ nodeId: 'a', distance: 1 }]);
  });
});
