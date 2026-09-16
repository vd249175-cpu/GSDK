import type { Node } from '../node';
import type { CausalEdge, CausalEntity, PortableAnalysisSnapshot } from './model';
import { buildCausalIndex } from './scan-index';

const OWNED_KINDS = new Set<CausalEntity['kind']>(['change', 'state', 'effect']);

function edgeBelongsToNode(edge: CausalEdge, nodeId: string): boolean {
  const changePrefix = `change:${nodeId}::`;
  return edge.type === 'trigger'
    ? edge.to.startsWith(changePrefix)
    : edge.from.startsWith(changePrefix);
}

/**
 * Extract portable facts from already-constructed JS Nodes. This is a
 * language-adapter step only: it parses JS instance evidence but performs no
 * graph query, folding or metric calculation.
 */
export function extractPortableAnalysisSnapshots(
  nodeObjects: readonly Node<any>[],
): PortableAnalysisSnapshot[] {
  if (nodeObjects.length === 0) return [];
  const index = buildCausalIndex({ nodeObjects });
  return index.nodeObjectFacts
    .map(({ nodeId }) => {
      const edges = index.edges
        .filter((edge) => edgeBelongsToNode(edge, nodeId))
        .sort((left, right) => left.id.localeCompare(right.id));
      const addresses = new Set<string>([`node:${nodeId}`]);
      for (const entity of index.entities.values()) {
        if (OWNED_KINDS.has(entity.kind) && entity.nodeId === nodeId) {
          addresses.add(entity.address);
        }
      }
      for (const edge of edges) {
        addresses.add(edge.from);
        addresses.add(edge.to);
      }
      const entities = [...addresses]
        .sort()
        .map((address) => index.entities.get(address))
        .filter((entity): entity is CausalEntity => entity !== undefined);
      const sourcePrefix = `change:${nodeId}::`;
      return {
        version: 1 as const,
        nodeId,
        entities,
        edges,
        unresolvedInfoTypes: index.unresolvedInfoTypes
          .filter((item) => item.sourceChange.startsWith(sourcePrefix)),
        unresolvedSendTargets: index.unresolvedSendTargets
          .filter((item) => item.sourceChange.startsWith(sourcePrefix)),
      };
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}
