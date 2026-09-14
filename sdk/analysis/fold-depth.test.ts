import { describe, expect, it } from 'vitest';
import { buildFoldDepthView } from './fold-depth';
import type { AnalysisView, FoldDefinitionFile } from './model';

const leaf = (id: string) => ({
  id, name: id, aggregate: false, sourceNodeIds: [id],
  states: [], changes: [{ address: `change:${id}::Go`, kind: 'change' as const, id, nodeId: id }],
  infos: [], effects: [], inbound: [], internal: [], outbound: [],
});
const route = (from: string, to: string, infoType: string) => ({
  id: `route:${from}->${to}:${infoType}`, from, to, infoType, routeCount: 1,
  internal: false, witnesses: [{
    edgeId: `send:${from}->${to}`, sourceNodeId: from,
    sourceChangeAddress: `change:${from}::Go`, targetNodeId: to,
    targetInfoAddress: `info:${infoType}@${to}`, infoType,
  }],
});
const base: AnalysisView = {
  id: 'all-nodes', kind: 'all-nodes', root: '', expanded: [],
  nodes: new Map(['a', 'b', 'c'].map((id) => [id, leaf(id)])),
  routes: [route('a', 'b', 'Ping'), route('a', 'c', 'Pong'), route('b', 'c', 'Pong')],
  baseNodeToViewNode: new Map(['a', 'b', 'c'].map((id) => [id, id])),
};
const folds: FoldDefinitionFile = {
  version: 1, root: 'world', groups: {
    world: { children: ['left', 'right'] },
    left: { children: ['a', 'b'] },
    right: { children: ['c'] },
  },
};

describe('fold depth view', () => {
  it('changes resolution without losing source witnesses or internal routes', () => {
    const root = buildFoldDepthView(base, folds, 0);
    expect([...root.nodes.keys()]).toEqual(['fold:world']);
    expect(root.routes).toHaveLength(2);
    expect(root.routes.every((entry) => entry.internal)).toBe(true);
    const middle = buildFoldDepthView(base, folds, 1);
    expect([...middle.nodes.keys()]).toEqual(['fold:left', 'fold:right']);
    expect(middle.nodes.get('fold:left')?.sourceNodeIds).toEqual(['a', 'b']);
    expect(middle.nodes.get('fold:left')?.changes).toHaveLength(2);
    expect(middle.routes.map((entry) => [entry.from, entry.to, entry.internal])).toEqual([
      ['fold:left', 'fold:left', true], ['fold:left', 'fold:right', false],
    ]);
    expect(middle.routes[1].routeCount).toBe(2);
    expect(middle.routes[1].witnesses.map((witness) => witness.sourceNodeId)).toEqual(['a', 'b']);
    const leaves = buildFoldDepthView(base, folds, 2);
    expect([...leaves.nodes.keys()]).toEqual(['a', 'b', 'c']);
    expect(leaves.routes).toEqual(base.routes);
  });

  it('rejects missing, duplicate and cyclic leaf coverage', () => {
    expect(() => buildFoldDepthView(base, {
      version: 1, root: 'world', groups: { world: { children: ['a', 'b'] } },
    }, 1)).toThrow(/coverage/i);
    expect(() => buildFoldDepthView(base, {
      version: 1, root: 'world', groups: { world: { children: ['a', 'a', 'b', 'c'] } },
    }, 1)).toThrow(/duplicate/i);
    expect(() => buildFoldDepthView(base, {
      version: 1, root: 'world', groups: { world: { children: ['loop'] }, loop: { children: ['world'] } },
    }, 1)).toThrow(/cycle/i);
    expect(() => buildFoldDepthView(base, folds, -1)).toThrow(/depth/i);
  });
});
