import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultValueCodec,
  systemClock,
  systemRandomSource,
  TimeRandomIdProvider,
} from './observation';
import type { NativeAnalysisEngine, NativeAnalysisRequest } from '../analysis/native-analysis';
import type { FrontendLinkDefinition, FrontendServiceLinkDefinition, PortableAnalysisSnapshot } from '../analysis';
import type {
  Clock,
  IdProvider,
  ValueCodec,
} from './observation';
import type { EffectAdapter } from '../effect/effects';
import type { GraphProjection } from '../protocol/types';

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
  infoId: number;
  causedBy?: number;
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
  shutdown(): void;
  admit(id: string): number;
  evict(id: string): boolean;
  seal(id: string): void;
  unseal(id: string): void;
  replace(id: string): number;
  generation(id: string): number | null;
  setAnalysisFacts(id: string, generation: number, factsJson: string): void;
  analysisFacts(): Array<{ entity: string; factsJson: string }>;
  beginEdit(id: string): number;
  endEdit(id: string, generation: number): boolean;
  abortEdit(id: string): void;
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
  queuedInfos(): Array<{
    infoId: number; sender: string; target: string; infoType: string;
    payloadJson?: string; generation: number; causedBy?: number; submission?: string;
  }>;
  drops(): Array<{ target: string; reason: string; submission?: string }>;
  admittedEntities?(): string[];
}

interface NativeBinding {
  readonly space: BindingSpace;
  readonly analyzeJson: (requestJson: string, factsJson: string) => string;
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
      readonly type: 'agent_info_injected';
      readonly actor: string;
      readonly reason: string;
      readonly targetNodeId: string;
      readonly info: NativeInfo;
      readonly submissionId: string;
      readonly status: NativeDeliveryStatus;
      readonly timestamp: number;
    }
  | {
      readonly type: 'state_intervened';
      readonly actor: string;
      readonly reason: string;
      readonly nodeId: string;
      readonly generation: number;
      readonly versionBefore: number;
      readonly versionAfter: number;
      readonly before: Record<string, unknown>;
      readonly after: Record<string, unknown>;
      readonly timestamp: number;
    }
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
      readonly infoId: number;
      readonly causedByChangeId?: number;
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
  readonly analysisFrontendLinks?: readonly FrontendLinkDefinition[];
  readonly analysisFrontendServiceLinks?: readonly FrontendServiceLinkDefinition[];
}

export type CausalEventRecord = CausalTelemetryEvent & { readonly cursor: number };

export interface StateInterventionOptions {
  readonly actor: string;
  readonly reason: string;
  readonly expectedGeneration: number;
  readonly expectedVersion: number;
  readonly timeoutMs?: number;
}

export interface PendingNativeInfo {
  readonly infoId: number;
  readonly senderNodeId: string;
  readonly targetNodeId: string;
  readonly info: NativeInfo;
  readonly generation: number;
  readonly causedByChangeId?: number;
  readonly submissionId?: string;
}

export interface NativeRegisterOptions {
  readonly isWorldNode?: boolean;
  readonly dispose?: () => void | Promise<void>;
  readonly nodeInstance?: unknown;
  /** Language-neutral facts generated by the Node's own language adapter. */
  readonly analysisFacts?: PortableAnalysisSnapshot;
}

class StaleNativeChangeError extends Error {
  constructor(entity: string) {
    super(`Native change context is stale: ${entity}`);
    this.name = 'StaleNativeChangeError';
  }
}

