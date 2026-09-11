import type { AnalysisView, ViewCentralityReport } from './model';
import {
  buildDirectedGraph,
  findArticulationPointsAndBridges,
  weaklyConnectedComponents,
} from './weighted-graph';

export interface CentralityOptions {
  damping?: number;
  maxIterations?: number;
  tolerance?: number;
}

interface HeapEntry {
  nodeId: string;
  degree: number;
}

function coreNumbers(
  vertices: string[],
  outbound: ReadonlyMap<string, ReadonlyMap<string, number>>,
  inbound: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> {
  const adjacency = new Map(vertices.map((vertex) => [
    vertex,
    new Set([...outbound.get(vertex)!.keys(), ...inbound.get(vertex)!.keys()].filter((id) => id !== vertex)),
  ]));
  const degrees = new Map(vertices.map((vertex) => [vertex, adjacency.get(vertex)!.size]));
  const removed = new Set<string>();
  const result = new Map<string, number>();
  const heap: HeapEntry[] = [];
  const push = (entry: HeapEntry): void => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentEntry = heap[parent];
      if (parentEntry.degree < entry.degree || (parentEntry.degree === entry.degree && parentEntry.nodeId <= entry.nodeId)) break;
      heap[index] = parentEntry;
      index = parent;
    }
    heap[index] = entry;
  };
  const pop = (): HeapEntry | undefined => {
    if (heap.length === 0) return undefined;
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        let child = left;
        if (
          right < heap.length
          && (heap[right].degree < heap[left].degree
            || (heap[right].degree === heap[left].degree && heap[right].nodeId < heap[left].nodeId))
        ) child = right;
        if (heap[child].degree > last.degree || (heap[child].degree === last.degree && heap[child].nodeId >= last.nodeId)) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  vertices.forEach((vertex) => push({ nodeId: vertex, degree: degrees.get(vertex)! }));
  while (heap.length > 0) {
    const entry = pop()!;
    if (removed.has(entry.nodeId) || degrees.get(entry.nodeId) !== entry.degree) continue;
    removed.add(entry.nodeId);
    result.set(entry.nodeId, entry.degree);
    for (const neighbor of adjacency.get(entry.nodeId)!) {
      if (removed.has(neighbor) || degrees.get(neighbor)! <= entry.degree) continue;
      const nextDegree = degrees.get(neighbor)! - 1;
      degrees.set(neighbor, nextDegree);
      push({ nodeId: neighbor, degree: nextDegree });
    }
  }
  return result;
}

