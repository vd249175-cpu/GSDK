import type { CausalIndex, CausalEntity, CausalEdge, InducedSubgraphResult } from './model';

export function selectInducedSubgraph(
  index: CausalIndex,
  nodeIds: string[],
): InducedSubgraphResult {
  const nodeSet = new Set(nodeIds);
  if (nodeSet.size === 0) throw new Error('Select at least one Node');
  for (const nodeId of nodeSet) {
    if (!index.nodes.has(nodeId)) throw new Error(`Node not found: ${nodeId}`);
  }

  const matchedEntities: CausalEntity[] = [];
  const matchedAddresses = new Set<string>();

  for (const entity of index.entities.values()) {
    let belongs = false;
    if (entity.kind === 'node' && nodeSet.has(entity.id)) belongs = true;
    if (entity.nodeId && nodeSet.has(entity.nodeId)) belongs = true;
    if (entity.kind === 'info' && entity.subId && nodeSet.has(entity.subId)) belongs = true;

    if (belongs) {
      matchedEntities.push(entity);
      matchedAddresses.add(entity.address);
    }
  }

  const matchedEdges: CausalEdge[] = [];
  const boundaryIn: CausalEdge[] = [];
  const boundaryOut: CausalEdge[] = [];
  for (const edge of index.edges) {
    const fromInside = matchedAddresses.has(edge.from);
    const toInside = matchedAddresses.has(edge.to);
    if (fromInside && toInside) {
      matchedEdges.push(edge);
    } else if (toInside) boundaryIn.push(edge);
    else if (fromInside) boundaryOut.push(edge);
  }

  const sourcedInfos = new Set(index.edges.filter((edge) => edge.type === 'send' || edge.type === 'inject')
    .map((edge) => edge.to));
  const rootInfos = matchedEntities.filter((entity) => entity.kind === 'info' && !sourcedInfos.has(entity.address));
  const entryAddresses = new Set([...boundaryIn.map((edge) => edge.to), ...rootInfos.map((info) => info.address)]);
  const exitAddresses = new Set(boundaryOut.map((edge) => edge.from));

  return {
    selectedNodeIds: [...nodeSet],
    entities: matchedEntities,
    edges: matchedEdges,
    boundaryIn,
    boundaryOut,
    rootInfos,
    entryPoints: matchedEntities.filter((entity) => entryAddresses.has(entity.address)),
    exitPoints: matchedEntities.filter((entity) => exitAddresses.has(entity.address)),
  };
}
