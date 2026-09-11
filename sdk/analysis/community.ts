import type { AnalysisView, CausalIndex, CommunityResult } from './model';
import { buildUndirectedGraph, type WeightedEdge, type WeightedUndirectedGraph } from './weighted-graph';

export interface CommunityDiscoveryOptions {
  modularityResolution?: number;
  maxLevels?: number;
  maxPasses?: number;
  minimumGain?: number;
}

interface LocalMoveResult {
  assignment: Map<string, string>;
  passes: number;
  moves: number;
}

function modularity(
  graph: WeightedUndirectedGraph,
  assignment: ReadonlyMap<string, string>,
  resolution: number,
): number {
  const m = graph.totalEdgeWeight;
  if (m <= 0) return 0;
  const internalWeight = new Map<string, number>();
  const totalDegree = new Map<string, number>();
  for (const vertex of graph.vertices) {
    const community = assignment.get(vertex)!;
    totalDegree.set(community, (totalDegree.get(community) ?? 0) + graph.degree.get(vertex)!);
  }
  for (const edge of graph.edges) {
    const fromCommunity = assignment.get(edge.from)!;
    if (fromCommunity === assignment.get(edge.to)) {
      internalWeight.set(fromCommunity, (internalWeight.get(fromCommunity) ?? 0) + edge.weight);
    }
  }
  let value = 0;
  for (const community of totalDegree.keys()) {
    value += (internalWeight.get(community) ?? 0) / m
      - resolution * ((totalDegree.get(community) ?? 0) / (2 * m)) ** 2;
  }
  return value;
}

function localMove(
  graph: WeightedUndirectedGraph,
  resolution: number,
  maxPasses: number,
  epsilon: number,
): LocalMoveResult {
  const assignment = new Map(graph.vertices.map((vertex) => [vertex, vertex]));
  const communityDegree = new Map(graph.vertices.map((vertex) => [vertex, graph.degree.get(vertex)!]));
  const m = graph.totalEdgeWeight;
  let totalMoves = 0;
  let passes = 0;
  if (m <= 0) return { assignment, passes, moves: totalMoves };

  for (; passes < maxPasses; passes += 1) {
    let passMoves = 0;
    for (const vertex of graph.vertices) {
      const oldCommunity = assignment.get(vertex)!;
      const vertexDegree = graph.degree.get(vertex)!;
      const weightsByCommunity = new Map<string, number>();
      for (const [neighbor, weight] of graph.adjacency.get(vertex)!) {
        const community = assignment.get(neighbor)!;
        weightsByCommunity.set(community, (weightsByCommunity.get(community) ?? 0) + weight);
      }

      communityDegree.set(oldCommunity, (communityDegree.get(oldCommunity) ?? 0) - vertexDegree);
      const removeCost = -(weightsByCommunity.get(oldCommunity) ?? 0) / m
        + resolution * ((communityDegree.get(oldCommunity) ?? 0) * vertexDegree) / (2 * m * m);
      let bestCommunity = oldCommunity;
      let bestGain = 0;
      const candidates = new Set([...weightsByCommunity.keys(), oldCommunity]);
      for (const community of [...candidates].sort()) {
        const gain = removeCost
          + (weightsByCommunity.get(community) ?? 0) / m
          - resolution * ((communityDegree.get(community) ?? 0) * vertexDegree) / (2 * m * m);
        if (
          gain > bestGain + epsilon
          || (gain > epsilon && Math.abs(gain - bestGain) <= epsilon && community < bestCommunity)
        ) {
          bestGain = gain;
          bestCommunity = community;
        }
      }
      assignment.set(vertex, bestCommunity);
      communityDegree.set(bestCommunity, (communityDegree.get(bestCommunity) ?? 0) + vertexDegree);
      if (bestCommunity !== oldCommunity) passMoves += 1;
    }
    totalMoves += passMoves;
    if (passMoves === 0) {
      passes += 1;
      break;
    }
  }
  return { assignment, passes, moves: totalMoves };
}

