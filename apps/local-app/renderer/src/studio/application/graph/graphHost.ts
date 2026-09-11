import type {
  GraphProjection,
  GraphSyscallEventMap,
  GraphSyscallRequestMap,
  Info,
} from '@graphvideo/kernel';
import type { ApplicationState } from '../../core/state/types';
import {
  applicationStateFromGraphProjection,
  historyFromGraphProjection,
  initialKernelApplicationState,
  type KernelHistoryReadModel,
} from './application-state-projection';

export interface GraphKernelBridge {
  request<K extends keyof GraphSyscallRequestMap>(
    method: K,
    input: GraphSyscallRequestMap[K]['input'],
  ): Promise<GraphSyscallRequestMap[K]['output']>;
  subscribe<K extends keyof GraphSyscallEventMap>(
    event: K,
    listener: (payload: GraphSyscallEventMap[K]) => void,
  ): () => void;
}

export interface GraphStateProjection {
  read(): ApplicationState;
  readGraph(): GraphProjection | null;
  subscribe(listener: () => void): () => void;
}

export interface GraphHost {
  readonly projection: GraphStateProjection;
  readonly history: { read(): KernelHistoryReadModel };
  connect(): Promise<void>;
  injectRootInfo(
    targetNodeId: string,
    info: Info,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  cancel(submissionId: string): Promise<boolean>;
  dispose(): void;
}

export interface KernelApplicationGraphHostOptions {
  readonly nextSubmissionId?: () => string;
}

/** Renderer-side command/projection adapter. It never executes Node.change locally. */
export class KernelApplicationGraphHost implements GraphHost {
  readonly projection: GraphStateProjection;
  readonly history: { read(): KernelHistoryReadModel };
  private graphProjection: GraphProjection | null = null;
  private applicationState = initialKernelApplicationState();
  private readonly listeners = new Set<() => void>();
  private unsubscribeProjection: (() => void) | null = null;
  private submissionSequence = 0;
  private readonly nextSubmissionId: () => string;

  constructor(
    private readonly bridge: GraphKernelBridge,
    options: KernelApplicationGraphHostOptions = {},
  ) {
    this.nextSubmissionId =
      options.nextSubmissionId ??
      (() => `studio/${++this.submissionSequence}/${crypto.randomUUID()}`);
    this.projection = {
      read: () => this.applicationState,
      readGraph: () => this.graphProjection,
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
    this.history = {
      read: () => historyFromGraphProjection(this.graphProjection),
    };
  }

  async connect() {
    if (!this.unsubscribeProjection) {
      this.unsubscribeProjection = this.bridge.subscribe(
        'graph.projection.updated',
        ({ projection }) => {
          this.acceptProjection(projection);
        },
      );
    }
    const { projection } = await this.bridge.request('graph.projection.read', {});
    this.acceptProjection(projection);
  }

  async injectRootInfo(
    targetNodeId: string,
    info: Info,
    options: { signal?: AbortSignal } = {},
  ) {
    options.signal?.throwIfAborted();
    const submissionId = this.nextSubmissionId();
    const cancel = () => {
      void this.bridge.request('graph.cancel', { submissionId });
    };
    const execution = this.bridge.request('graph.injectRootInfo', {
      submissionId,
      targetNodeId,
      info,
    });
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await execution;
      if (result.status !== 'accepted') {
        throw new Error(result.reason ?? `Root Info 注入失败: ${result.status}`);
      }
      this.acceptProjection(result.projection);
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  async cancel(submissionId: string) {
    const result = await this.bridge.request('graph.cancel', {
      submissionId,
    });
    return result.cancelled;
  }

  dispose() {
    this.unsubscribeProjection?.();
    this.unsubscribeProjection = null;
    this.listeners.clear();
  }

  private acceptProjection(projection: GraphProjection) {
    const rev = projection.revision;
    const currentRev = this.graphProjection?.revision ?? -1;
    if (this.graphProjection && rev <= currentRev) return;
    this.graphProjection = projection;
    this.applicationState = applicationStateFromGraphProjection(projection);
    this.listeners.forEach((listener) => listener());
  }
}
