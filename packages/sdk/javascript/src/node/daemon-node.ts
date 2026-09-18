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
  readonly handlers: Readonly<Record<string, DaemonNodeHandler<Record<string, unknown>>>>;
  readonly signal?: AbortSignal;
  readonly longPollMs?: number;
  readonly onReady?: () => void;
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
    async effect<T = unknown>(adapterId: string, request: unknown): Promise<T> {
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
  options.onReady?.();
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
    await client.release(nodeIds);
  }
}

export interface DaemonChangeAdapter {
  readonly id: string;
}

export interface DaemonChangeIo {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  patchState(patch: Record<string, unknown>): void;
  send(info: { readonly type: string; readonly [key: string]: unknown }, targetNodeId: string): void;
  effectAdapter(adapter: DaemonChangeAdapter, request: unknown): Promise<unknown>;
  span<T>(name: string, action: () => Promise<T> | T): Promise<T> | T;
}

export interface RealDaemonNode {
  readonly id: string;
  getState(): Record<string, unknown>;
  dispose(): Promise<void>;
}

export interface DaemonNodeAssembly {
  readonly nodeId: string;
  readonly initialState: Record<string, unknown>;
  readonly handler: DaemonNodeHandler<Record<string, unknown>>;
  readonly effectCapabilities: readonly string[];
  readonly dispose: () => Promise<void>;
}

/**
 * Reuses a real domain Node's change logic and initial State for daemon
 * execution. The instance stays a logic holder: its construction-time State
 * seeds `admit`, the daemon owns live State, and the worker routes the
 * polled snapshot through the same `change` body. Instance State is never
 * read back, so a hot-swapped leftover cannot leak stale facts.
 */
export function describeDaemonNode(node: RealDaemonNode): DaemonNodeAssembly {
  const initialState = daemonValueCodec.encode(node.getState()) as Record<string, unknown>;
  const shaped = node as RealDaemonNode & {
    readonly effectCapabilities?: unknown;
    readonly adapter?: { readonly id?: unknown };
    change(
      info: { readonly type: string; readonly [key: string]: unknown },
      ctx: DaemonChangeIo,
    ): void | Promise<void>;
  };
  const fromInstance = Array.isArray(shaped.effectCapabilities)
    ? shaped.effectCapabilities.filter((entry): entry is string => typeof entry === 'string')
    : [];
  // TS `private readonly adapter` fields are runtime-visible own properties;
  // scan them so admit declares the capability the change body will request.
  const privateAdapterIds: string[] = [];
  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
      privateAdapterIds.push(value.id);
    }
  }
  const declared = [...fromInstance, ...privateAdapterIds];
  const adapterId = typeof shaped.adapter?.id === 'string' ? shaped.adapter.id : null;
  const withPublic = adapterId !== null && !declared.includes(adapterId)
    ? [...declared, adapterId]
    : declared;
  const effectCapabilities = [...new Set(withPublic)];
  // `change` is protected on the Node base class; invoke it structurally so
  // subclasses keep their visibility while the daemon reuses the real body.
  const invoke = shaped.change.bind(shaped);
  const handler: DaemonNodeHandler<Record<string, unknown>> = (info, ctx) => invoke(daemonValueCodec.decode(info), {
    read: (key: string) => daemonValueCodec.decode(ctx.read(key)),
    write: (key: string, value: unknown) => ctx.write(key, daemonValueCodec.encode(value)),
    patchState: (patch: Record<string, unknown>) => ctx.patchState(daemonValueCodec.encode(patch) as Record<string, unknown>),
    send: (
      child: { readonly type: string; readonly [key: string]: unknown },
      targetNodeId: string,
    ) => {
      ctx.send(daemonValueCodec.encode(child) as typeof child, targetNodeId);
    },
    effectAdapter: async (adapter: DaemonChangeAdapter, request: unknown) => daemonValueCodec.decode(await ctx.effect(adapter.id, daemonValueCodec.encode(request))),
    span: <T>(name: string, action: () => Promise<T> | T): Promise<T> | T => action(),
  });
  return {
    nodeId: node.id,
    initialState,
    handler,
    effectCapabilities,
    dispose: () => node.dispose(),
  };
}
/**
 * Admits real Nodes without starting the worker. Returns the admitted
 * assemblies so callers can start `runDaemonNodeWorker` on a separate
 * claimed connection after every instance exists. Partial admission failure
 * evicts the admitted prefix and disposes every assembled instance, so no
 * half-mounted slice is left behind.
 */
export async function admitDaemonNodes(
  control: KernelDaemonClient,
  nodes: readonly object[],
): Promise<{ assemblies: DaemonNodeAssembly[]; handlers: Record<string, DaemonNodeHandler<Record<string, unknown>>> }> {
  const assemblies = nodes.map((node) => describeDaemonNode(node as RealDaemonNode));
  const admitted: string[] = [];
  const handlers: Record<string, DaemonNodeHandler<Record<string, unknown>>> = {};
  try {
    for (const assembly of assemblies) {
      if (assembly.nodeId in handlers) throw new Error(`Duplicate daemon Node instance: ${assembly.nodeId}`);
      await control.admit(assembly.nodeId, assembly.initialState, undefined, assembly.effectCapabilities);
      admitted.push(assembly.nodeId);
      handlers[assembly.nodeId] = assembly.handler;
    }
    return { assemblies, handlers };
  } catch (error) {
    for (const nodeId of admitted.reverse()) {
      await control.evict?.(nodeId).catch(() => undefined);
    }
    await Promise.allSettled(assemblies.map((assembly) => assembly.dispose()));
    throw error;
  }
}

/**
 * Admits real Nodes, claims them on one worker connection, and runs their
 * change bodies until aborted. Mount order is explicit: admit every instance
 * first (so claims never target a missing Node), then claim, then poll.
 * Partial admission failure evicts the admitted prefix and disposes every
 * assembled instance, so no half-mounted slice is left behind.
 */
export async function runDaemonNodeAssembly(
  client: DaemonNodeWorkerClient | KernelDaemonClient,
  nodes: readonly object[],
  options: { readonly signal?: AbortSignal; readonly longPollMs?: number } = {},
) {
  const control = client as KernelDaemonClient;
  if (typeof control.admit !== 'function') throw new Error('Daemon assembly requires an admit-capable client');
  const { assemblies, handlers } = await admitDaemonNodes(control, nodes);
  const admitted = Object.keys(handlers);
  try {
    await runDaemonNodeWorker(client, { handlers, signal: options.signal, longPollMs: options.longPollMs });
  } finally {
    for (const nodeId of admitted.reverse()) {
      await control.evict?.(nodeId).catch(() => undefined);
    }
    await Promise.allSettled(assemblies.map((assembly) => assembly.dispose()));
  }
}
import { daemonValueCodec } from '../protocol/daemon-value';
