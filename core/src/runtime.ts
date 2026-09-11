import type { Node } from './node';
import type {
  Info,
  InfoEnvelope,
  ChangeRecord,
  Probe,
  GraphProjection,
  GraphProjectionNode,
  InjectionResult,
} from './types';
import type {
  Clock,
  IdProvider,
  RandomSource,
  ValueCodec,
  ValueCodecOptions,
  TraceStore,
  RuntimeIdKind,
  StateSnapshot,
  EncodedValue,
  TraceEvent,
} from './observation';
import {
  systemClock,
  systemRandomSource,
  TimeRandomIdProvider,
  defaultValueCodec,
  fnv1a32,
  TraceSession,
} from './observation';
import type { KernelSchedulerSnapshot } from './scheduler';
import {
  computeSchedulerSnapshot,
  publishSchedulerStateHelper,
  scheduleGraphMicrotaskHelper,
  subscribeSchedulerHelper,
  waitForQuiescenceHelper,
} from './scheduler';
import type { KernelDeliveryOptions } from './delivery';
import {
  deliverSendNowHelper,
  injectRootInfoNowHelper,
} from './delivery';
import {
  captureStateSnapshotHelper,
  restoreStateSnapshotHelper,
} from './snapshot';
import { nodeRuntimeCapability } from './internal-access';

export interface KernelRuntimeOptions {
  clock?: Clock;
  idProvider?: IdProvider;
  randomSource?: RandomSource;
  valueCodec?: ValueCodec;
  valueCodecOptions?: ValueCodecOptions;
  traceStore?: TraceStore;
  stateSnapshots?: {
    captureInitial?: boolean;
    everyChanges?: number;
  };
}

type SubmissionOutcome =
  | { status: 'completed' }
  | { status: 'cancelled'; error: Error }
  | { status: 'failed'; error: Error };

interface SubmissionRecord {
  readonly id: string;
  readonly controller: AbortController;
  readonly completion: Promise<SubmissionOutcome>;
  readonly resolve: (outcome: SubmissionOutcome) => void;
  readonly removeExternalAbort: () => void;
  pendingDeliveries: number;
  settled: boolean;
  cancelled: boolean;
  failure?: Error;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

/**
 * Pure In-Process Kernel Runtime Execution Engine
 */
export class KernelRuntime {
  public readonly nodes: Map<string, Node<any>> = new Map();
  public readonly envelopes: InfoEnvelope[] = [];
  public readonly probes: Probe[] = [];

  public readonly clock: Clock;
  public readonly idProvider: IdProvider;
  public readonly randomSource: RandomSource;
  public readonly valueCodec: ValueCodec;
  public readonly valueCodecOptions: ValueCodecOptions;
  public readonly traceStore?: TraceStore;

  public readonly traceSession: TraceSession;
  public logicalClock = 0;

  public pendingDeliveryCount = 0;
  public activeChangeIds: Set<string> = new Set();
  public scheduledGraphMicrotaskCount = 0;
  public schedulerListeners: Set<(state: KernelSchedulerSnapshot) => void> = new Set();
  public scheduledMailboxNodeIds: Set<string> = new Set();
  public projectionListeners: Set<(projection: GraphProjection) => void> = new Set();
  public projectionRevision = 0;
  private readonly submissions = new Map<string, SubmissionRecord>();

  public captureInitialStateSnapshot = true;
  public initialStateSnapshotCaptured = false;
  private isDisposed = false;

  constructor(options: KernelRuntimeOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.randomSource = options.randomSource ?? systemRandomSource;
    this.idProvider =
      options.idProvider ?? new TimeRandomIdProvider(this.clock, this.randomSource);
    this.valueCodec = options.valueCodec ?? defaultValueCodec;
    this.valueCodecOptions = options.valueCodecOptions ?? {};
    this.traceStore = options.traceStore;
    this.captureInitialStateSnapshot =
      options.stateSnapshots?.captureInitial ?? true;

    const traceId = this.idProvider.nextId('trace');
    const runId = this.idProvider.nextId('run');
    this.traceSession = new TraceSession(
      traceId,
      runId,
      this.idProvider,
      this.clock,
      this.traceStore,
    );

    this.traceSession.record({
      type: 'TraceStarted',
      runtimeVersion: '2.0.0-in-process',
    });
  }

