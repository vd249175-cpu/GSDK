import type {
  DaemonChangeOperation,
  DaemonPolledChange,
  KernelDaemonClient,
} from '../agent/daemon-client';

export interface DaemonNodeChangeContext<S extends Record<string, unknown>> {
  read<K extends keyof S>(key: K): S[K];
  write<K extends keyof S>(key: K, value: S[K]): void;
  patchState(patch: Partial<S>): void;
  send(info: { readonly type: string; readonly [key: string]: unknown }, targetNodeId: string): void;
  effect<T = unknown>(adapterId: string, request: unknown): Promise<T>;
}

export type DaemonNodeHandler<S extends Record<string, unknown> = Record<string, unknown>> = (
  info: { readonly type: string; readonly [key: string]: unknown },
  ctx: DaemonNodeChangeContext<S>,
) => void | Promise<void>;

export interface DaemonNodeWorkerClient {
  claim(nodeIds: readonly string[]): Promise<unknown>;
  release(nodeIds: readonly string[]): Promise<unknown>;
  poll(waitMs?: number): Promise<DaemonPolledChange | null>;
  commit(changeId: number, operations: readonly DaemonChangeOperation[], error?: string): Promise<unknown>;
  requestEffect(changeId: number, adapterId: string, request: unknown): Promise<{ effectId: number }>;
  awaitEffect(effectId: number, waitMs?: number): Promise<{ ok: boolean; value: unknown } | null>;
}

export interface DaemonNodeWorkerOptions {
  readonly handlers: Readonly<Record<string, DaemonNodeHandler<any>>>;
  readonly signal?: AbortSignal;
  readonly longPollMs?: number;
}

function localContext<S extends Record<string, unknown>>(
  snapshot: Readonly<S>,
  operations: DaemonChangeOperation[],
  client: DaemonNodeWorkerClient | KernelDaemonClient,
  changeId: number,
): DaemonNodeChangeContext<S> {
  const state = { ...snapshot } as S;
  return {
    read: (key) => state[key],
    write(key, value) {
      state[key] = value;
      operations.push({ op: 'write', key: String(key), value });
    },
    patchState(patch) {
      Object.assign(state, patch);
      operations.push({ op: 'patchState', patch });
    },
    send(info, targetNodeId) {
      operations.push({ op: 'send', info, targetNodeId });
    },
    async effect<T>(adapterId: string, request: unknown): Promise<T> {
      const { effectId } = await client.requestEffect(changeId, adapterId, request);
      for (;;) {
        const result = await client.awaitEffect(effectId);
        if (!result) continue;
        if (!result.ok) throw new Error(String(result.value));
        return result.value as T;
      }
    },
  };
}

/**
 * Runs business change handlers outside Rust. State reads are local and all
 * writes/sends are committed as one ordered batch, so the hot path stays at
 * two daemon round trips per change.
 */
export async function runDaemonNodeWorker(
  client: DaemonNodeWorkerClient | KernelDaemonClient,
  options: DaemonNodeWorkerOptions,
): Promise<void> {
  const nodeIds = Object.keys(options.handlers).sort();
  if (nodeIds.length === 0) throw new Error('Daemon Node worker requires at least one handler');
  await client.claim(nodeIds);
  try {
    while (!options.signal?.aborted) {
      const polled = await client.poll(options.longPollMs ?? 1000);
      if (!polled) continue;
      const operations: DaemonChangeOperation[] = [];
      const handler = options.handlers[polled.change.nodeId];
      let error: string | undefined;
      try {
        if (!handler) throw new Error(`No handler for claimed Node: ${polled.change.nodeId}`);
        await handler(polled.change.info, localContext(
          polled.state, operations, client, polled.change.changeId,
        ));
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      await client.commit(polled.change.changeId, operations, error);
    }
  } finally {
    await client.release(nodeIds).catch(() => undefined);
  }
}
