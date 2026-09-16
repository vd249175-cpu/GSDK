import type { ChangeRecord, InfoEnvelope } from '../protocol/types';
import type { EncodedValue } from '../protocol/codec';
export { ValueCodec, defaultValueCodec } from '../protocol/codec';
export type { EncodedValue, ValueCodecOptions } from '../protocol/codec';
export const traceSchemaVersion = 2 as const;

export type TraceId = string;
export type RunId = string;
export type EventId = string;
export type RuntimeIdKind =
  | 'trace'
  | 'run'
  | 'event'
  | 'info'
  | 'info-root'
  | 'send'
  | 'change'
  | 'effect'
  | 'snapshot'
  | 'submission'
  | 'task';

export interface Clock {
  now(): number;
  monotonicNow(): number;
}

export interface IdProvider {
  nextId(kind: RuntimeIdKind): string;
}

export interface RandomSource {
  next(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonicNow: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

export const systemRandomSource: RandomSource = {
  next: () => Math.random(),
};

export class TimeRandomIdProvider implements IdProvider {
  private counter = 0;
  constructor(
    private clock: Clock = systemClock,
    private randomSource: RandomSource = systemRandomSource,
  ) {}

  nextId(kind: RuntimeIdKind): string {
    const timestamp = this.clock.now();
    const count = ++this.counter;
    const random = Math.floor(this.randomSource.next() * 0x1_0000).toString(16).padStart(4, '0');
    return `${kind}-${timestamp}-${count}-${random}`;
  }
}

export function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface StateDelta {
  readonly ordinal: number;
  readonly field: string;
  readonly before: EncodedValue;
  readonly after: EncodedValue;
}

export interface NodeStateSnapshot {
  readonly nodeId: string;
  readonly factoryKey: string;
  readonly state: EncodedValue;
  readonly globalVersion: number;
  readonly regionVersions: Record<string, number>;
}

export interface StateSnapshot {
  readonly snapshotId: string;
  readonly traceId: TraceId;
  readonly runId: RunId;
  readonly capturedAt: number;
  readonly reason: 'initial' | 'mounted' | 'checkpoint' | 'manual';
  readonly nodes: NodeStateSnapshot[];
}

export interface TraceEventBase {
  readonly schemaVersion: typeof traceSchemaVersion;
  readonly traceId: TraceId;
  readonly runId: RunId;
  readonly eventId: EventId;
  readonly sequence: number;
  readonly timestamp: number;
}

export type TraceEventPayload =
  | { type: 'TraceStarted'; graphFingerprint?: string; runtimeVersion: string }
  | { type: 'GraphMounted'; nodeIds: string[]; nodeFactories: Record<string, string> }
  | { type: 'StateSnapshotCaptured'; snapshot: StateSnapshot }
  | { type: 'StateSnapshotRestored'; snapshotId: string; nodeIds: string[] }
  | { type: 'InfoEmitted'; envelope: InfoEnvelope }
  | { type: 'InfoDelivered'; envelope: InfoEnvelope }
  | { type: 'InfoDropped'; nodeId: string; reason: string; count: number }
  | { type: 'NodeErrorRecorded'; nodeId: string; generation: number; changeId: string; submissionId?: string; causeInfoId: string; causeInfoType: string; message: string }
  | { type: 'BoundaryOutputCaptured'; fragmentId: string; envelope: InfoEnvelope }
  | { type: 'FragmentBoundaryViolation'; fragmentId: string; sourceNodeId: string; targetNodeId: string; infoType: string }
  | { type: 'ChangeStarted'; changeId: string; nodeId: string; causeInfoId: string; causeInfoType: string; stateVersionBefore: number }
  | { type: 'StateDeltaCommitted'; changeId: string; nodeId: string; stateVersionAfter: number; deltas: StateDelta[] }
  | { type: 'EffectRequested'; effectId: string; changeId: string; nodeId: string; name?: string; adapterId?: string; requestRef?: string }
  | { type: 'WorldEffectRejected'; fragmentId: string; effectId: string; changeId: string; nodeId: string; name?: string; adapterId?: string; requestRef?: string }
  | { type: 'EffectObserved'; effectId: string; changeId: string; nodeId: string; name?: string; status: 'succeeded' | 'failed'; adapterId?: string; requestRef?: string; observationRef?: string }
  | { type: 'ChangeCompleted'; record: ChangeRecord }
  | { type: 'TraceCompleted'; status: 'completed' | 'failed'; error?: string };

export type TraceEvent = TraceEventBase & TraceEventPayload;

export interface TraceStore {
  append(event: TraceEvent): Promise<void> | void;
  getEvents?(traceId?: string): Promise<TraceEvent[]> | TraceEvent[];
}

export class MemoryTraceStore implements TraceStore {
  private events: TraceEvent[] = [];
  append(event: TraceEvent): void {
    this.events.push(event);
  }
  getEvents(): TraceEvent[] {
    return [...this.events];
  }
  clear(): void {
    this.events = [];
  }
}

export class TraceSession {
  public sequence = 0;
  public readonly events: TraceEvent[] = [];
  public readonly records: ChangeRecord[] = [];

  constructor(
    public readonly traceId: string,
    public readonly runId: string,
    private idProvider: IdProvider,
    private clock: Clock,
    private traceStore?: TraceStore,
  ) {}

  record(payload: TraceEventPayload): TraceEvent {
    const event: TraceEvent = {
      schemaVersion: traceSchemaVersion,
      traceId: this.traceId,
      runId: this.runId,
      eventId: this.idProvider.nextId('event'),
      sequence: ++this.sequence,
      timestamp: this.clock.now(),
      ...payload,
    };
    this.events.push(event);
    if (this.traceStore) {
      try {
        this.traceStore.append(event);
      } catch {}
    }
    return event;
  }

  recordChange(record: ChangeRecord): void {
    this.records.push(record);
  }
}

export function applyStateDeltas(
  encodedState: EncodedValue,
  deltas: readonly StateDelta[],
): EncodedValue {
  if (
    typeof encodedState !== 'object' ||
    encodedState === null ||
    encodedState.$type !== 'object'
  ) {
    throw new Error('StateDelta 只能应用到对象 State Snapshot');
  }
  const value = { ...encodedState.value };
  for (const delta of deltas) {
    const current = value[delta.field];
    if (JSON.stringify(current) !== JSON.stringify(delta.before)) {
      throw new Error(`StateDelta 基线不匹配: ${delta.field}#${delta.ordinal}`);
    }
    value[delta.field] = delta.after;
  }
  return { $type: 'object', value };
}
