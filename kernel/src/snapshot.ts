import type { Node } from './node';
import type {
  StateSnapshot,
  EncodedValue,
  ValueCodec,
  ValueCodecOptions,
  TraceSession,
  RuntimeIdKind,
} from './observation';
import { nodeRuntimeCapability } from './internal-access';
export { applyStateDeltas } from './observation';

export interface SnapshotKernelContext {
  nodes: Map<string, Node<any>>;
  valueCodec: ValueCodec;
  valueCodecOptions: ValueCodecOptions;
  traceSession: TraceSession;
  now(): number;
  nextId(kind: RuntimeIdKind): string;
}

export function encodeTraceValueHelper(
  ctx: SnapshotKernelContext,
  nodeId: string,
  field: string,
  value: unknown,
): EncodedValue {
  return ctx.valueCodec.encode(value, {
    ...ctx.valueCodecOptions,
    rootPath: [nodeId, field],
  });
}

export function captureStateSnapshotHelper(
  ctx: SnapshotKernelContext,
  reason: StateSnapshot['reason'] = 'manual',
  nodeIds?: readonly string[],
): StateSnapshot {
  const selectedNodes = (
    nodeIds
      ? nodeIds.map((nodeId) => {
          const node = ctx.nodes.get(nodeId);
          if (!node) throw new Error(`State Snapshot 找不到 Node: ${nodeId}`);
          return node;
        })
      : [...ctx.nodes.values()]
  ).sort((left, right) => left.id.localeCompare(right.id));

  const snapshot: StateSnapshot = {
    snapshotId: ctx.nextId('snapshot'),
    traceId: ctx.traceSession.traceId,
    runId: ctx.traceSession.runId,
    capturedAt: ctx.now(),
    reason,
    nodes: selectedNodes.map((node) => ({
      nodeId: node.id,
      factoryKey: node.factoryKey,
      state: ctx.valueCodec.encode(node.getState(), {
        ...ctx.valueCodecOptions,
        rootPath: [node.id, '$state'],
      }),
      globalVersion: node.getGlobalStateVersion(),
      regionVersions: { ...node.getStateRegionVersions() },
    })),
  };
  ctx.traceSession.record({ type: 'StateSnapshotCaptured', snapshot });
  return snapshot;
}

export function restoreStateSnapshotHelper(
  ctx: SnapshotKernelContext,
  snapshot: StateSnapshot,
): void {
  const restored = snapshot.nodes.map((nodeSnapshot) => {
    const node = ctx.nodes.get(nodeSnapshot.nodeId);
    if (!node) throw new Error(`State Snapshot 找不到已挂载 Node: ${nodeSnapshot.nodeId}`);
    if (node.factoryKey !== nodeSnapshot.factoryKey) {
      throw new Error(
        `State Snapshot 工厂不匹配: ${node.id} 期望 ${node.factoryKey}，实际 ${nodeSnapshot.factoryKey}`,
      );
    }
    if (!Number.isSafeInteger(nodeSnapshot.globalVersion) || nodeSnapshot.globalVersion < 0) {
      throw new Error(`State Snapshot globalVersion 非法: ${node.id}`);
    }
    for (const [region, version] of Object.entries(nodeSnapshot.regionVersions)) {
      if (!region || !Number.isSafeInteger(version) || version < 0) {
        throw new Error(`State Snapshot regionVersion 非法: ${node.id}.${region}`);
      }
    }
    return { node, nodeSnapshot, state: ctx.valueCodec.decode(nodeSnapshot.state) };
  });

  for (const item of restored) {
    item.node._restoreStateSnapshot(nodeRuntimeCapability, item.nodeSnapshot, item.state);
  }

  ctx.traceSession.record({
    type: 'StateSnapshotRestored',
    snapshotId: snapshot.snapshotId,
    nodeIds: restored.map(({ node }) => node.id),
  });
}
