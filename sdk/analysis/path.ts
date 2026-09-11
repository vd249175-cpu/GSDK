import type { CausalIndex, CausalEntity, CausalPathResult, OrderedPathResult } from './model';
import { queryEntity } from './query';
import { shortestDirectedPaths } from './shortest-path';

export interface PathSearchOptions {
  maxDepth?: number;
  maxPaths?: number;
}

export function findCausalPaths(
  index: CausalIndex,
  fromAddress: string,
  toAddress: string,
  options: PathSearchOptions = {},
): CausalPathResult {
  const from = queryEntity(index, fromAddress);
  const to = queryEntity(index, toAddress);
  if (!from) throw new Error(`Entity not found: ${fromAddress}`);
  if (!to) throw new Error(`Entity not found: ${toAddress}`);
  // Membership expands only at endpoints, never as an intermediate causal shortcut.
  const endpoints = (entity: CausalEntity) => entity.kind === 'node'
    ? [...index.entities.values()].filter((candidate) => candidate.nodeId === entity.id
      && (candidate.kind === 'change' || candidate.kind === 'state')).map((candidate) => candidate.address)
    : [entity.address];
  const causalTypes = new Set(['inject', 'trigger', 'send', 'write', 'read-by', 'project']);
  const result = shortestDirectedPaths(
    index.edges.filter((edge) => causalTypes.has(edge.type)
      && index.entities.has(edge.from) && index.entities.has(edge.to)),
    endpoints(from), endpoints(to), options.maxPaths ?? 50, options.maxDepth ?? 15,
  );
  return {
    from: from.address,
    to: to.address,
    paths: result.paths.map((path) => ({
      steps: path.vertices.map((address) => index.entities.get(address)!),
      edges: path.edges,
      length: path.edges.length,
    })),
    diagnostics: result.diagnostics,
  };
}

export function findCausalChain(
  index: CausalIndex,
  addresses: readonly string[],
  options: PathSearchOptions = {},
): OrderedPathResult<CausalPathResult> {
  if (addresses.length < 2) throw new Error('A path requires at least two addresses');
  const waypoints = addresses.map((address) => {
    const entity = queryEntity(index, address);
    if (!entity) throw new Error(`Entity not found: ${address}`);
    return entity.address;
  });
  const segments = waypoints.slice(1).map((to, position) => {
    const from = waypoints[position];
    const result = findCausalPaths(index, from, to, options);
    const connected = result.diagnostics.status === 'found';
    const reverse = connected ? null : findCausalPaths(index, to, from, options);
    return { ...result, connected, reversePaths: reverse?.paths ?? [], reverseDiagnostics: reverse?.diagnostics ?? null };
  });
  return {
    waypoints,
    connected: segments.every((segment) => segment.connected),
    failedSegmentIndexes: segments.flatMap((segment, position) => segment.connected ? [] : [position]),
    segments,
  };
}
