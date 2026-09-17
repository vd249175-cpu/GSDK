import { describe, expect, it } from 'vitest';
import plugin from './backend.mjs';

describe('hello-counter run slice', () => {
  it('exposes a fragment-constructible counter Node with a provable root Info', () => {
    const [counter] = plugin.createNodes({});
    expect(counter.id).toBe('example.counter');
    expect(counter.getState()).toEqual({ count: 0 });
    expect(plugin.rendererRoots).toEqual([{
      targetNodeId: 'example.counter',
      infoType: 'IncrementInfo',
      validate: expect.any(Function),
    }]);
    expect(plugin.rendererRoots[0].validate({ type: 'IncrementInfo' })).toBe(true);
  });
});