function groupsFromAssignment(
  graph: WeightedUndirectedGraph,
  assignment: ReadonlyMap<string, string>,
  members: ReadonlyMap<string, string[]>,
): Array<{ currentVertices: string[]; originalMembers: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const vertex of graph.vertices) {
    const community = assignment.get(vertex)!;
    const vertices = grouped.get(community) ?? [];
    vertices.push(vertex);
    grouped.set(community, vertices);
  }
  return [...grouped.values()].map((currentVertices) => ({
    currentVertices: currentVertices.sort(),
    originalMembers: currentVertices.flatMap((vertex) => members.get(vertex) ?? []).sort(),
  })).sort((a, b) => (
    b.originalMembers.length - a.originalMembers.length
    || a.originalMembers[0].localeCompare(b.originalMembers[0])
  ));
}

function assignmentFromGroups(groups: Array<{ originalMembers: string[] }>): Map<string, string> {
  const assignment = new Map<string, string>();
  groups.forEach((group, index) => {
    group.originalMembers.forEach((member) => assignment.set(member, `community-${index + 1}`));
  });
  return assignment;
}

function aggregateGraph(
  graph: WeightedUndirectedGraph,
  groups: Array<{ currentVertices: string[]; originalMembers: string[] }>,
  level: number,
): { graph: WeightedUndirectedGraph; members: Map<string, string[]> } {
  const currentToAggregate = new Map<string, string>();
  const members = new Map<string, string[]>();
  groups.forEach((group, index) => {
    const id = `level-${level}-community-${index + 1}`;
    group.currentVertices.forEach((vertex) => currentToAggregate.set(vertex, id));
    members.set(id, group.originalMembers);
  });
  return {
    graph: buildUndirectedGraph(
      members.keys(),
      graph.edges.map((edge) => ({
        from: currentToAggregate.get(edge.from)!,
        to: currentToAggregate.get(edge.to)!,
        weight: edge.weight,
      })),
    ),
    members,
  };
}

