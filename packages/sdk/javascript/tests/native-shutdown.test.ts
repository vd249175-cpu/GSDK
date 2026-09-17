import { describe, expect, it } from 'vitest';
import { locateNativeBinding, NativeRuleSpace } from '../src/node/native-space';
import { deferred } from './deferred';

describe.skipIf(!locateNativeBinding())('native shutdown', () => {
  it('requires an empty space and permanently rejects new work', async () => {
    const space = new NativeRuleSpace();
    space.register('owner', {}, () => {});
    await expect(space.shutdown()).rejects.toThrow(/nodes/i);
    await space.evict('owner');
    await space.shutdown();
    await space.shutdown();
    expect(() => space.register('new', {}, () => {})).toThrow(/closed/i);
    expect(() => space.injectRoot('owner', { type: 'Late' })).toThrow(/closed/i);
    await expect(space.interveneState('owner', {}, {
      actor: 'test', reason: 'late patch', expectedGeneration: 0, expectedVersion: 0,
    })).rejects.toThrow(/closed/i);
    await expect(space.pump()).resolves.toBe(0);
  });

  it('waits for the active handler before disposal and drops sealed backlog', async () => {
    const space = new NativeRuleSpace();
    const entered = deferred();
    const release = deferred();
    const calls: string[] = [];
    space.register('owner', {}, async () => {
      entered.resolve();
      await release.promise;
      calls.push('handler');
    }, { dispose: () => { calls.push('dispose'); } });
    const root = space.injectRoot('owner', { type: 'Work' });
    const pump = space.pump();
    await entered.promise;
    const queued = space.injectRoot('owner', { type: 'Queued' });
    const evict = space.evict('owner');
    await expect(space.interveneState('owner', {}, {
      actor: 'test', reason: 'patch during eviction', expectedGeneration: 0, expectedVersion: 0,
    })).rejects.toThrow(/busy/i);
    await Promise.resolve();
    expect(calls).toEqual([]);
    release.resolve();
    await evict;
    await pump;
    await space.waitForSubmission(root);
    await space.waitForSubmission(queued);
    expect(calls).toEqual(['handler', 'dispose']);
    expect(space.drops()).toContainEqual(expect.objectContaining({ reason: 'evicted' }));
    await space.shutdown();
  });

  it('cleans all nodes once and reports disposal failures', async () => {
    const space = new NativeRuleSpace();
    const calls: string[] = [];
    space.register('bad', {}, () => {}, { dispose: () => { calls.push('bad'); throw new Error('dispose failed'); } });
    space.register('good', {}, () => {}, { dispose: () => { calls.push('good'); } });
    const first = space.dispose();
    const second = space.dispose();
    await expect(first).rejects.toThrow(/cleanup/i);
    await expect(second).rejects.toThrow(/cleanup/i);
    expect(calls.sort()).toEqual(['bad', 'good']);
    expect(() => space.injectRoot('good', { type: 'Late' })).toThrow(/closed/i);
  });

  it('leaves a timed-out handler sealed and permits explicit eviction after it finishes', async () => {
    const space = new NativeRuleSpace();
    const entered = deferred();
    const release = deferred();
    let disposed = false;
    space.register('owner', {}, async () => { entered.resolve(); await release.promise; }, {
      dispose: () => { disposed = true; },
    });
    space.injectRoot('owner', { type: 'Work' });
    const pump = space.pump();
    await entered.promise;
    await expect(space.evict('owner', { timeoutMs: 1 })).rejects.toThrow(/active change/);
    expect(disposed).toBe(false);
    release.resolve();
    await pump;
    await space.evict('owner');
    expect(disposed).toBe(true);
    await space.shutdown();
  });
});
