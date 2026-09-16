import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { locateNativeBinding } from '../src/node/native-space';

const bindingPath = locateNativeBinding();
const require = createRequire(import.meta.url);
const binding = bindingPath
  ? require(bindingPath) as { analyzeJson(requestJson: string, factsJson: string): string }
  : null;

const snapshots = [
  {
    version: 1 as const,
    nodeId: 'a',
    entities: [
      { address: 'node:a', kind: 'node', id: 'a' },
      { address: 'change:a::TickInfo', kind: 'change', id: 'a', nodeId: 'a', subId: 'TickInfo' },
      { address: 'info:TickInfo@b', kind: 'info', id: 'TickInfo', nodeId: 'b', subId: 'b' },
    ],
    edges: [
      { id: 'e1', from: 'change:a::TickInfo', to: 'info:TickInfo@b', type: 'send', confidence: 'high' },
    ],
  },
];

describe.skipIf(!binding)('N-API shared analysis compute', () => {
  it('serves the same key-sorted view DTO as the daemon and C ABI entries', () => {
    const result = JSON.parse(binding!.analyzeJson(
      JSON.stringify({ op: 'view' }),
      JSON.stringify({ snapshots, liveStates: { a: { count: 0 }, b: {} } }),
    ));
    expect(result.routes.map((route: { id: string }) => route.id)).toEqual(['route:a->b:TickInfo']);
    expect(result.routes[0]).toMatchObject({ routeCount: 1, internal: false });
  });

  it('rejects operations outside the unified Rust protocol', () => {
    expect(() => binding!.analyzeJson(
      JSON.stringify({ op: 'legacyQuery' }),
      JSON.stringify({ snapshots, liveStates: {} }),
    )).toThrow();
  });
});
