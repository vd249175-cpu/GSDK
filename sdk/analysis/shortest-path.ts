import type { PathSearchDiagnostics } from './model';

interface DirectedEdge { id: string; from: string; to: string }

function distances(origins: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>) {
  const result = new Map(origins.map((id) => [id, 0]));
  const queue = [...result.keys()];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const next of adjacency.get(current) ?? []) {
      if (result.has(next)) continue;
      result.set(next, result.get(current)! + 1);
      queue.push(next);
    }
  }
  return result;
}

/** One BFS predecessor DAG, followed by bounded path enumeration. No per-path search queue. */
export function shortestDirectedPaths<E extends DirectedEdge>(
  edges: readonly E[], starts: readonly string[], targets: readonly string[], maxPaths: number, maxDepth: number,
): { paths: Array<{ vertices: string[]; edges: E[] }>; diagnostics: PathSearchDiagnostics } {
  if (!Number.isSafeInteger(maxPaths) || maxPaths < 1) throw new Error('maxPaths must be a positive safe integer');
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new Error('maxDepth must be a non-negative safe integer');
  const adjacency = new Map<string, E[]>();
  const reverse = new Map<string, string[]>();
  const undirected = new Map<string, string[]>();
  const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  const seen = new Set<string>();
  for (const edge of [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.id.localeCompare(b.id))) {
    const key = JSON.stringify([edge.from, edge.to, edge.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    append(adjacency, edge.from, edge);
    append(reverse, edge.to, edge.from);
    append(undirected, edge.from, edge.to);
    append(undirected, edge.to, edge.from);
  }
  const startSet = new Set(starts);
  const depth = new Map([...startSet].sort().map((id) => [id, 0]));
  const predecessors = new Map<string, E[]>();
  const queue = [...depth.keys()];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const nextDepth = depth.get(current)! + 1;
    for (const edge of adjacency.get(current) ?? []) {
      if (!depth.has(edge.to)) {
        depth.set(edge.to, nextDepth);
        queue.push(edge.to);
      }
      if (depth.get(edge.to) === nextDepth) append(predecessors, edge.to, edge);
    }
  }
  const targetDepths = targets.flatMap((target) => depth.has(target) ? [depth.get(target)!] : []);
  const shortestDistance = targetDepths.length ? targetDepths.reduce((best, distance) => Math.min(best, distance), Infinity) : null;
  const status = shortestDistance === null ? 'unreachable' : shortestDistance > maxDepth ? 'depth-limited' : 'found';
  const diagnostics: PathSearchDiagnostics = { status, shortestDistance, truncated: false, frontier: [] };
  if (status !== 'found') {
    let candidates: string[];
    if (status === 'depth-limited') {
      const toTarget = distances(targets, reverse);
      candidates = queue.filter((id) => depth.get(id) === maxDepth
        && depth.get(id)! + (toTarget.get(id) ?? Infinity) === shortestDistance);
    } else {
      // Undirected proximity is a diagnostic hint only; never use it as a causal edge.
      const proximity = distances(targets, undirected);
      let nearest = Infinity;
      for (const id of queue) nearest = Math.min(nearest, proximity.get(id) ?? Infinity);
      candidates = queue.filter((id) => (proximity.get(id) ?? Infinity) === nearest);
      if (nearest === Infinity && candidates.length) {
        const furthest = depth.get(queue.at(-1)!)!;
        candidates = candidates.filter((id) => depth.get(id) === furthest);
      }
    }
    diagnostics.frontier = candidates.map((address) => ({ address, distance: depth.get(address)! }))
      .sort((a, b) => b.distance - a.distance || a.address.localeCompare(b.address));
    return { paths: [], diagnostics };
  }
  const paths: Array<{ vertices: string[]; edges: E[] }> = [];
  for (const target of [...new Set(targets)].filter((id) => depth.get(id) === shortestDistance).sort()) {
    const stack = [{ vertex: target, next: 0 }];
    const pathEdges: E[] = [];
    while (stack.length) {
      const frame = stack.at(-1)!;
      const parents = predecessors.get(frame.vertex) ?? [];
      if (startSet.has(frame.vertex)) {
        if (paths.length === maxPaths) {
          diagnostics.truncated = true;
          return { paths, diagnostics };
        }
        paths.push({ vertices: stack.map((item) => item.vertex).reverse(), edges: [...pathEdges].reverse() });
        stack.pop();
        pathEdges.pop();
      } else if (frame.next < parents.length) {
        const edge = parents[frame.next++];
        pathEdges.push(edge);
        stack.push({ vertex: edge.from, next: 0 });
      } else {
        stack.pop();
        pathEdges.pop();
      }
    }
  }
  return { paths, diagnostics };
}