export function analyzeViewCentrality(
  view: AnalysisView,
  options: CentralityOptions = {},
): ViewCentralityReport {
  const damping = options.damping ?? 0.85;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-12;
  if (!(damping > 0 && damping < 1)) throw new Error(`PageRank damping 必须位于 (0, 1): ${damping}`);

  const graph = buildDirectedGraph(
    view.nodes.keys(),
    view.routes
      .filter((route) => !route.internal)
      .map((route) => ({ from: route.from, to: route.to, weight: route.routeCount })),
  );
  const n = graph.vertices.length;
  let ranks = new Map(graph.vertices.map((vertex) => [vertex, n > 0 ? 1 / n : 0]));
  let pageRankIterations = 0;
  let pageRankConverged = n === 0;
  for (; pageRankIterations < maxIterations && n > 0; pageRankIterations += 1) {
    const danglingRank = graph.vertices
      .filter((vertex) => graph.outbound.get(vertex)!.size === 0)
      .reduce((sum, vertex) => sum + ranks.get(vertex)!, 0);
    const next = new Map(graph.vertices.map((vertex) => [
      vertex,
      (1 - damping) / n + damping * danglingRank / n,
    ]));
    for (const source of graph.vertices) {
      const outbound = graph.outbound.get(source)!;
      const totalWeight = [...outbound.values()].reduce((sum, weight) => sum + weight, 0);
      if (totalWeight <= 0) continue;
      for (const [target, weight] of outbound) {
        next.set(target, next.get(target)! + damping * ranks.get(source)! * weight / totalWeight);
      }
    }
    const difference = graph.vertices.reduce(
      (sum, vertex) => sum + Math.abs(next.get(vertex)! - ranks.get(vertex)!),
      0,
    );
    ranks = next;
    if (difference <= tolerance) {
      pageRankIterations += 1;
      pageRankConverged = true;
      break;
    }
  }

  const betweenness = new Map(graph.vertices.map((vertex) => [vertex, 0]));
  const harmonic = new Map(graph.vertices.map((vertex) => [vertex, 0]));
  for (const source of graph.vertices) {
    const stack: string[] = [];
    const predecessors = new Map(graph.vertices.map((vertex) => [vertex, [] as string[]]));
    const paths = new Map(graph.vertices.map((vertex) => [vertex, 0]));
    const distance = new Map(graph.vertices.map((vertex) => [vertex, -1]));
    paths.set(source, 1);
    distance.set(source, 0);
    const queue = [source];
    while (queue.length > 0) {
      const vertex = queue.shift()!;
      stack.push(vertex);
      for (const target of [...graph.outbound.get(vertex)!.keys()].sort()) {
        if (distance.get(target) === -1) {
          distance.set(target, distance.get(vertex)! + 1);
          queue.push(target);
        }
        if (distance.get(target) === distance.get(vertex)! + 1) {
          paths.set(target, paths.get(target)! + paths.get(vertex)!);
          predecessors.get(target)!.push(vertex);
        }
      }
    }
    for (const vertex of graph.vertices) {
      const steps = distance.get(vertex)!;
      if (steps > 0) harmonic.set(source, harmonic.get(source)! + 1 / steps);
    }
    const dependency = new Map(graph.vertices.map((vertex) => [vertex, 0]));
    while (stack.length > 0) {
      const target = stack.pop()!;
      for (const predecessor of predecessors.get(target)!) {
        if (paths.get(target)! > 0) {
          dependency.set(
            predecessor,
            dependency.get(predecessor)!
              + paths.get(predecessor)! / paths.get(target)! * (1 + dependency.get(target)!),
          );
        }
      }
      if (target !== source) betweenness.set(target, betweenness.get(target)! + dependency.get(target)!);
    }
  }

  const betweennessScale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 0;
  const degreeScale = n > 1 ? 1 / (n - 1) : 0;
  const coreNumberByNode = coreNumbers(graph.vertices, graph.outbound, graph.inbound);
  const fragility = findArticulationPointsAndBridges(graph);
  const nodes = graph.vertices.map((nodeId) => {
    const inbound = graph.inbound.get(nodeId)!;
    const outbound = graph.outbound.get(nodeId)!;
    return {
      nodeId,
      inDegree: inbound.size,
      outDegree: outbound.size,
      weightedInDegree: [...inbound.values()].reduce((sum, weight) => sum + weight, 0),
      weightedOutDegree: [...outbound.values()].reduce((sum, weight) => sum + weight, 0),
      inDegreeCentrality: inbound.size * degreeScale,
      outDegreeCentrality: outbound.size * degreeScale,
      pageRank: ranks.get(nodeId) ?? 0,
      betweennessCentrality: (betweenness.get(nodeId) ?? 0) * betweennessScale,
      harmonicCloseness: (harmonic.get(nodeId) ?? 0) * degreeScale,
      coreNumber: coreNumberByNode.get(nodeId) ?? 0,
    };
  }).sort((a, b) => (
    b.betweennessCentrality - a.betweennessCentrality
    || b.pageRank - a.pageRank
    || a.nodeId.localeCompare(b.nodeId)
  ));

  return {
    viewId: view.id,
    nodeCount: n,
    edgeCount: graph.edges.length,
    pageRankIterations,
    pageRankConverged,
    maxCoreNumber: Math.max(0, ...coreNumberByNode.values()),
    weaklyConnectedComponents: weaklyConnectedComponents(graph),
    articulationPointIds: fragility.articulationPointIds,
    bridges: fragility.bridges,
    sourceNodeIds: graph.vertices.filter((vertex) => (
      graph.inbound.get(vertex)!.size === 0 && graph.outbound.get(vertex)!.size > 0
    )),
    sinkNodeIds: graph.vertices.filter((vertex) => (
      graph.outbound.get(vertex)!.size === 0 && graph.inbound.get(vertex)!.size > 0
    )),
    nodes,
  };
}
