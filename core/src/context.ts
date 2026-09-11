import type {
  DeliveryFeedback,
  Info,
  InfoEnvelope,
  SpanRecord,
  WorldChangeContext,
} from './types';
import type { StateDelta, EncodedValue } from './observation';
import type { EffectAdapter } from './effects';
import type { Node } from './node';
import { changeContextCapability } from './internal-access';

/**
 * Controlled Causal Context Implementation (ChangeContextImpl)
 */
export class ChangeContextImpl<S = any> implements WorldChangeContext<S> {
  public readonly reads = new Set<string>();
  public readonly writes = new Set<string>();
  public readonly spans: SpanRecord[] = [];
  public readonly stateDeltas: StateDelta[] = [];
  private readonly traceValues = new Map<string, EncodedValue>();

  constructor(
    private node: Node<S, any>,
    private readonly rawInfo: Info,
    private readonly changeId: string,
    private readonly envelope?: InfoEnvelope,
    private readonly signal?: AbortSignal,
  ) {
    const initialState = node.getState();
    if (initialState && typeof initialState === 'object') {
      for (const key of Object.keys(initialState)) {
        this.traceValues.set(
          key,
          this.node.encodeTraceValue(key, initialState[key as keyof S]),
        );
      }
    }
  }

  public read<K extends keyof S>(key: K): S[K] {
    this.signal?.throwIfAborted();
    const keyStr = String(key);
    this.reads.add(keyStr);
    return this.node.getState()[key];
  }

  public write<K extends keyof S>(key: K, value: S[K]): void {
    this.signal?.throwIfAborted();
    const keyStr = String(key);
    this.writes.add(keyStr);
    const before =
      this.traceValues.get(keyStr) ?? this.node.encodeTraceValue(keyStr, undefined);
    const after = this.node.encodeTraceValue(keyStr, value);
    this.node.commitStateFromChange(
      changeContextCapability,
      this.changeId,
      { [key]: value } as any,
      this.rawInfo,
    );
    this.traceValues.set(keyStr, after);
    this.stateDeltas.push({
      ordinal: this.stateDeltas.length + 1,
      field: keyStr,
      before,
      after,
    });
  }

  public patchState(patch: Partial<S>): void {
    this.signal?.throwIfAborted();
    const keys = Object.keys(patch);
    for (const key of keys) {
      this.writes.add(key);
    }
    const beforeValues = new Map(
      keys.map((key) => [
        key,
        this.traceValues.get(key) ?? this.node.encodeTraceValue(key, undefined),
      ]),
    );
    const afterValues = new Map(
      keys.map((key) => [key, this.node.encodeTraceValue(key, patch[key as keyof S])]),
    );
    this.node.commitStateFromChange(
      changeContextCapability,
      this.changeId,
      patch as any,
      this.rawInfo,
    );
    for (const key of keys) {
      const after = afterValues.get(key)!;
      this.traceValues.set(key, after);
      this.stateDeltas.push({
        ordinal: this.stateDeltas.length + 1,
        field: key,
        before: beforeValues.get(key)!,
        after,
      });
    }
  }

  public send(info: Info, target: string): DeliveryFeedback {
    this.signal?.throwIfAborted();
    if (!target) return { status: 'dropped', reason: 'Empty target node id' };
    const infoId = this.node.runtimeId('info');
    return this.node._sendFromChange(changeContextCapability, info, target, {
      infoId,
      causedByChangeId: this.changeId,
      causeInfoId: this.envelope?.infoId,
      submissionId: this.envelope?.submissionId,
      signal: this.signal,
    });
  }

  public async effectAdapter<Request, Observation>(
    adapter: EffectAdapter<Request, Observation>,
    request: Request,
    options: { signal?: AbortSignal } = {},
  ): Promise<Observation> {
    this.signal?.throwIfAborted();
    if (!this.node.isWorldNode) {
      throw new Error(
        `[Architecture Violation]: Pure domain node "${this.node.name}" (${this.node.id}) cannot execute physical effect! Side effects are strictly restricted to World nodes.`,
      );
    }
    if (!adapter.id.trim()) throw new Error('EffectAdapter id 不能为空');
    const signal = options.signal ?? this.signal;
    signal?.throwIfAborted();
    const requestRef = this.node.runtimeValueRef('effect-request', request);
    const name = adapter.id;
    const effectId = this.node.runtimeId('effect');
    this.node.recordEffectRequested({
      effectId,
      changeId: this.changeId,
      nodeId: this.node.id,
      name,
      adapterId: adapter.id,
      requestRef,
    });
    try {
      const result = await adapter.execute(request, {
        clock: {
          now: () => this.node.runtimeNow(),
          monotonicNow: () => this.node.runtimeMonotonicNow(),
        },
        signal,
      });
      signal?.throwIfAborted();
      const observationRef = this.node.runtimeValueRef('effect-observation', result);
      this.node.recordEffectObserved({
        effectId,
        changeId: this.changeId,
        nodeId: this.node.id,
        name,
        status: 'succeeded',
        adapterId: adapter.id,
        requestRef,
        observationRef,
      });
      return result;
    } catch (err) {
      this.node.recordEffectObserved({
        effectId,
        changeId: this.changeId,
        nodeId: this.node.id,
        name,
        status: 'failed',
        adapterId: adapter.id,
        requestRef,
      });
      throw err;
    }
  }

  public async span<T>(name: string, action: () => Promise<T> | T): Promise<T> {
    this.signal?.throwIfAborted();
    const start = this.node.runtimeMonotonicNow();
    const timestamp = this.node.runtimeNow();
    try {
      const result = await action();
      const durationMs = this.node.runtimeMonotonicNow() - start;
      this.spans.push({ name, durationMs, timestamp });
      return result;
    } catch (err) {
      const durationMs = this.node.runtimeMonotonicNow() - start;
      this.spans.push({ name: `${name}:failed`, durationMs, timestamp });
      throw err;
    }
  }
}
