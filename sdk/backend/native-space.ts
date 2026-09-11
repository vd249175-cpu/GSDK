import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultValueCodec,
  systemClock,
  systemRandomSource,
  TimeRandomIdProvider,
} from '@graphvideo/kernel';
import type {
  Clock,
  EffectAdapter,
  GraphProjection,
  IdProvider,
  Node,
  ValueCodec,
} from '@graphvideo/kernel';

export interface StaticTopologyRoute {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly infoType: string;
  readonly routeCount: number;
}

export interface StaticTopologyNode {
  readonly nodeId: string;
  readonly generation: number | null;
  readonly version: number;
  readonly status: string;
  readonly state: Record<string, unknown>;
}

export interface StaticTopology {
  readonly revision: number;
  readonly nodes: StaticTopologyNode[];
  readonly routes: StaticTopologyRoute[];
}

export interface NativeInfo {
  readonly type: string;
  [key: string]: unknown;
}

export type NativeDeliveryStatus = 'enqueued' | 'dropped';

export interface NativeDeliveryFeedback {
  readonly status: NativeDeliveryStatus;
  readonly reason?: string;
}

export interface NativeChangeContext<S = any> {
  read<K extends keyof S>(key: K): S[K];
  write<K extends keyof S>(key: K, value: S[K]): void;
  patchState(patch: Partial<S>): void;
  send(info: NativeInfo, targetNodeId: string): NativeDeliveryFeedback;
  effectAdapter<Request, Observation>(
    adapter: EffectAdapter<Request, Observation>,
    request: Request,
    options?: { signal?: AbortSignal },
  ): Promise<Observation>;
  span<T>(name: string, action: () => Promise<T> | T): Promise<T>;
}

export type NativeHandler<S = any> = (
  info: NativeInfo,
  ctx: NativeChangeContext<S>,
) => void | Promise<void>;

interface BindingFeedback {
  status: string;
  reason?: string;
}

interface BindingToken {
  changeId: number;
  entity: string;
  generation: number;
  submission?: string;
}

interface BindingView {
  changeId: number;
  entity: string;
  generation: number;
  infoType: string;
  sender: string;
  payloadJson?: string;
  submission?: string;
}

interface BindingPolled {
  token: BindingToken;
  view: BindingView;
}

interface BindingSpace {
  admit(id: string): number;
  evict(id: string): boolean;
  seal(id: string): void;
  unseal(id: string): void;
  replace(id: string): number;
  generation(id: string): number | null;
  send(
    sender: string,
    infoType: string,
    payloadJson: string | null,
    target: string,
    causedBy: number | null,
    submission?: string,
  ): BindingFeedback;
  injectRoot(
    target: string,
    infoType: string,
    payloadJson: string | null,
    submission: string,
  ): BindingFeedback;
  pollNext(): BindingPolled | null;
  settleChange(token: BindingToken, failedMessage: string | null): boolean;
  cancel(submission: string): boolean;
  submissionState(submission: string): string | null;
  pendingTotal(): number;
  queuedDepths(): Array<{ entity: string; depth: number }>;
  drops(): Array<{ target: string; reason: string; submission?: string }>;
  admittedEntities?(): string[];
}

interface RegisteredNode {
  state: Record<string, unknown>;
  handler: NativeHandler<any>;
  version: number;
  isWorldNode: boolean;
  dispose?: () => void | Promise<void>;
  nodeInstance?: unknown;
}

