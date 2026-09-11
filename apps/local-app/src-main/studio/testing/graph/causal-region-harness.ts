import {
  KernelRuntime,
  MemoryTraceStore,
  type Info,
  type InfoEnvelope,
  type KernelRuntimeOptions,
  type Node,
  type RuntimeIdKind,
  type TraceEvent,
} from '../@graphvideo/kernel';

export interface CausalRegionHarness {
  readonly runtime: KernelRuntime;
  readonly traceStore: MemoryTraceStore;
  inject(targetNodeId: string, info: Info, submissionId?: string): Promise<void>;
  injectMany(inputs: readonly { targetNodeId: string; info: Info; submissionId?: string }[]): Promise<void>;
  state<S>(nodeId: string): Readonly<S>;
  events(type?: TraceEvent['type']): readonly TraceEvent[];
  deliveredInfos(infoType?: string, targetNodeId?: string): readonly InfoEnvelope[];
  dispose(): Promise<void>;
}

function recentTrace(events: readonly TraceEvent[]): string {
  return events.slice(-16).map((event) => {
    if (event.type === 'ChangeStarted') return `${event.sequence} change ${event.nodeId} <- ${event.causeInfoType}`;
    if (event.type === 'EffectRequested') return `${event.sequence} effect ${event.nodeId} ${event.name ?? event.adapterId ?? ''}`.trim();
    if (event.type === 'EffectObserved') return `${event.sequence} observed ${event.nodeId} ${event.status}`;
    if (event.type === 'InfoEmitted') return `${event.sequence} info ${event.envelope.payload.type} -> ${event.envelope.targetNodeId}`;
    return `${event.sequence} ${event.type}`;
  }).join('\n');
}

/**
 * Composition-based fixture for one causal region. It mounts real Nodes and test
 * adapters, supplies deterministic Runtime IDs, and attaches the local trace to
 * execution failures without requiring a test base class.
 */
export function createCausalRegionHarness(
  nodes: readonly Node<any>[],
  options: KernelRuntimeOptions = {},
): CausalRegionHarness {
  let sequence = 0;
  const traceStore = new MemoryTraceStore();
  const runtime = new KernelRuntime({
    idProvider: options.idProvider ?? {
      nextId: (kind: RuntimeIdKind) => `${kind}-fixture-${++sequence}`,
    },
    ...options,
    traceStore,
  });
  runtime.mount(...nodes);

  return {
    runtime,
    traceStore,
    async inject(targetNodeId: string, info: Info, submissionId = `fixture-submission-${++sequence}`): Promise<void> {
      const result = await runtime.inject({ submissionId, targetNodeId, info });
      if (result.status !== 'accepted') {
        throw new Error(`${result.reason}\n\nLocal causal trace:\n${recentTrace(traceStore.getEvents())}`);
      }
      try {
        await runtime.waitForSubmission(submissionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\n\nLocal causal trace:\n${recentTrace(traceStore.getEvents())}`, { cause: error });
      }
    },
    async injectMany(inputs): Promise<void> {
      for (const input of inputs) {
        await this.inject(input.targetNodeId, input.info, input.submissionId);
      }
    },
    state<S>(nodeId: string): Readonly<S> {
      const node = runtime.getNode(nodeId);
      if (!node) throw new Error(`Causal region does not contain Node: ${nodeId}`);
      return node.getState() as Readonly<S>;
    },
    events(type?: TraceEvent['type']): readonly TraceEvent[] {
      const events = traceStore.getEvents();
      return type ? events.filter((event) => event.type === type) : events;
    },
    deliveredInfos(infoType?: string, targetNodeId?: string): readonly InfoEnvelope[] {
      return traceStore.getEvents()
        .filter((event) => event.type === 'InfoDelivered')
        .map((event) => event.envelope)
        .filter((envelope) => (!infoType || envelope.payload.type === infoType)
          && (!targetNodeId || envelope.targetNodeId === targetNodeId));
    },
    dispose: () => runtime.dispose(),
  };
}
