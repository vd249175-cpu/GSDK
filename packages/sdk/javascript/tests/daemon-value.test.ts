import { it, expect } from 'vitest';
import { daemonValueCodec } from '../src/protocol/daemon-value';
import { describeDaemonNode } from '../src/node/daemon-node';

it('preserves non-JSON State across JSON transport without truncation or tag collisions', () => {
  const state = { tasks: new Map([['one', { nested: new Set([1, 2]), bytes: new Uint8Array([1, 255]) }]]),
    literal: { $graphvideoValue: 'map', entries: 'business data' }, omitted: undefined, date: new Date(0) };
  expect(daemonValueCodec.decode(JSON.parse(JSON.stringify(daemonValueCodec.encode(state))))).toEqual(state);
});
it('reuses a real Map-owning change against portable daemon State', async () => {
  const node = { id: 'task', getState: () => ({ tasks: new Map<string, number>() }), dispose: async () => {},
    change(_info: unknown, ctx: any) { const tasks = new Map(ctx.read('tasks')); tasks.set('one', 1); ctx.write('tasks', tasks); } };
  const assembly = describeDaemonNode(node);
  const state = JSON.parse(JSON.stringify(assembly.initialState));
  await assembly.handler({ type: 'AddInfo' }, { read: (key: string) => state[key], write: (key: string, value: unknown) => { state[key] = JSON.parse(JSON.stringify(value)); } } as any);
  expect(daemonValueCodec.decode(state)).toEqual({ tasks: new Map([['one', 1]]) });
  expect(node.getState().tasks.size).toBe(0);
});