function discover(
  viewId: string,
  resultResolution: CommunityResult['resolution'],
  vertexIds: string[],
  sourceEdges: WeightedEdge[],
  options: CommunityDiscoveryOptions,
): CommunityResult {
  const modularityResolution = options.modularityResolution ?? 1;
  const maxLevels = options.maxLevels ?? 20;
  const maxPasses = options.maxPasses ?? 50;
  const minimumGain = options.minimumGain ?? 1e-10;
  if (!(modularityResolution > 0) || !Number.isFinite(modularityResolution)) {
    throw new Error(`modularityResolution 必须是正数: ${modularityResolution}`);
  }

  const originalGraph = buildUndirectedGraph(vertexIds, sourceEdges);
  let graph = originalGraph;
  let members = new Map(graph.vertices.map((vertex) => [vertex, [vertex]]));
  let finalGroups = graph.vertices.map((vertex) => ({ currentVertices: [vertex], originalMembers: [vertex] }));
  let previousModularity = modularity(
    originalGraph,
    new Map(originalGraph.vertices.map((vertex) => [vertex, vertex])),
    modularityResolution,
  );
  const levels: CommunityResult['levels'] = [];

  for (let level = 0; level < maxLevels; level += 1) {
    const moved = localMove(graph, modularityResolution, maxPasses, minimumGain);
    const groups = groupsFromAssignment(graph, moved.assignment, members);
    const originalAssignment = assignmentFromGroups(groups);
    const levelModularity = modularity(originalGraph, originalAssignment, modularityResolution);
    if (levels.length > 0 && levelModularity <= previousModularity + minimumGain) break;
    finalGroups = groups;
    previousModularity = levelModularity;
    levels.push({
      level,
      communityCount: groups.length,
      modularity: levelModularity,
      passes: moved.passes,
      moves: moved.moves,
      communities: groups.map((group) => group.originalMembers),
    });
    if (groups.length === graph.vertices.length || groups.length <= 1) break;
    const aggregated = aggregateGraph(graph, groups, level + 1);
    graph = aggregated.graph;
    members = aggregated.members;
  }

  if (levels.length === 0) {
    levels.push({
      level: 0,
      communityCount: finalGroups.length,
      modularity: previousModularity,
      passes: 0,
      moves: 0,
      communities: finalGroups.map((group) => group.originalMembers),
    });
  }

  const finalAssignment = assignmentFromGroups(finalGroups);
  const totalVolume = originalGraph.totalEdgeWeight * 2;
  let totalInternalWeight = 0;
  const communities = finalGroups.map((group, index) => {
    const memberSet = new Set(group.originalMembers);
    let internalWeight = 0;
    let boundaryWeight = 0;
    let internalEdgeCount = 0;
    let boundaryEdgeCount = 0;
    for (const edge of originalGraph.edges) {
      const fromInside = memberSet.has(edge.from);
      const toInside = memberSet.has(edge.to);
      if (fromInside && toInside) {
        internalWeight += edge.weight;
        internalEdgeCount += 1;
      } else if (fromInside !== toInside) {
        boundaryWeight += edge.weight;
        boundaryEdgeCount += 1;
      }
    }
    totalInternalWeight += internalWeight;
    const volume = group.originalMembers.reduce(
      (sum, member) => sum + (originalGraph.degree.get(member) ?? 0),
      0,
    );
    const denominator = Math.min(volume, totalVolume - volume);
    const possibleInternalEdges = group.originalMembers.length > 1
      ? group.originalMembers.length * (group.originalMembers.length - 1) / 2
      : 0;
    const possibleBoundaryEdges = group.originalMembers.length
      * (originalGraph.vertices.length - group.originalMembers.length);
    return {
      id: `community-${index + 1}`,
      members: group.originalMembers,
      internalWeight,
      boundaryWeight,
      conductance: denominator > 0 ? boundaryWeight / denominator : 0,
      cohesion: internalWeight + boundaryWeight > 0
        ? internalWeight / (internalWeight + boundaryWeight)
        : 0,
      internalDensity: possibleInternalEdges > 0 ? internalEdgeCount / possibleInternalEdges : 0,
      cutRatio: possibleBoundaryEdges > 0 ? boundaryEdgeCount / possibleBoundaryEdges : 0,
    };
  });

  return {
    viewId,
    resolution: resultResolution,
    algorithm: 'louvain',
    modularityResolution,
    vertexCount: originalGraph.vertices.length,
    edgeCount: originalGraph.edges.length,
    totalEdgeWeight: originalGraph.totalEdgeWeight,
    modularity: modularity(originalGraph, finalAssignment, modularityResolution),
    coverage: originalGraph.totalEdgeWeight > 0 ? totalInternalWeight / originalGraph.totalEdgeWeight : 0,
    levels,
    communities,
  };
}

export function discoverViewCommunities(
  view: AnalysisView,
  options: CommunityDiscoveryOptions = {},
): CommunityResult {
  const seenRelations = new Set<string>();
  const staticRelations = view.routes.filter((route) => {
    const relationKey = `${route.from}\0${route.to}\0${route.infoType}`;
    if (seenRelations.has(relationKey)) return false;
    seenRelations.add(relationKey);
    return true;
  });
  return discover(
    view.id,
    'node',
    Array.from(view.nodes.keys()),
    // A statically observed from/to/Info relation is one fact. Multiple AST
    // witnesses are retained for debugging, but never amplify community weight.
    staticRelations.map((route) => ({ from: route.from, to: route.to, weight: 1 })),
    options,
  );
}

export function discoverGranularCommunities(
  index: CausalIndex,
  options: CommunityDiscoveryOptions = {},
): CommunityResult {
  const included = new Set(
    Array.from(index.entities.values())
      .filter((entity) => entity.kind !== 'node')
      .map((entity) => entity.address),
  );
  const seenRelations = new Set<string>();
  return discover(
    'all-granular',
    'granular',
    Array.from(included),
    index.edges
      .filter((edge) => {
        const relationKey = `${edge.from}\0${edge.to}\0${edge.type}`;
        if (!included.has(edge.from) || !included.has(edge.to) || seenRelations.has(relationKey)) {
          return false;
        }
        seenRelations.add(relationKey);
        return true;
      })
      .map((edge) => ({ from: edge.from, to: edge.to, weight: 1 })),
    options,
  );
}