export type CausalTelemetryEvent =
  | {
      readonly type: 'root_injected';
      readonly targetNodeId: string;
      readonly info: NativeInfo;
      readonly submissionId: string;
      readonly timestamp: number;
    }
  | {
      readonly type: 'info_sent';
      readonly fromNodeId: string;
      readonly toNodeId: string;
      readonly info: NativeInfo;
      readonly submissionId?: string;
      readonly changeId: number;
      readonly status: 'enqueued' | 'dropped';
      readonly timestamp: number;
    }
  | {
      readonly type: 'change_start';
      readonly nodeId: string;
      readonly info: NativeInfo;
      readonly submissionId?: string;
      readonly changeId: number;
      readonly timestamp: number;
    }
  | {
      readonly type: 'change_end';
      readonly nodeId: string;
      readonly submissionId?: string;
      readonly changeId: number;
      readonly durationMs: number;
      readonly timestamp: number;
    }
  | {
      readonly type: 'state_mutated';
      readonly nodeId: string;
      readonly version: number;
      readonly state: Record<string, unknown>;
      readonly timestamp: number;
    }
  | {
      readonly type: 'node_admitted';
      readonly nodeId: string;
      readonly generation: number;
      readonly timestamp: number;
    }
  | {
      readonly type: 'node_evicted';
      readonly nodeId: string;
      readonly timestamp: number;
    };

const ERROR_INFO_TYPE = '@error/NodeFailed';

export interface NativeRuleSpaceOptions {
  readonly errorTargetNodeId?: string;
  readonly clock?: Clock;
  readonly idProvider?: IdProvider;
  readonly valueCodec?: ValueCodec;
  readonly replaceTimeoutMs?: number;
}

export interface NativeRegisterOptions {
  readonly isWorldNode?: boolean;
  readonly dispose?: () => void | Promise<void>;
  readonly nodeInstance?: unknown;
}

class StaleNativeChangeError extends Error {
  constructor(entity: string) {
    super(`Native change context is stale: ${entity}`);
    this.name = 'StaleNativeChangeError';
  }
}

