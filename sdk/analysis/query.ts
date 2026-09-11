import type { CausalIndex, CausalEntity, EntityExpansion } from './model';
import { selectInducedSubgraph } from './select';

export function queryEntity(
  index: CausalIndex,
  address: string,
): CausalEntity | null {
  const exact = index.entities.get(address);
  if (exact) return exact;
  if (!address.startsWith('info:') || address.includes('@')) return null;
  const candidates = [...index.infos.values()].filter((entity) => entity.id === address.slice(5))
    .sort((a, b) => a.address.localeCompare(b.address));
  if (candidates.length > 1) throw new Error(`Ambiguous Info address ${address}; use one of: ${candidates.map((entity) => entity.address).join(', ')}`);
  return candidates[0] ?? null;
}

export function expandEntity(
  index: CausalIndex,
  address: string,
): EntityExpansion | null {
  const target = queryEntity(index, address);
  if (!target) return null;

  if (target.kind === 'node') {
    const region = selectInducedSubgraph(index, [target.id]);
    return {
      target,
      inbound: region.boundaryIn.map((edge) => ({ edge, entity: index.entities.get(edge.from)! })),
      outbound: region.boundaryOut.map((edge) => ({ edge, entity: index.entities.get(edge.to)! })),
    };
  }

  const inbound: EntityExpansion['inbound'] = [];
  const outbound: EntityExpansion['outbound'] = [];

  for (const edge of index.edges) {
    if (edge.to === target.address) {
      const sourceEntity = index.entities.get(edge.from);
      if (sourceEntity) {
        inbound.push({ edge, entity: sourceEntity });
      }
    }
    if (edge.from === target.address) {
      const targetEntity = index.entities.get(edge.to);
      if (targetEntity) {
        outbound.push({ edge, entity: targetEntity });
      }
    }
  }

  return {
    target,
    inbound,
    outbound,
  };
}
