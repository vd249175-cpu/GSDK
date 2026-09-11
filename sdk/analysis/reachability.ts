import type { AnalysisView, ViewReachabilityReport } from './model';

function distancesFrom(
  origin: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const distances = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of [...(adjacency.get(current) ?? [])].sort()) {
      if (distances.has(target)) continue;
      distances.set(target, distances.get(current)! + 1);
      queue.push(target);
    }
  }
  distances.delete(origin);
  return distances;
}

export function analyzeViewReachability(
  view: AnalysisView,
  originNodeId: string,
): ViewReachabilityReport {
  if (!view.nodes.has(originNodeId)) throw new Error(`Node not found in view ${view.id}: ${originNodeId}`);
  const outbound = new Map<string, Set<string>>(
    Array.from(view.nodes.keys()).map((nodeId) => [nodeId, new Set<string>()]),
  );
  const inbound = new Map<string, Set<string>>(
    Array.from(view.nodes.keys()).map((nodeId) => [nodeId, new Set<string>()]),
  );
  for (const route of view.routes) {
    if (route.internal) continue;
    outbound.get(route.from)?.add(route.to);
    inbound.get(route.to)?.add(route.from);
  }
  const upstreamDistances = distancesFrom(originNodeId, inbound);
  const downstreamDistances = distancesFrom(originNodeId, outbound);
  const sortDistances = (entries: Iterable<[string, number]>) => [...entries]
    .map(([nodeId, distance]) => ({ nodeId, distance }))
    .sort((a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId));
  return {
    viewId: view.id,
    originNodeId,
    upstream: sortDistances(upstreamDistances),
    downstream: sortDistances(downstreamDistances),
    unreachableNodeIds: Array.from(view.nodes.keys()).filter((nodeId) => (
      nodeId !== originNodeId
      && !upstreamDistances.has(nodeId)
      && !downstreamDistances.has(nodeId)
    )).sort(),
  };
}