  public now(): number {
    return this.clock.now();
  }

  public monotonicNow(): number {
    return this.clock.monotonicNow();
  }

  public nextId(kind: RuntimeIdKind): string {
    return this.idProvider.nextId(kind);
  }

  public mount(...nodes: Node<any>[]): this {
    for (const node of nodes) {
      if (!node.id) throw new Error('挂载节点必须具有非空 id');
      if (this.nodes.has(node.id)) {
        throw new Error(`不能挂载重复的 Node ID: ${node.id}`);
      }
      this.nodes.set(node.id, node);
      node._mountKernel(nodeRuntimeCapability, this);
      node.onMount();
    }
    this.traceSession.record({
      type: 'GraphMounted',
      nodeIds: nodes.map((n) => n.id),
      nodeFactories: Object.fromEntries(nodes.map((n) => [n.id, n.factoryKey])),
    });
    return this;
  }

  public unmount(...nodeIds: string[]): this {
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node._unmountKernel(nodeRuntimeCapability, this);
        node.onUnmount();
        this.nodes.delete(nodeId);
      }
    }
    return this;
  }

  public getNode<T extends Node<any> = Node<any>>(id: string): T | undefined {
    return this.nodes.get(id) as T | undefined;
  }

  public getNodes(): Node<any>[] {
    return Array.from(this.nodes.values());
  }

  /** @internal Called only by a Node's active ChangeContext. */
  public _deliverSendFromChange(
    source: Node<any>,
    info: Info,
    target: Node<any> | string,
    options?: KernelDeliveryOptions,
  ): void {
    deliverSendNowHelper(this, source, info, target, options);
  }

  public injectRootInfo(
    target: Node<any>,
    info: Info,
    options: { signal?: AbortSignal; submissionId?: string } = {},
  ): string {
    const submissionId = options.submissionId ?? this.nextId('submission');
    const submission = this.createSubmission(submissionId, options.signal);
    try {
      injectRootInfoNowHelper(this, target, info, {
        signal: submission.controller.signal,
        submissionId,
      });
    } catch (error) {
      submission.failure = toError(error);
      this.settleSubmissionIfComplete(submission);
      throw error;
    }
    return submissionId;
  }

  public async inject(input: {
    submissionId: string;
    targetNodeId: string;
    info: Info;
    signal?: AbortSignal;
  }): Promise<InjectionResult> {
    const targetNode = this.getNode(input.targetNodeId);
    if (!targetNode) {
      return {
        status: 'rejected',
        submissionId: input.submissionId,
        reason: `Target node not found: ${input.targetNodeId}`,
      };
    }
    try {
      this.injectRootInfo(targetNode, input.info, {
        signal: input.signal,
        submissionId: input.submissionId,
      });
    } catch (error) {
      return {
        status: 'rejected',
        submissionId: input.submissionId,
        reason: toError(error).message,
      };
    }
    return {
      status: 'accepted',
      submissionId: input.submissionId,
    };
  }

  public cancel(submissionId: string): boolean {
    const submission = this.submissions.get(submissionId);
    if (!submission || submission.settled || submission.cancelled) return false;
    submission.cancelled = true;
    const error = new Error(`Submission cancelled: ${submissionId}`);
    error.name = 'AbortError';
    submission.controller.abort(error);
    this.settleSubmissionIfComplete(submission);
    return true;
  }

  public async waitForSubmission(submissionId: string): Promise<void> {
    const submission = this.submissions.get(submissionId);
    if (!submission) throw new Error(`Submission not found: ${submissionId}`);
    const outcome = await submission.completion;
    if (outcome.status !== 'completed') throw outcome.error;
  }

  public trackSubmissionDeliveryEnqueued(submissionId?: string): void {
    if (!submissionId) return;
    const submission = this.submissions.get(submissionId);
    if (!submission || submission.settled) {
      throw new Error(`Submission delivery has no active scope: ${submissionId}`);
    }
    submission.pendingDeliveries += 1;
  }

  public trackSubmissionDeliverySettled(submissionId?: string, error?: unknown): void {
    if (!submissionId) return;
    const submission = this.submissions.get(submissionId);
    if (!submission || submission.settled) return;
    if (error && !submission.failure) {
      submission.failure = toError(error);
      submission.controller.abort(submission.failure);
    }
    submission.pendingDeliveries = Math.max(0, submission.pendingDeliveries - 1);
    this.settleSubmissionIfComplete(submission);
  }

  public snapshot(): StateSnapshot {
    return this.captureStateSnapshot('manual');
  }

  public publishSchedulerState(): void {
    publishSchedulerStateHelper(this);
    this.publishProjection();
  }

  public readProjection(): GraphProjection {
    const nodes: GraphProjectionNode[] = [];
    for (const node of this.nodes.values()) {
      nodes.push({
        nodeId: node.id,
        state: this.valueCodec.encode(node.getState(), {
          ...this.valueCodecOptions,
          // Projection is the renderer's authoritative read model, not a diagnostic
          // summary. Truncating nested state or long collections corrupts otherwise
          // valid DTOs (for example a deep project outline) before they reach the UI.
          maxDepth: Number.POSITIVE_INFINITY,
          maxArrayLength: Number.POSITIVE_INFINITY,
          rootPath: [node.id, '$projection'],
        }),
        version: node.getGlobalStateVersion(),
        status: node.status,
      });
    }
    const scheduler = this.getSchedulerSnapshot();
    return {
      revision: this.projectionRevision,
      scheduler: {
        pendingDeliveries: scheduler.pendingDeliveries,
        activeChanges: scheduler.activeChanges,
        scheduledGraphMicrotasks: scheduler.scheduledGraphMicrotasks,
      },
      nodes,
    };
  }

  public subscribeProjection(
    listener: (projection: GraphProjection) => void,
  ): () => void {
    this.projectionListeners.add(listener);
    return () => {
      this.projectionListeners.delete(listener);
    };
  }

  public publishProjection(): void {
    this.projectionRevision++;
    const projection = this.readProjection();
    for (const listener of this.projectionListeners) {
      try {
        listener(projection);
      } catch (err) {
        console.error('[KernelRuntime] Projection listener error:', err);
      }
    }
  }

  public getSchedulerSnapshot(): KernelSchedulerSnapshot {
    return computeSchedulerSnapshot(this);
  }

  public subscribeScheduler(
    listener: (state: KernelSchedulerSnapshot) => void,
  ): () => void {
    return subscribeSchedulerHelper(this, listener);
  }

  public scheduleMicrotask<T>(task: () => T | Promise<T>): Promise<T> {
    return scheduleGraphMicrotaskHelper(this, task);
  }

  public waitForQuiescence(
    options: { signal?: AbortSignal } = {},
  ): Promise<KernelSchedulerSnapshot> {
    return waitForQuiescenceHelper(this, options);
  }

  public captureStateSnapshot(
    reason: StateSnapshot['reason'] = 'manual',
    nodeIds?: readonly string[],
  ): StateSnapshot {
    const snapshot = captureStateSnapshotHelper(this, reason, nodeIds);
    if (reason === 'initial') this.initialStateSnapshotCaptured = true;
    return snapshot;
  }

  public restoreStateSnapshot(snapshot: StateSnapshot): void {
    restoreStateSnapshotHelper(this, snapshot);
  }

  public ensureInitialStateSnapshot(): void {
    if (!this.captureInitialStateSnapshot || this.initialStateSnapshotCaptured) return;
    this.captureStateSnapshot('initial');
  }

  public encodeTraceValue(nodeId: string, field: string, value: unknown): EncodedValue {
    return this.valueCodec.encode(value, {
      ...this.valueCodecOptions,
      rootPath: [nodeId, field],
    });
  }

  public recordValueRef(kind: string, value: unknown): string {
    const encoded = this.valueCodec.encode(value, {
      ...this.valueCodecOptions,
      maxBytes: 1024,
      rootPath: ['ref', kind],
    });
    return `${kind}:${fnv1a32(JSON.stringify(encoded))}`;
  }

  public beginChangeExecution(changeId: string): void {
    this.activeChangeIds.add(changeId);
    this.publishSchedulerState();
  }

  public endChangeExecution(changeId: string): void {
    this.activeChangeIds.delete(changeId);
    this.publishSchedulerState();
  }

  public recordChangeStarted(input: {
    changeId: string;
    nodeId: string;
    causeInfoId: string;
    causeInfoType: string;
    stateVersionBefore: number;
  }): void {
    this.traceSession.record({
      type: 'ChangeStarted',
      ...input,
    });
  }

  public get causalRecords(): readonly ChangeRecord[] {
    return this.traceSession.records;
  }

  public get events(): readonly TraceEvent[] {
    return this.traceSession.events;
  }

  public recordChange(record: ChangeRecord): void {
    this.traceSession.recordChange(record);
    this.traceSession.record({
      type: 'ChangeCompleted',
      record,
    });
    for (const probe of this.probes) {
      try {
        probe.onChangeRecord?.(record);
      } catch {}
    }
  }

  public recordEffectRequested(input: {
    effectId: string;
    changeId: string;
    nodeId: string;
    name?: string;
    adapterId?: string;
    requestRef?: string;
  }): void {
    this.traceSession.record({
      type: 'EffectRequested',
      ...input,
    });
  }

  public recordEffectObserved(input: {
    effectId: string;
    changeId: string;
    nodeId: string;
    name?: string;
    status: 'succeeded' | 'failed';
    adapterId?: string;
    requestRef?: string;
    observationRef?: string;
  }): void {
    this.traceSession.record({
      type: 'EffectObserved',
      ...input,
    });
  }

  public addProbe(probe: Probe): this {
    this.probes.push(probe);
    return this;
  }

  public removeProbe(probe: Probe): this {
    const idx = this.probes.indexOf(probe);
    if (idx !== -1) this.probes.splice(idx, 1);
    return this;
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (const submission of this.submissions.values()) {
      if (!submission.settled) this.cancel(submission.id);
    }
    for (const node of this.nodes.values()) {
      try {
        await node.dispose();
      } catch (err) {
        console.error(`[KernelRuntime]: Failed to dispose node ${node.id}:`, err);
      }
    }
    this.nodes.clear();
    this.schedulerListeners.clear();
    this.projectionListeners.clear();
    this.probes.length = 0;
    this.traceSession.record({
      type: 'TraceCompleted',
      status: 'completed',
    });
  }

  private createSubmission(id: string, externalSignal?: AbortSignal): SubmissionRecord {
    if (!id.trim()) throw new Error('submissionId 不能为空');
    if (this.submissions.has(id)) throw new Error(`submissionId 已存在: ${id}`);
    const controller = new AbortController();
    let resolve!: (outcome: SubmissionOutcome) => void;
    const completion = new Promise<SubmissionOutcome>((done) => {
      resolve = done;
    });
    const onExternalAbort = () => {
      const record = this.submissions.get(id);
      if (!record || record.settled) return;
      record.cancelled = true;
      controller.abort(externalSignal?.reason);
      this.settleSubmissionIfComplete(record);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const record: SubmissionRecord = {
      id,
      controller,
      completion,
      resolve,
      removeExternalAbort: () => externalSignal?.removeEventListener('abort', onExternalAbort),
      pendingDeliveries: 0,
      settled: false,
      cancelled: false,
    };
    this.submissions.set(id, record);
    if (externalSignal?.aborted) onExternalAbort();
    return record;
  }

  private settleSubmissionIfComplete(submission: SubmissionRecord): void {
    if (submission.settled || submission.pendingDeliveries > 0) return;
    submission.settled = true;
    submission.removeExternalAbort();
    if (submission.cancelled) {
      const error = toError(submission.controller.signal.reason ?? 'Submission cancelled');
      error.name = 'AbortError';
      submission.resolve({ status: 'cancelled', error });
    } else if (submission.failure) {
      submission.resolve({ status: 'failed', error: submission.failure });
    } else {
      submission.resolve({ status: 'completed' });
    }
    if (this.submissions.size > 1_000) {
      const oldestSettled = Array.from(this.submissions.values())
        .find((candidate) => candidate.settled);
      if (oldestSettled) this.submissions.delete(oldestSettled.id);
    }
  }
}

export function createKernelRuntime(options?: KernelRuntimeOptions): KernelRuntime {
  return new KernelRuntime(options);
}
