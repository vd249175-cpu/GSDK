import type { DaemonPolledEffect, KernelDaemonClient } from './daemon-client';

export interface DaemonEffectProviderClient {
  claimEffects(adapterIds: readonly string[]): Promise<unknown>;
  releaseEffects(adapterIds: readonly string[]): Promise<unknown>;
  pollEffect(waitMs?: number): Promise<DaemonPolledEffect | null>;
  completeEffect(
    effectId: number,
    result: { ok: true; observation: unknown } | { ok: false; error: string },
  ): Promise<unknown>;
}

export interface DaemonEffectContext {
  readonly effectId: number;
  readonly changeId: number;
  readonly nodeId: string;
  readonly generation: number;
}

export type DaemonEffectAdapter = (
  request: unknown,
  context: DaemonEffectContext,
) => unknown | Promise<unknown>;

export interface DaemonEffectProviderOptions {
  readonly adapters: Readonly<Record<string, DaemonEffectAdapter>>;
  readonly signal?: AbortSignal;
  readonly longPollMs?: number;
}

/** Runs physical adapters outside Rust; adapter IDs and DTOs remain opaque to the daemon. */
export async function runDaemonEffectProvider(
  client: DaemonEffectProviderClient | KernelDaemonClient,
  options: DaemonEffectProviderOptions,
): Promise<void> {
  const adapterIds = Object.keys(options.adapters).sort();
  if (adapterIds.length === 0) throw new Error('Effect provider requires at least one adapter');
  await client.claimEffects(adapterIds);
  try {
    while (!options.signal?.aborted) {
      const effect = await client.pollEffect(options.longPollMs ?? 1000);
      if (!effect) continue;
      const adapter = options.adapters[effect.adapterId];
      try {
        if (!adapter) throw new Error(`No provider for claimed EffectAdapter: ${effect.adapterId}`);
        const observation = await adapter(effect.request, {
          effectId: effect.effectId,
          changeId: effect.changeId,
          nodeId: effect.nodeId,
          generation: effect.generation,
        });
        await client.completeEffect(effect.effectId, { ok: true, observation });
      } catch (cause) {
        await client.completeEffect(effect.effectId, {
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  } finally {
    await client.releaseEffects(adapterIds).catch(() => undefined);
  }
}
