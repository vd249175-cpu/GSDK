import { describe, expect, it } from 'vitest';
import type { DaemonEffectProviderClient } from './daemon-effect';
import type { DaemonPolledEffect } from './daemon-client';
import { runDaemonEffectProvider } from './daemon-effect';

class FixtureProviderClient implements DaemonEffectProviderClient {
  claimed: readonly string[] = [];
  released: readonly string[] = [];
  completed: unknown[] = [];
  constructor(private readonly effect: DaemonPolledEffect, private readonly stop: AbortController) {}
  async claimEffects(ids: readonly string[]) { this.claimed = ids; }
  async releaseEffects(ids: readonly string[]) { this.released = ids; }
  async pollEffect() { return this.effect; }
  async completeEffect(effectId: number, result: unknown) {
    this.completed.push({ effectId, ...result as object });
    this.stop.abort();
  }
}

describe('runDaemonEffectProvider', () => {
  it('executes an opaque adapter outside Rust and returns its observation', async () => {
    const stop = new AbortController();
    const client = new FixtureProviderClient({
      effectId: 8, changeId: 4, nodeId: 'world', generation: 2,
      adapterId: 'fixture/double', request: { value: 3 },
    }, stop);
    await runDaemonEffectProvider(client, {
      signal: stop.signal,
      adapters: {
        'fixture/double': (request, context) => ({
          value: Number((request as any).value) * 2,
          owner: `${context.nodeId}@${context.generation}`,
        }),
      },
    });
    expect(client.claimed).toEqual(['fixture/double']);
    expect(client.completed).toEqual([{
      effectId: 8, ok: true, observation: { value: 6, owner: 'world@2' },
    }]);
    expect(client.released).toEqual(['fixture/double']);
  });
});
