import type { AnalysisView, ViewHealthReport } from './model';
import { buildDirectedGraph, weaklyConnectedComponents } from './weighted-graph';

function findStronglyConnectedComponents(view: AnalysisView): string[][] {
  const adjacency = new Map<string, Set<string>>(
    Array.from(view.nodes.keys()).map((nodeId) => [nodeId, new Set<string>()]),
  );
  for (const route of view.routes) {
    if (!route.internal) adjacency.get(route.from)?.add(route.to);
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(nodeId: string) {
    indices.set(nodeId, nextIndex);
    lowLinks.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const target of adjacency.get(nodeId) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(target)!));
      }
    }

    if (lowLinks.get(nodeId) === indices.get(nodeId)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== nodeId);
      if (component.length > 1) components.push(component.sort());
    }
  }

  for (const nodeId of Array.from(view.nodes.keys()).sort()) {
    if (!indices.has(nodeId)) visit(nodeId);
  }
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export function analyzeViewHealth(view: AnalysisView): ViewHealthReport {
  const externalRoutes = view.routes.filter((route) => !route.internal);
  const internalRoutes = view.routes.filter((route) => route.internal);
  const nodeCount = view.nodes.size;
  const possibleEdges = nodeCount > 1 ? nodeCount * (nodeCount - 1) : 0;
  const neighborNodeIds = new Set<string>();
  for (const route of externalRoutes) neighborNodeIds.add(`${route.from}->${route.to}`);

  const totalVolume = view.routes.reduce(
    (sum, route) => sum + route.routeCount * 2,
    0,
  );
  const stronglyConnectedComponents = findStronglyConnectedComponents(view);
  const cyclicNodeIds = [...new Set(stronglyConnectedComponents.flat())].sort();
  const cyclicNodeSet = new Set(cyclicNodeIds);
  const directedGraph = buildDirectedGraph(
    view.nodes.keys(),
    externalRoutes.map((route) => ({ from: route.from, to: route.to, weight: route.routeCount })),
  );
  const directedPairs = new Set(externalRoutes.map((route) => `${route.from}\0${route.to}`));
  const unorderedPairs = new Set<string>();
  let reciprocalPairs = 0;
  for (const route of externalRoutes) {
    const key = route.from < route.to
      ? `${route.from}\0${route.to}`
      : `${route.to}\0${route.from}`;
    if (unorderedPairs.has(key)) continue;
    unorderedPairs.add(key);
    if (directedPairs.has(`${route.to}\0${route.from}`)) reciprocalPairs += 1;
  }

  const nodes = Array.from(view.nodes.values()).map((node) => {
    const internal = node.internal.reduce((sum, route) => sum + route.routeCount, 0);
    const inbound = node.inbound.reduce((sum, route) => sum + route.routeCount, 0);
    const outbound = node.outbound.reduce((sum, route) => sum + route.routeCount, 0);
    const total = internal + inbound + outbound;
    const inboundNeighbors = new Set(node.inbound.map((route) => route.from)).size;
    const outboundNeighbors = new Set(node.outbound.map((route) => route.to)).size;
    const coupling = inboundNeighbors + outboundNeighbors;
    const volume = internal * 2 + inbound + outbound;
    const conductanceDenominator = Math.min(volume, totalVolume - volume);
    return {
      nodeId: node.id,
      sourceNodeCount: node.sourceNodeIds.length,
      internalRoutes: internal,
      inboundRoutes: inbound,
      outboundRoutes: outbound,
      inboundNeighbors,
      outboundNeighbors,
      afferentCoupling: inboundNeighbors,
      efferentCoupling: outboundNeighbors,
      instability: coupling === 0 ? 0 : outboundNeighbors / coupling,
      conductance: conductanceDenominator <= 0 ? 0 : (inbound + outbound) / conductanceDenominator,
      boundaryRatio: total === 0 ? 0 : (inbound + outbound) / total,
      cohesion: total === 0 ? 0 : internal / total,
      directionalBalance: inbound + outbound === 0
        ? 1
        : 1 - Math.abs(inbound - outbound) / (inbound + outbound),
      cycleMember: cyclicNodeSet.has(node.id),
    };
  }).sort((a, b) => {
    const aBoundary = a.inboundRoutes + a.outboundRoutes;
    const bBoundary = b.inboundRoutes + b.outboundRoutes;
    return bBoundary - aBoundary || a.nodeId.localeCompare(b.nodeId);
  });

  return {
    viewId: view.id,
    nodeCount,
    routeCount: view.routes.reduce((sum, route) => sum + route.routeCount, 0),
    internalRouteCount: internalRoutes.reduce((sum, route) => sum + route.routeCount, 0),
    externalRouteCount: externalRoutes.reduce((sum, route) => sum + route.routeCount, 0),
    density: possibleEdges === 0 ? 0 : neighborNodeIds.size / possibleEdges,
    reciprocity: unorderedPairs.size === 0 ? 0 : reciprocalPairs / unorderedPairs.size,
    isolatedNodeIds: nodes
      .filter((node) => node.internalRoutes + node.inboundRoutes + node.outboundRoutes === 0)
      .map((node) => node.nodeId),
    sourceNodeIds: directedGraph.vertices.filter((nodeId) => (
      directedGraph.inbound.get(nodeId)!.size === 0 && directedGraph.outbound.get(nodeId)!.size > 0
    )),
    sinkNodeIds: directedGraph.vertices.filter((nodeId) => (
      directedGraph.outbound.get(nodeId)!.size === 0 && directedGraph.inbound.get(nodeId)!.size > 0
    )),
    weaklyConnectedComponents: weaklyConnectedComponents(directedGraph),
    cyclicNodeIds,
    stronglyConnectedComponents,
    nodes,
  };
}
