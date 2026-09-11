/**
 * Minimal Kernel Types & DTOs
 */


export interface Info {
  readonly type: string;
  [key: string]: unknown;
}

export interface InfoEnvelope<TInfo = Info> {
  readonly infoId: string;
  readonly senderNodeId: string;
  readonly targetNodeId: string;
  readonly causedByChangeId?: string;
  readonly causeInfoId?: string;
  readonly submissionId?: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly payload: TInfo;
}

export interface SpanRecord {
  readonly name: string;
  readonly durationMs: number;
  readonly timestamp: number;
}

export interface ChangeRecord {
  readonly changeId: string;
  readonly nodeId: string;
  readonly causeInfoId: string;
  readonly causeInfoType: string;
  readonly causedByChangeId?: string;
  readonly stateVersionBefore: number;
  readonly stateVersionAfter: number;
  readonly reads: string[];
  readonly writes: string[];
  readonly stateDeltas?: import('./observation').StateDelta[];
  readonly spans: SpanRecord[];
  readonly durationMs: number;
  readonly timestamp: number;
  readonly error?: string;
}

export type DeliveryStatus = 'enqueued' | 'dropped';

export interface DeliveryFeedback {
  readonly status: DeliveryStatus;
  readonly reason?: string;
}

export interface NodeStartRequestedInfo extends Info {
  readonly type: '@lifecycle/StartRequested';
  readonly timestamp: number;
}

export interface NodeStopRequestedInfo extends Info {
  readonly type: '@lifecycle/StopRequested';
  readonly reason?: string;
}

export interface NodeErrorInfo extends Info {
  readonly type: '@error/NodeFailed';
  readonly nodeId: string;
  readonly generation: number;
  readonly changeId: string;
  readonly submissionId?: string;
  readonly causeInfoId?: string;
  readonly causeInfoType?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface DomainChangeContext<S = any> {
  read<K extends keyof S>(key: K): S[K];
  write<K extends keyof S>(key: K, value: S[K]): void;
  patchState(patch: Partial<S>): void;
  send(info: Info, targetNodeId: string): DeliveryFeedback;
  span<T>(name: string, action: () => Promise<T> | T): Promise<T>;
}

export interface WorldChangeContext<S = any> extends DomainChangeContext<S> {
  effectAdapter<Request, Observation>(
    adapter: import('./effects').EffectAdapter<Request, Observation>,
    request: Request,
    options?: { signal?: AbortSignal },
  ): Promise<Observation>;
}

export type ChangeContext<S = any> = DomainChangeContext<S>;

export interface Probe {
  onTraceEvent?(event: import('./observation').TraceEvent): void;
  onChangeRecord?(record: ChangeRecord): void;
}

export interface GraphProjectionNode {
  readonly nodeId: string;
  readonly state: any;
  readonly version: number;
  readonly status?: string;
}

export interface GraphProjection {
  readonly revision: number;
  readonly nodes: GraphProjectionNode[];
  readonly scheduler: {
    readonly pendingDeliveries: number;
    readonly activeChanges: number;
    readonly scheduledGraphMicrotasks: number;
  };
}

export interface InjectionResult {
  readonly status: 'accepted' | 'rejected';
  readonly submissionId: string;
  readonly reason?: string;
}

export interface GraphSyscallRequestMap {
  'graph.injectRootInfo': {
    input: { targetNodeId: string; info: Info; submissionId?: string };
    output: InjectionResult & { projection: GraphProjection };
  };
  'graph.cancel': {
    input: { submissionId: string };
    output: { cancelled: boolean };
  };
  'graph.projection.read': {
    input: Record<string, never>;
    output: { projection: GraphProjection };
  };
}

export interface GraphSyscallEventMap {
  'graph.projection.updated': { projection: GraphProjection };
}
