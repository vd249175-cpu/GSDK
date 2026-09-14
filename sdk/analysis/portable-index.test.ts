import { describe, expect, it } from 'vitest';
import { buildCausalIndexFromSnapshot, buildAllNodesView, findCausalPaths, validateCausalIndex } from './portable';
import type { PortableAnalysisSnapshot } from './model';

const foreign: PortableAnalysisSnapshot = {
  version: 1,
  nodeId: 'python.worker',
  entities: [
    { address: 'node:python.worker', kind: 'node', id: 'python.worker', name: 'Python worker' },
    { address: 'change:python.worker::RunInfo', kind: 'change', id: 'python.worker', nodeId: 'python.worker', subId: 'RunInfo' },
    { address: 'info:RunInfo@python.worker', kind: 'info', id: 'RunInfo', nodeId: 'python.worker', subId: 'python.worker' },
    { address: 'state:python.worker::runs', kind: 'state', id: 'python.worker', nodeId: 'python.worker', subId: 'runs' },
    { address: 'info:DoneInfo@js.target', kind: 'info', id: 'DoneInfo', nodeId: 'js.target', subId: 'js.target' },
  ],
  edges: [
    { id: 'trigger:python.worker:RunInfo', from: 'info:RunInfo@python.worker', to: 'change:python.worker::RunInfo', type: 'trigger', confidence: 'high' },
    { id: 'write:python.worker:runs', from: 'change:python.worker::RunInfo', to: 'state:python.worker::runs', type: 'write', confidence: 'high' },
    { id: 'send:python.worker:DoneInfo', from: 'change:python.worker::RunInfo', to: 'info:DoneInfo@js.target', type: 'send', confidence: 'high' },
  ],
};

describe('portable causal snapshots', () => {
  it('builds the same queryable index from plain data without a Node instance', () => {
    const index = buildCausalIndexFromSnapshot(foreign);
    expect(index.nodes.has('python.worker')).toBe(true);
    expect(index.changes.has('change:python.worker::RunInfo')).toBe(true);
    expect(index.edges.some((edge) => edge.type === 'send' && edge.to === 'info:DoneInfo@js.target')).toBe(true);
    expect(index.nodeObjectFacts).toEqual([]);
    expect(buildAllNodesView(index).nodes.has('python.worker')).toBe(true);
  });

  it('rejects facts that impersonate another source Node', () => {
    expect(() => buildCausalIndexFromSnapshot({ ...foreign, entities: [
      { address: 'node:other', kind: 'node', id: 'other' },
    ] })).toThrow(/source Node/);
  });

  it('rejects duplicate source snapshots for the same Node', () => {
    expect(() => buildCausalIndexFromSnapshot([foreign, foreign])).toThrow(/Duplicate source Node/);
  });

  it('joins portable Node facts to an explicit frontend boundary without source scanning', () => {
    const index = buildCausalIndexFromSnapshot(foreign, undefined, { frontendLinks: [{
      id: 'run', applicationMethod: 'app.run',
      injection: { targetNodeId: 'python.worker', infoType: 'RunInfo' },
      projections: [{ ownerNodeId: 'python.worker', ownerField: 'runs',
        applicationStatePath: 'worker.runs', consumers: ['CounterView'] }],
    }] });
    expect(validateCausalIndex(index).valid).toBe(true);
    expect(findCausalPaths(index, 'entry:app.run', 'ui:worker.runs').paths).toHaveLength(1);
  });
});
