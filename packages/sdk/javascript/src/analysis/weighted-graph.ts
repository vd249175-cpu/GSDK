export interface WeightedEdge {
  from: string;
  to: string;
  weight: number;
}

export interface WeightedUndirectedGraph {
  vertices: string[];
  edges: WeightedEdge[];
  adjacency: Map<string, Map<string, number>>;
  degree: Map<string, number>;
  totalEdgeWeight: number;
}

export interface WeightedDirectedGraph {
  vertices: string[];
  edges: WeightedEdge[];
  outbound: Map<string, Map<string, number>>;
  inbound: Map<string, Map<string, number>>;
}

function validWeight(weight: number): boolean {
  return Number.isFinite(weight) && weight > 0;
}

export function buildUndirectedGraph(
  vertexIds: Iterable<string>,
  sourceEdges: Iterable<WeightedEdge>,
): WeightedUndirectedGraph {
  const vertices = [...new Set(vertexIds)].sort();
  const vertexSet = new Set(vertices);
  const merged = new Map<string, WeightedEdge>();
  for (const edge of sourceEdges) {
    if (!validWeight(edge.weight) || !vertexSet.has(edge.from) || !vertexSet.has(edge.to)) continue;
    const [from, to] = edge.from <= edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
    const key = `${from}\0${to}`;
    const previous = merged.get(key);
    merged.set(key, { from, to, weight: (previous?.weight ?? 0) + edge.weight });
  }
  const edges = [...merged.values()].sort((a, b) => (
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
  ));
  const adjacency = new Map(vertices.map((vertex) => [vertex, new Map<string, number>()]));
  const degree = new Map(vertices.map((vertex) => [vertex, 0]));
  let totalEdgeWeight = 0;
  for (const edge of edges) {
    totalEdgeWeight += edge.weight;
    if (edge.from === edge.to) {
      degree.set(edge.from, degree.get(edge.from)! + edge.weight * 2);
      continue;
    }
    adjacency.get(edge.from)!.set(edge.to, edge.weight);
    adjacency.get(edge.to)!.set(edge.from, edge.weight);
    degree.set(edge.from, degree.get(edge.from)! + edge.weight);
    degree.set(edge.to, degree.get(edge.to)! + edge.weight);
  }
  return { vertices, edges, adjacency, degree, totalEdgeWeight };
}

export function buildDirectedGraph(
  vertexIds: Iterable<string>,
  sourceEdges: Iterable<WeightedEdge>,
): WeightedDirectedGraph {
  const vertices = [...new Set(vertexIds)].sort();
  const vertexSet = new Set(vertices);
  const merged = new Map<string, WeightedEdge>();
  for (const edge of sourceEdges) {
    if (!validWeight(edge.weight) || !vertexSet.has(edge.from) || !vertexSet.has(edge.to)) continue;
    const key = `${edge.from}\0${edge.to}`;
    const previous = merged.get(key);
    merged.set(key, { ...edge, weight: (previous?.weight ?? 0) + edge.weight });
  }
  const edges = [...merged.values()].sort((a, b) => (
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
  ));
  const outbound = new Map(vertices.map((vertex) => [vertex, new Map<string, number>()]));
  const inbound = new Map(vertices.map((vertex) => [vertex, new Map<string, number>()]));
  for (const edge of edges) {
    outbound.get(edge.from)!.set(edge.to, edge.weight);
    inbound.get(edge.to)!.set(edge.from, edge.weight);
  }
  return { vertices, edges, outbound, inbound };
}

export function weaklyConnectedComponents(graph: WeightedDirectedGraph): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of graph.vertices) {
    if (visited.has(start)) continue;
    const members: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      const neighbors = new Set([
        ...graph.outbound.get(current)!.keys(),
        ...graph.inbound.get(current)!.keys(),
      ]);
      for (const neighbor of [...neighbors].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(members.sort());
  }
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export function findArticulationPointsAndBridges(graph: WeightedDirectedGraph): {
  articulationPointIds: string[];
  bridges: Array<{ from: string; to: string }>;
} {
  const adjacency = new Map(graph.vertices.map((vertex) => [vertex, new Set<string>()]));
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }
  let time = 0;
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulation = new Set<string>();
  const bridges: Array<{ from: string; to: string }> = [];

  const visit = (vertex: string): void => {
    discovery.set(vertex, time);
    low.set(vertex, time);
    time += 1;
    let children = 0;
    for (const neighbor of [...adjacency.get(vertex)!].sort()) {
      if (!discovery.has(neighbor)) {
        children += 1;
        parent.set(neighbor, vertex);
        visit(neighbor);
        low.set(vertex, Math.min(low.get(vertex)!, low.get(neighbor)!));
        if (parent.get(vertex) === null && children > 1) articulation.add(vertex);
        if (parent.get(vertex) !== null && low.get(neighbor)! >= discovery.get(vertex)!) articulation.add(vertex);
        if (low.get(neighbor)! > discovery.get(vertex)!) {
          bridges.push(vertex < neighbor ? { from: vertex, to: neighbor } : { from: neighbor, to: vertex });
        }
      } else if (neighbor !== parent.get(vertex)) {
        low.set(vertex, Math.min(low.get(vertex)!, discovery.get(neighbor)!));
      }
    }
  };

  for (const vertex of graph.vertices) {
    if (discovery.has(vertex)) continue;
    parent.set(vertex, null);
    visit(vertex);
  }
  return {
    articulationPointIds: [...articulation].sort(),
    bridges: bridges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}