/** Absolute path of the built native module, if present. */
export function locateNativeBinding(): string | null {
  if (process.env.GRAPHFRAMEWORK_NATIVE_NODE && existsSync(process.env.GRAPHFRAMEWORK_NATIVE_NODE)) {
    return process.env.GRAPHFRAMEWORK_NATIVE_NODE;
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
  const fileName = `graphframework-kernel-node.${platformTag}.node`;
  const candidates = [
    resolve(here, 'native', fileName),
    resolve(here, '..', 'kernel-node', fileName),
    resolve(here, '..', '..', 'packages', 'rust', 'kernel-node', fileName),
    resolve(here, '..', '..', '..', 'packages', 'rust', 'kernel-node', fileName),
    resolve(here, '..', '..', '..', '..', 'packages', 'rust', 'kernel-node', fileName),
    // App standalone tree: app/node_modules/@graphframework/sdk/dist -> repo root packages/rust/kernel-node.
    resolve(here, '..', '..', '..', '..', '..', 'packages', 'rust', 'kernel-node', fileName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadBinding(): NativeBinding {
  const path = locateNativeBinding();
  if (!path) {
    throw new Error(
      'Native rule space not built: run cargo build -p graphframework-kernel-node and copy the cdylib to packages/rust/kernel-node/',
    );
  }
  const require = createRequire(import.meta.url);
  const module = require(path) as {
    RuleSpace: new () => BindingSpace;
    analyzeJson: (requestJson: string, factsJson: string) => string;
  };
  if (typeof module.analyzeJson !== 'function') {
    throw new Error('Native rule space binding is missing the Rust analyzeJson interface');
  }
  return { space: new module.RuleSpace(), analyzeJson: module.analyzeJson };
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
  // Coupled to `KernelError::Busy` Display in packages/rust/kernel/src/error.rs.
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

function encodeAnalysisFacts(id: string, facts?: PortableAnalysisSnapshot): string | undefined {
  if (!facts) return undefined;
  if (facts.version !== 1 || facts.nodeId !== id
    || !Array.isArray(facts.entities) || !Array.isArray(facts.edges)) {
    throw new Error(`Invalid portable analysis facts for Node ${id}`);
  }
  return JSON.stringify(facts);
}

/**
 * JS-hosted business entities, including process-backed Nodes, on the Rust rule space.
 *
 * Scheduling facts (registry, mailboxes, submissions, drops) live in Rust;
 * business State and change bodies live here. Concurrent pump requests
 * share one drain. Replacement seals its target immediately and waits for
 * the active JS change to reach the single-flight gap.
 */
export class NativeRuleSpace {
  private readonly binding: BindingSpace;
  private readonly nativeAnalyzeJson: (requestJson: string, factsJson: string) => string;
  private analysisEngine?: NativeAnalysisEngine;
  private readonly nodes = new Map<string, RegisteredNode>();
  private readonly submissionControllers = new Map<string, AbortController>();
  private readonly projectionListeners = new Set<(projection: GraphProjection) => void>();
  private readonly telemetryListeners = new Set<(event: CausalTelemetryEvent) => void>();
  private readonly causalEvents: CausalEventRecord[] = [];
  private causalCursor = 0;
  private readonly interventions = new Set<string>();
  private readonly activeEntities = new Set<string>();
  private readonly replacements = new Set<string>();
  private readonly pendingDisposals = new Set<Promise<void>>();
  private readonly activeCompletions = new Map<RegisteredNode, Promise<void>>();
  private readonly disposalErrors = new Map<RegisteredNode, unknown>();
  private readonly nodeDisposals = new WeakMap<RegisteredNode, Promise<void>>();
  private readonly evictions = new Map<string, Promise<boolean>>();
  private lifecycle: 'running' | 'closing' | 'closed' = 'running';
  private disposalPromise?: Promise<void>;
  private pumpPromise?: Promise<number>;
  private projectionRevision = 0;
  private topologyRevision = 0;
  private cachedTopology?: StaticTopology;
  private readonly clock: Clock;
  private readonly idProvider: IdProvider;
  private readonly replaceTimeoutMs: number;
  private readonly analysisFrontendLinks: readonly FrontendLinkDefinition[];
  private readonly analysisFrontendServiceLinks: readonly FrontendServiceLinkDefinition[];
  public readonly valueCodec: ValueCodec;
  public errorTargetNodeId?: string;

  constructor(options: NativeRuleSpaceOptions = {}) {
    const native = loadBinding();
    this.binding = native.space;
    this.nativeAnalyzeJson = native.analyzeJson;
    this.errorTargetNodeId = options.errorTargetNodeId;
    this.clock = options.clock ?? systemClock;
    this.idProvider = options.idProvider
      ?? new TimeRandomIdProvider(this.clock, systemRandomSource);
    this.valueCodec = options.valueCodec ?? defaultValueCodec;
    this.replaceTimeoutMs = options.replaceTimeoutMs ?? 5000;
    this.analysisFrontendLinks = options.analysisFrontendLinks ?? [];
    this.analysisFrontendServiceLinks = options.analysisFrontendServiceLinks ?? [];
  }

  register<S extends Record<string, unknown>>(
    id: string,
    initialState: S,
    handler: NativeHandler<S>,
    options: NativeRegisterOptions = {},
  ): number {
    this.assertOpen();
    if (this.evictions.has(id)) throw new Error(`Entity is being evicted: ${id}`);
    if (this.nodes.has(id)) throw new Error(`Entity already registered: ${id}`);
    const factsJson = encodeAnalysisFacts(id, options.analysisFacts);
    const state = this.cloneState(initialState);
    const generation = this.binding.admit(id);
    try {
      if (factsJson !== undefined) this.binding.setAnalysisFacts(id, generation, factsJson);
    } catch (error) {
      this.binding.evict(id);
      throw error;
    }
    this.nodes.set(id, {
      state,
      handler: handler as NativeHandler<any>,
      version: 0,
      isWorldNode: options.isWorldNode ?? false,
      dispose: options.dispose,
      nodeInstance: options.nodeInstance,
    });
    this.analysisEngine?.invalidate();
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
    this.analysisEngine?.invalidate();
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
    this.assertOpen();
    if (this.evictions.has(id)) throw new Error(`Entity is being evicted: ${id}`);
    if (!this.nodes.has(id)) throw new Error(`Cannot replace missing entity: ${id}`);
    if (this.replacements.has(id) || this.interventions.has(id)) {
      throw new Error(`Replace already in progress or State intervention active: ${id}`);
    }
    const preparedState = this.cloneState(initialState);
    const factsJson = encodeAnalysisFacts(id, registration.analysisFacts);
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
          if (factsJson !== undefined) this.binding.setAnalysisFacts(id, generation, factsJson);
          this.nodes.set(id, {
            state: preparedState,
            handler: handler as NativeHandler<any>,
            version: 0,
            isWorldNode: registration.isWorldNode ?? false,
            dispose: registration.dispose,
            nodeInstance: registration.nodeInstance,
          });
          this.analysisEngine?.invalidate();
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
    this.causalEvents.push(this.cloneState({ ...event, cursor: ++this.causalCursor }));
    if (this.causalEvents.length > 1000) this.causalEvents.shift();
    for (const listener of this.telemetryListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[NativeRuleSpace] Telemetry listener failed:', error);
      }
    }
  }

  readCausalEvents(options: { after?: number; limit?: number } = {}): {
    events: CausalEventRecord[];
    nextCursor: number;
    truncated: boolean;
  } {
    const after = options.after ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid causal cursor');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid causal limit');
    const oldest = this.causalEvents[0]?.cursor ?? this.causalCursor + 1;
    const events = this.causalEvents.filter((event) => event.cursor > after)
      .slice(0, limit).map((event) => this.cloneState(event));
    return {
      events,
      nextCursor: events.at(-1)?.cursor ?? after,
      truncated: after < oldest - 1,
    };
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

    const routeCounts = new Map<string, StaticTopologyRoute>();
    for (const { entity, factsJson } of this.binding.analysisFacts()) {
      if (!admitted.has(entity)) continue;
      const facts = JSON.parse(factsJson) as PortableAnalysisSnapshot;
      const entities = new Map(facts.entities.map((item) => [item.address, item]));
      for (const edge of facts.edges) {
        if (edge.type !== 'send') continue;
        const targetInfo = entities.get(edge.to);
        if (targetInfo?.kind !== 'info' || typeof targetInfo.nodeId !== 'string') continue;
        if (!admitted.has(targetInfo.nodeId)) continue;
        const key = `${entity}\0${targetInfo.nodeId}\0${targetInfo.id}`;
        const existing = routeCounts.get(key);
        routeCounts.set(key, existing
          ? { ...existing, routeCount: existing.routeCount + 1 }
          : {
              id: `route-${entity}-${targetInfo.nodeId}-${targetInfo.id}`,
              from: entity,
              to: targetInfo.nodeId,
              infoType: targetInfo.id,
              routeCount: 1,
            });
      }
    }
    const routes = [...routeCounts.values()].sort((left, right) => left.id.localeCompare(right.id));

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

  readPendingInfos(): PendingNativeInfo[] {
    return this.binding.queuedInfos().map((entry) => ({
      infoId: entry.infoId,
      senderNodeId: entry.sender,
      targetNodeId: entry.target,
      info: joinInfo(entry.infoType, entry.payloadJson),
      generation: entry.generation,
      causedByChangeId: entry.causedBy,
      submissionId: entry.submission,
    }));
  }

  /** Query the shared Rust analysis engine over current portable facts. */
  async analyze<T = any>(request: NativeAnalysisRequest): Promise<T> {
    if (!this.analysisEngine) {
      const { NativeAnalysisEngine } = await import('../analysis/native-analysis');
      this.analysisEngine = new NativeAnalysisEngine(this.nativeAnalyzeJson, () => [...this.nodes.entries()].map(([id, node]) => ({
        id, state: node.state, instance: node.nodeInstance,
      })), this.analysisFrontendLinks, this.analysisFrontendServiceLinks, () =>
        this.binding.analysisFacts().map(({ entity, factsJson }) => {
          const facts = JSON.parse(factsJson) as PortableAnalysisSnapshot;
          if (facts.nodeId !== entity) throw new Error(`Analysis facts Node mismatch: ${entity}`);
          return facts;
        }));
    }
    return this.analysisEngine.analyze(request) as T;
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
    this.assertOpen();
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

  /** Trusted host entry: inject any Info without rendererRoots authorization. */
  injectAgentInfo(
    targetNodeId: string,
    info: NativeInfo,
    source: { actor: string; reason: string },
  ): { submissionId: string; feedback: NativeDeliveryFeedback } {
    this.assertOpen();
    if (typeof source?.actor !== 'string' || !source.actor.trim()
      || typeof source.reason !== 'string' || !source.reason.trim()
      || typeof info?.type !== 'string' || !info.type.trim()) {
      throw new Error('Agent injection requires actor, reason and Info.type');
    }
    const submissionId = this.idProvider.nextId('submission');
    if (this.binding.submissionState(submissionId) !== null) {
      throw new Error(`Agent submission ID already exists: ${submissionId}`);
    }
    const payloadJson = splitPayload(info);
    this.submissionControllers.set(submissionId, new AbortController());
    const feedback = toFeedback(this.binding.injectRoot(
      targetNodeId, info.type, payloadJson, submissionId,
    ));
    this.publishProjection();
    this.emitTelemetry({
      type: 'agent_info_injected', actor: source.actor, reason: source.reason,
      targetNodeId, info: this.cloneState(info), submissionId,
      status: feedback.status, timestamp: this.clock.monotonicNow(),
    });
    return { submissionId, feedback };
  }

  /** Privileged, version-checked State patch at the target's single-flight gap. */
  async interveneState(
    nodeId: string,
    patch: Record<string, unknown>,
    options: StateInterventionOptions,
  ): Promise<{ nodeId: string; generation: number; version: number }> {
    this.assertOpen();
    if (typeof options?.actor !== 'string' || !options.actor.trim()
      || typeof options.reason !== 'string' || !options.reason.trim()) {
      throw new Error('State intervention requires actor and reason');
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('State intervention patch must be an object');
    }
    if (!Number.isSafeInteger(options.expectedGeneration) || options.expectedGeneration < 0
      || !Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 0) {
      throw new Error('State intervention requires non-negative expected generation and version');
    }
    if (this.interventions.has(nodeId) || this.replacements.has(nodeId) || this.evictions.has(nodeId)) {
      throw new Error(`State intervention busy: ${nodeId}`);
    }
    const preparedPatch = this.cloneState(patch);
    const deadline = this.clock.monotonicNow() + (options.timeoutMs ?? this.replaceTimeoutMs);
    this.interventions.add(nodeId);
    let generation: number | undefined;
    let result!: { nodeId: string; generation: number; version: number };
    let interventionEvent!: CausalTelemetryEvent;
    try {
      for (;;) {
        try {
          generation = this.binding.beginEdit(nodeId);
          break;
        } catch (error) {
          if (!isBusyError(error) || this.clock.monotonicNow() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
      const node = this.nodes.get(nodeId);
      if (!node || generation !== options.expectedGeneration) {
        throw new Error(`State intervention generation conflict: ${nodeId}`);
      }
      if (node.version !== options.expectedVersion) {
        throw new Error(`State intervention version conflict: ${nodeId}`);
      }
      const before = this.cloneState(node.state);
      const after = this.cloneState({ ...node.state, ...preparedPatch });
      const versionBefore = node.version;
      node.state = after;
      node.version += 1;
      interventionEvent = {
        type: 'state_intervened', actor: options.actor, reason: options.reason,
        nodeId, generation, versionBefore, versionAfter: node.version,
        before, after: this.cloneState(after), timestamp: this.clock.monotonicNow(),
      };
      result = { nodeId, generation, version: node.version };
    } finally {
      const released = generation === undefined
        ? (this.binding.abortEdit(nodeId), true)
        : this.binding.endEdit(nodeId, generation);
      this.interventions.delete(nodeId);
      queueMicrotask(() => {
        const currentPump = this.pumpPromise;
        if (currentPump) void currentPump.then(() => this.pump(), () => this.pump());
        else void this.pump();
      });
      if (!released) throw new Error(`State intervention lease lost: ${nodeId}`);
    }
    this.emitTelemetry(interventionEvent);
    this.publishProjection();
    return result;
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
    if (this.lifecycle === 'closed') return Promise.resolve(0);
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
      if (!space.activeCompletions.has(node) || space.nodes.get(entity) !== node || space.binding.generation(entity) !== generation) {
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
    let finish!: () => void;
    this.activeCompletions.set(node, new Promise<void>((resolve) => { finish = resolve; }));
    this.publishProjection();
    const startTime = this.clock.monotonicNow();
    this.emitTelemetry({
      type: 'change_start',
      nodeId: polled.view.entity,
      infoId: polled.view.infoId,
      causedByChangeId: polled.view.causedBy,
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
      this.activeCompletions.delete(node);
      finish();
      this.publishProjection();
    }
    this.binding.settleChange(polled.token, null);
  }

  /** Seal delivery, wait for this handler, evict its backlog, then await cleanup.
   * A timeout leaves the node sealed; it does not pretend the handler stopped. */
  evict(id: string, options: { timeoutMs?: number } = {}): Promise<boolean> {
    const existing = this.evictions.get(id);
    if (existing) return existing;
    const node = this.nodes.get(id);
    if (!node) return Promise.resolve(false);
    if (this.replacements.has(id) || this.interventions.has(id)) {
      return Promise.reject(new Error(`Entity control operation busy: ${id}`));
    }
    this.binding.seal(id);
    const operation = (async () => {
      const active = this.activeCompletions.get(node);
      if (active) await this.withTimeout(active, options.timeoutMs ?? 5000, `active change: ${id}`);
      const removed = this.unregister(id);
      try {
        await this.withTimeout(this.nodeDisposals.get(node) ?? Promise.resolve(), options.timeoutMs ?? 5000, `cleanup: ${id}`);
      } catch (error) {
        this.disposalErrors.delete(node);
        throw new AggregateError([error], `Node cleanup failed: ${id}`);
      }
      return removed;
    })();
    this.evictions.set(id, operation);
    const clear = () => { if (this.evictions.get(id) === operation) this.evictions.delete(id); };
    void operation.then(clear, clear);
    return operation;
  }

  /** Terminate only after callers have explicitly evicted every node. */
  async waitForDisposals(options: { timeoutMs?: number } = {}): Promise<void> {
    await this.withTimeout(Promise.allSettled([...this.pendingDisposals]), options.timeoutMs ?? 5000, 'cleanup');
    this.throwDisposalErrors();
  }

  /** Terminate only after callers have explicitly evicted every node. */
  async shutdown(): Promise<void> {
    if (this.lifecycle === 'closed') return;
    if (this.nodes.size || this.activeCompletions.size || this.pendingDisposals.size) {
      throw new Error('Cannot shutdown: nodes, active changes or cleanup remain');
    }
    this.binding.shutdown();
    this.lifecycle = 'closed';
    this.submissionControllers.clear();
    this.projectionListeners.clear();
    this.telemetryListeners.clear();
    this.analysisEngine = undefined;
    this.cachedTopology = undefined;
  }

  /** Convenience teardown for owned spaces; business shutdown Info comes first. */
  dispose(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    if (this.lifecycle === 'closed') return Promise.resolve();
    this.lifecycle = 'closing';
    this.disposalPromise = (async () => {
      for (const submissionId of this.submissionControllers.keys()) this.cancel(submissionId);
      const results = await Promise.allSettled([...this.nodes.keys()].map((id) => this.evict(id, options)));
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason);
      try {
        await this.withTimeout(Promise.allSettled([...this.pendingDisposals]), options.timeoutMs ?? 5000, 'cleanup');
        this.throwDisposalErrors();
      } catch (error) { errors.push(error); }
      // Even failed disposers must not leave an otherwise settled kernel running.
      if (!this.nodes.size && !this.activeCompletions.size && !this.pendingDisposals.size) await this.shutdown();
      if (errors.length) throw new AggregateError(errors, 'Rule space cleanup failed');
    })();
    return this.disposalPromise;
  }

  private assertOpen(): void {
    if (this.lifecycle !== 'running') throw new Error('Rule space is closing or closed');
  }

  private throwDisposalErrors(): void {
    if (this.disposalErrors.size) {
      const errors = [...this.disposalErrors.values()];
      this.disposalErrors.clear();
      throw new AggregateError(errors, 'Node cleanup failed');
    }
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  private cloneState<S extends Record<string, unknown>>(state: S): S {
    return this.valueCodec.decode(this.valueCodec.encode(state, {
      maxDepth: Number.POSITIVE_INFINITY,
      maxArrayLength: Number.POSITIVE_INFINITY,
    })) as S;
  }

  private queueDisposal(node: RegisteredNode): void {
    const instance = node.nodeInstance as { _runUnmountSync?: () => void } | undefined;
    try {
      instance?._runUnmountSync?.();
    } catch (error) {
      this.disposalErrors.set(node, error);
      return;
    }
    if (!node.dispose) return;
    const pending = Promise.resolve(this.activeCompletions.get(node)).then(node.dispose).then(() => undefined);
    this.nodeDisposals.set(node, pending);
    this.pendingDisposals.add(pending);
    void pending.then(
      () => this.pendingDisposals.delete(pending),
      (error) => { this.pendingDisposals.delete(pending); this.disposalErrors.set(node, error); },
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
    const errorInfo = {
      type: ERROR_INFO_TYPE,
      nodeId: polled.view.entity,
      generation: polled.view.generation,
      changeId: polled.view.changeId,
      submission: polled.view.submission,
      causeInfoType: triggerType,
      message,
      stack,
    };
    const feedback = toFeedback(this.binding.send(
      polled.view.entity,
      ERROR_INFO_TYPE,
      splitPayload(errorInfo),
      target,
      polled.view.changeId,
      polled.view.submission,
    ));
    this.emitTelemetry({
      type: 'info_sent', fromNodeId: polled.view.entity, toNodeId: target,
      info: errorInfo, submissionId: polled.view.submission,
      changeId: polled.view.changeId, status: feedback.status,
      timestamp: this.clock.monotonicNow(),
    });
  }
}