/** Absolute path of the built native module, if present. */
export function locateNativeBinding(): string | null {
  if (process.env.GRAPHVIDEO_NATIVE_NODE && existsSync(process.env.GRAPHVIDEO_NATIVE_NODE)) {
    return process.env.GRAPHVIDEO_NATIVE_NODE;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const platformTag = process.platform === 'win32'
    ? `win32-${process.arch}-msvc`
    : process.platform === 'linux'
      ? `linux-${process.arch}-gnu`
      : process.platform === 'darwin'
        ? `darwin-${process.arch}`
        : null;
  if (!platformTag) return null;
  const fileName = `graphvideo-kernel-node.${platformTag}.node`;
  const candidates = [
    resolve(here, 'native', fileName),
    resolve(here, '..', '..', 'crates', 'kernel-node', fileName),
    resolve(here, '..', '..', '..', 'crates', 'kernel-node', fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadBinding(): BindingSpace {
  const path = locateNativeBinding();
  if (!path) {
    throw new Error(
      'Native rule space not built: run cargo build -p graphvideo-kernel-node and copy the cdylib to crates/kernel-node/',
    );
  }
  const require = createRequire(import.meta.url);
  const module = require(path) as { RuleSpace: new () => BindingSpace };
  return new module.RuleSpace();
}

function toFeedback(feedback: BindingFeedback): NativeDeliveryFeedback {
  if (feedback.status === 'enqueued') return { status: 'enqueued' };
  return { status: 'dropped', reason: feedback.reason };
}

function splitPayload(info: NativeInfo): string {
  const { type: _type, ...payload } = info;
  return JSON.stringify(payload);
}
function isBusyError(error: unknown): boolean {
  // Coupled to `KernelError::Busy` Display in crates/kernel/src/error.rs.
  const message = error instanceof Error ? error.message : String(error);
  return /\bbusy\b/i.test(message);
}

function joinInfo(infoType: string, payloadJson?: string): NativeInfo {
  if (!payloadJson) return { type: infoType };
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return { ...payload, type: infoType };
  } catch {
    return { type: infoType };
  }
}

/**
 * JS business entities on the Rust rule space.
 *
 * Scheduling facts (registry, mailboxes, submissions, drops) live in Rust;
 * business State and change bodies live here. Concurrent pump requests
 * share one drain. Replacement seals its target immediately and waits for
 * the active JS change to reach the single-flight gap.
 */
export class NativeRuleSpace {
  private readonly binding: BindingSpace;
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly submissionControllers = new Map<string, AbortController>();
  private readonly projectionListeners = new Set<(projection: GraphProjection) => void>();
  private readonly telemetryListeners = new Set<(event: CausalTelemetryEvent) => void>();
  private readonly activeEntities = new Set<string>();
  private readonly replacements = new Set<string>();
  private readonly pendingDisposals = new Set<Promise<void>>();
  private pumpPromise?: Promise<number>;
  private projectionRevision = 0;
  private topologyRevision = 0;
  private cachedTopology?: StaticTopology;
  private readonly clock: Clock;
  private readonly idProvider: IdProvider;
  private readonly replaceTimeoutMs: number;
  public readonly valueCodec: ValueCodec;
  public errorTargetNodeId?: string;

  constructor(options: NativeRuleSpaceOptions = {}) {
    this.binding = loadBinding();
    this.errorTargetNodeId = options.errorTargetNodeId;
    this.clock = options.clock ?? systemClock;
    this.idProvider = options.idProvider
      ?? new TimeRandomIdProvider(this.clock, systemRandomSource);
    this.valueCodec = options.valueCodec ?? defaultValueCodec;
    this.replaceTimeoutMs = options.replaceTimeoutMs ?? 5000;
  }

  register<S extends Record<string, unknown>>(
    id: string,
    initialState: S,
    handler: NativeHandler<S>,
    options: NativeRegisterOptions = {},
  ): number {
    if (this.nodes.has(id)) throw new Error(`Entity already registered: ${id}`);
    const state = this.cloneState(initialState);
    const generation = this.binding.admit(id);
    this.nodes.set(id, {
      state,
      handler: handler as NativeHandler<any>,
      version: 0,
      isWorldNode: options.isWorldNode ?? false,
      dispose: options.dispose,
      nodeInstance: options.nodeInstance,
    });
    this.cachedTopology = undefined;
    this.topologyRevision += 1;
    this.publishProjection();
    this.emitTelemetry({
      type: 'node_admitted',
      nodeId: id,
      generation,
      timestamp: this.clock.monotonicNow(),
    });
    return generation;
  }

  unregister(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    const removed = this.binding.evict(id);
    if (!removed) return false;
    this.nodes.delete(id);
    this.cachedTopology = undefined;
    this.topologyRevision += 1;
    this.queueDisposal(node);
    this.publishProjection();
    this.emitTelemetry({
      type: 'node_evicted',
      nodeId: id,
      timestamp: this.clock.monotonicNow(),
    });
    return true;
  }

  async replace<S extends Record<string, unknown>>(
    id: string,
    initialState: S,
    handler: NativeHandler<S>,
    options: { timeoutMs?: number } = {},
    registration: NativeRegisterOptions = {},
  ): Promise<number> {
    if (!this.nodes.has(id)) throw new Error(`Cannot replace missing entity: ${id}`);
    if (this.replacements.has(id)) throw new Error(`Replace already in progress: ${id}`);
    const preparedState = this.cloneState(initialState);
    const old = this.nodes.get(id)!;
    const deadline = this.clock.monotonicNow() + (options.timeoutMs ?? this.replaceTimeoutMs);
    let swapped = false;
    this.replacements.add(id);
    this.binding.seal(id);
    this.publishProjection();
    try {
      for (;;) {
        try {
          const generation = this.binding.replace(id);
          this.nodes.set(id, {
            state: preparedState,
            handler: handler as NativeHandler<any>,
            version: 0,
            isWorldNode: registration.isWorldNode ?? false,
            dispose: registration.dispose,
            nodeInstance: registration.nodeInstance,
          });
          this.cachedTopology = undefined;
          this.topologyRevision += 1;
          swapped = true;
          this.queueDisposal(old);
          this.publishProjection();
          return generation;
        } catch (error) {
          if (!isBusyError(error) || this.clock.monotonicNow() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
    } finally {
      this.replacements.delete(id);
      if (!swapped) {
        this.binding.unseal(id);
        this.publishProjection();
      }
    }
  }

  readProjection(): GraphProjection {
    return {
      revision: this.projectionRevision,
      nodes: Array.from(this.nodes.entries()).map(([nodeId, node]) => ({
        nodeId,
        state: this.valueCodec.encode(node.state, {
          maxDepth: Number.POSITIVE_INFINITY,
          maxArrayLength: Number.POSITIVE_INFINITY,
          rootPath: [nodeId, '$projection'],
        }),
        version: node.version,
        status: this.activeEntities.has(nodeId) ? 'RUNNING' : 'IDLE',
      })),
      scheduler: {
        pendingDeliveries: this.binding.pendingTotal(),
        activeChanges: this.activeEntities.size,
        scheduledGraphMicrotasks: this.pumpPromise ? 1 : 0,
      },
    };
  }

  subscribeProjection(listener: (projection: GraphProjection) => void): () => void {
    this.projectionListeners.add(listener);
    return () => this.projectionListeners.delete(listener);
  }

  subscribeCausalEvents(listener: (event: CausalTelemetryEvent) => void): () => void {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  private emitTelemetry(event: CausalTelemetryEvent): void {
    if (this.telemetryListeners.size === 0) return;
    for (const listener of this.telemetryListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[NativeRuleSpace] Telemetry listener failed:', error);
      }
    }
  }

  private publishProjection(): void {
    this.projectionRevision += 1;
    const projection = this.readProjection();
    for (const listener of this.projectionListeners) {
      try {
        listener(projection);
      } catch (error) {
        console.error('[NativeRuleSpace] Projection listener failed:', error);
      }
    }
  }

  getState(id: string): Record<string, unknown> | undefined {
    const state = this.nodes.get(id)?.state;
    return state ? this.cloneState(state) : undefined;
  }

  generation(id: string): number | null {
    return this.binding.generation(id);
  }

  admittedEntities(): string[] {
    return this.binding.admittedEntities?.() ?? Array.from(this.nodes.keys());
  }

  readStaticTopology(): StaticTopology {
    if (this.cachedTopology) return this.cachedTopology;
    const admittedList = this.admittedEntities();
    const admitted = new Set(admittedList);
    const activeNodes = Array.from(this.nodes.entries())
      .filter(([id]) => admitted.has(id));

    const routes: StaticTopologyRoute[] = [];
    const seen = new Set<string>();
    for (const [, n] of activeNodes) {
      if (n.nodeInstance) {
        const nodeRoutes = inferNodeStaticRoutes(n.nodeInstance);
        for (const r of nodeRoutes) {
          if (admitted.has(r.from) && admitted.has(r.to)) {
            const key = `${r.from}->${r.to}:${r.infoType}`;
            if (!seen.has(key)) {
              seen.add(key);
              routes.push(r);
            }
          }
        }
      }
    }

    const topology: StaticTopology = {
      revision: this.topologyRevision,
      nodes: activeNodes.map(([nodeId, n]) => ({
        nodeId,
        generation: this.generation(nodeId),
        version: n.version,
        status: this.activeEntities.has(nodeId) ? 'RUNNING' : 'IDLE',
        state: this.cloneState(n.state),
      })),
      routes,
    };

    this.cachedTopology = topology;
    return topology;
  }

  pendingTotal(): number {
    return this.binding.pendingTotal();
  }

  queuedDepths(): Array<{ entity: string; depth: number }> {
    return this.binding.queuedDepths();
  }

  drops(): Array<{ target: string; reason: string; submission?: string }> {
    return this.binding.drops();
  }

  submissionState(submissionId: string): string | null {
    return this.binding.submissionState(submissionId);
  }

  cancel(submissionId: string): boolean {
    const cancelled = this.binding.cancel(submissionId);
    if (cancelled) this.submissionControllers.get(submissionId)?.abort();
    this.publishProjection();
    return cancelled;
  }

  injectRoot(targetNodeId: string, info: NativeInfo, submissionId?: string): string {
    const submission = submissionId ?? this.idProvider.nextId('submission');
    if (!this.submissionControllers.has(submission)) {
      this.submissionControllers.set(submission, new AbortController());
    }
    this.binding.injectRoot(targetNodeId, info.type, splitPayload(info), submission);
    this.publishProjection();
    this.emitTelemetry({
      type: 'root_injected',
      targetNodeId,
      info,
      submissionId: submission,
      timestamp: this.clock.monotonicNow(),
    });
    return submission;
  }

  async waitForSubmission(submissionId: string): Promise<void> {
    for (let rounds = 0; rounds < 10_000; rounds++) {
      await this.pump();
      const state = this.binding.submissionState(submissionId);
      if (state === 'completed') {
        this.submissionControllers.delete(submissionId);
        return;
      }
      if (state === null || state === undefined) {
        throw new Error(`Submission not found: ${submissionId}`);
      }
      if (state === 'cancelled') {
        this.submissionControllers.delete(submissionId);
        const error = new Error(`Submission cancelled: ${submissionId}`);
        error.name = 'AbortError';
        throw error;
      }
      if (state.startsWith('failed:')) {
        throw new Error(state.slice('failed:'.length));
      }
    }
    throw new Error(`Submission did not settle: ${submissionId}`);
  }

  /** Drain every runnable change. Non-reentrant. Returns changes executed. */
  pump(): Promise<number> {
    if (this.pumpPromise) return this.pumpPromise;
    const pending = this.drain();
    this.pumpPromise = pending;
    const clear = () => {
      if (this.pumpPromise === pending) this.pumpPromise = undefined;
    };
    void pending.then(clear, clear);
    return pending;
  }

  private async drain(): Promise<number> {
    try {
      let ran = 0;
      for (;;) {
        const polled = this.binding.pollNext();
        if (!polled) return ran;
        ran++;
        await this.runOne(polled);
      }
    } finally {
      this.publishProjection();
    }
  }

  private makeContext<S>(
    entity: string,
    generation: number,
    node: RegisteredNode,
    changeId: number,
    submission: string | undefined,
  ): NativeChangeContext<S> {
    const space = this;
    const signal = submission ? this.submissionControllers.get(submission)?.signal : undefined;
    const assertCurrent = (): void => {
      signal?.throwIfAborted();
      if (space.nodes.get(entity) !== node || space.binding.generation(entity) !== generation) {
        throw new StaleNativeChangeError(entity);
      }
    };
    return {
      read<K extends keyof S>(key: K): S[K] {
        assertCurrent();
        return node.state[key as string] as S[K];
      },
      write<K extends keyof S>(key: K, value: S[K]): void {
        assertCurrent();
        node.state[key as string] = value;
        node.version += 1;
        space.publishProjection();
        space.emitTelemetry({
          type: 'state_mutated',
          nodeId: entity,
          version: node.version,
          state: space.cloneState(node.state),
          timestamp: space.clock.monotonicNow(),
        });
      },
      patchState(patch: Partial<S>): void {
        assertCurrent();
        Object.assign(node.state, patch);
        node.version += 1;
        space.publishProjection();
        space.emitTelemetry({
          type: 'state_mutated',
          nodeId: entity,
          version: node.version,
          state: space.cloneState(node.state),
          timestamp: space.clock.monotonicNow(),
        });
      },
      send(info: NativeInfo, targetNodeId: string): NativeDeliveryFeedback {
        assertCurrent();
        const feedback = toFeedback(
          space.binding.send(
            entity,
            info.type,
            splitPayload(info),
            targetNodeId,
            changeId,
            submission,
          ),
        );
        space.publishProjection();
        space.emitTelemetry({
          type: 'info_sent',
          fromNodeId: entity,
          toNodeId: targetNodeId,
          info,
          submissionId: submission,
          changeId,
          status: feedback.status,
          timestamp: space.clock.monotonicNow(),
        });
        return feedback;
      },
      async effectAdapter<Request, Observation>(
        adapter: EffectAdapter<Request, Observation>,
        request: Request,
        options: { signal?: AbortSignal } = {},
      ): Promise<Observation> {
        assertCurrent();
        if (!node.isWorldNode) {
          throw new Error(`Pure domain entity cannot execute physical effect: ${entity}`);
        }
        if (!adapter.id.trim()) throw new Error('EffectAdapter id must not be empty');
        const effectSignal = options.signal ?? signal;
        effectSignal?.throwIfAborted();
        const observed = await adapter.execute(request, {
          clock: space.clock,
          signal: effectSignal,
        });
        effectSignal?.throwIfAborted();
        assertCurrent();
        return observed;
      },
      async span<T>(_name: string, action: () => Promise<T> | T): Promise<T> {
        assertCurrent();
        const result = await action();
        assertCurrent();
        return result;
      },
    };
  }

  private async runOne(polled: BindingPolled): Promise<void> {
    const node = this.nodes.get(polled.view.entity);
    if (!node) {
      // Tombstone parity with the TS reference: an evicted in-flight change
      // settles normally (it simply has no JS state left to write to).
      this.binding.settleChange(polled.token, null);
      return;
    }
    const info = joinInfo(polled.view.infoType, polled.view.payloadJson);
    this.activeEntities.add(polled.view.entity);
    this.publishProjection();
    const startTime = this.clock.monotonicNow();
    this.emitTelemetry({
      type: 'change_start',
      nodeId: polled.view.entity,
      info,
      submissionId: polled.view.submission,
      changeId: polled.view.changeId,
      timestamp: startTime,
    });
    const ctx = this.makeContext(
      polled.view.entity,
      polled.view.generation,
      node,
      polled.view.changeId,
      polled.view.submission,
    );
    try {
      await node.handler(info, ctx);
    } catch (error) {
      const signal = polled.view.submission
        ? this.submissionControllers.get(polled.view.submission)?.signal
        : undefined;
      if (signal?.aborted || error instanceof StaleNativeChangeError) {
        this.binding.settleChange(polled.token, null);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.routeErrorAsInfo(polled, info.type, message, stack);
      this.binding.settleChange(polled.token, null);
      return;
    } finally {
      const endTime = this.clock.monotonicNow();
      this.emitTelemetry({
        type: 'change_end',
        nodeId: polled.view.entity,
        submissionId: polled.view.submission,
        changeId: polled.view.changeId,
        durationMs: Math.max(0, endTime - startTime),
        timestamp: endTime,
      });
      this.activeEntities.delete(polled.view.entity);
      this.publishProjection();
    }
    this.binding.settleChange(polled.token, null);
  }

  async dispose(): Promise<void> {
    for (const submissionId of this.submissionControllers.keys()) this.cancel(submissionId);
    for (const id of [...this.nodes.keys()]) this.unregister(id);
    await Promise.allSettled([...this.pendingDisposals]);
    this.projectionListeners.clear();
    this.telemetryListeners.clear();
  }

  private cloneState<S extends Record<string, unknown>>(state: S): S {
    return this.valueCodec.decode(this.valueCodec.encode(state, {
      maxDepth: Number.POSITIVE_INFINITY,
      maxArrayLength: Number.POSITIVE_INFINITY,
    })) as S;
  }

  private queueDisposal(node: RegisteredNode): void {
    if (!node.dispose) return;
    const pending = Promise.resolve().then(node.dispose).then(() => undefined);
    this.pendingDisposals.add(pending);
    void pending.then(
      () => this.pendingDisposals.delete(pending),
      () => this.pendingDisposals.delete(pending),
    );
  }

  private routeErrorAsInfo(
    polled: BindingPolled,
    triggerType: string,
    message: string,
    stack: string | undefined,
  ): void {
    const target = this.errorTargetNodeId;
    if (!target || target === polled.view.entity) return;
    if (triggerType === ERROR_INFO_TYPE) return;
    if (!this.nodes.has(target)) return;
    this.binding.send(
      polled.view.entity,
      ERROR_INFO_TYPE,
      JSON.stringify({
        nodeId: polled.view.entity,
        generation: polled.view.generation,
        changeId: polled.view.changeId,
        submission: polled.view.submission,
        causeInfoType: triggerType,
        message,
        stack,
      }),
      target,
      polled.view.changeId,
      polled.view.submission,
    );
  }
}

/**
 * 纯图无关的静态算符因果推导器：
 * 在 Node 挂载到底座时，直接推导其 change 方法体内所有的内核 ctx.send 潜在出边。
 * 业务开发者 0 声明负担、0 配置文件、无需额外 AST 编译器，直接推导出潜在管网。
 */
export function inferNodeStaticRoutes(node: unknown): StaticTopologyRoute[] {
  if (!node || typeof node !== 'object') return [];
  const fromNodeId = (node as { id?: unknown }).id;
  if (!fromNodeId || typeof fromNodeId !== 'string') return [];

  const changeFn = (node as { change?: unknown }).change;
  if (typeof changeFn !== 'function') return [];
  const fnSource = Function.prototype.toString.call(changeFn);

  const routes: StaticTopologyRoute[] = [];
  const seen = new Set<string>();

  let idx = 0;
  while ((idx = fnSource.indexOf('ctx.send(', idx)) !== -1) {
    const startArgs = idx + 'ctx.send('.length;
    let depth = 1;
    let endArgs = startArgs;
    while (endArgs < fnSource.length && depth > 0) {
      const ch = fnSource[endArgs];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      endArgs++;
    }
    const fullCallArgs = fnSource.slice(startArgs, endArgs - 1);
    idx = endArgs;

    // 分割 info 表达式与 target 表达式（由最外层逗号分隔）
    let argDepth = 0;
    let splitComma = -1;
    for (let i = fullCallArgs.length - 1; i >= 0; i--) {
      const ch = fullCallArgs[i];
      if (ch === ')' || ch === '}' || ch === ']') argDepth++;
      else if (ch === '(' || ch === '{' || ch === '[') argDepth--;
      else if (ch === ',' && argDepth === 0) {
        splitComma = i;
        break;
      }
    }
    if (splitComma === -1) continue;

    const infoPart = fullCallArgs.slice(0, splitComma).trim();
    const targetPart = fullCallArgs.slice(splitComma + 1).trim();

    // 1. 推导 targetNodeId：支持字面量 ('node-sqlite') 与实例属性 (this.taskTargetId)
    let targetNodeId: string | null = null;
    const litMatch = targetPart.match(/^['"`]([^'"`]+)['"`]$/);
    if (litMatch) {
      targetNodeId = litMatch[1];
    } else {
      const propMatch = targetPart.match(/^this\.([a-zA-Z0-9_$]+)$/);
      if (propMatch && propMatch[1] in (node as Record<string, unknown>)) {
        const val = (node as Record<string, unknown>)[propMatch[1]];
        if (typeof val === 'string') targetNodeId = val;
      }
    }

    // 2. 推导 infoType：支持字面量 type: '...' 与局部变量声明推导
    let infoType = 'Info';
    const typeMatch = infoPart.match(/type:\s*['"`]([^'"`]+)['"`]/);
    if (typeMatch) {
      infoType = typeMatch[1];
    } else {
      const varNameMatch = infoPart.match(/^([a-zA-Z0-9_$]+)$/);
      if (varNameMatch) {
        const varName = varNameMatch[1];
        const varDeclMatch = fnSource.slice(0, startArgs).match(
          new RegExp(`(?:const|let|var)\\s+${varName}\\b[\\s\\S]*?type:\\s*['"\`]([^'"\`]+)['"\`]`),
        );
        if (varDeclMatch) {
          infoType = varDeclMatch[1];
        }
      }
    }

    if (targetNodeId) {
      const key = `${fromNodeId}->${targetNodeId}:${infoType}`;
      if (!seen.has(key)) {
        seen.add(key);
        routes.push({
          id: `route-${fromNodeId}-${targetNodeId}-${infoType}`,
          from: fromNodeId,
          to: targetNodeId,
          infoType,
          routeCount: 1,
        });
      }
    }
  }

  return routes;
}

