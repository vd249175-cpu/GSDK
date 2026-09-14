import type {
  AnalysisNode, AnalysisRoute, AnalysisView, FoldDefinitionFile,
} from './model';

/** A view depth of zero shows the root fold; deeper values expand groups. */
export function buildFoldDepthView(
  base: AnalysisView,
  folds: FoldDefinitionFile,
  foldDepth: number,
): AnalysisView {
  if (!Number.isSafeInteger(foldDepth) || foldDepth < 0) {
    throw new Error('Fold depth must be a non-negative safe integer');
  }
  if (folds.version !== 1 || !folds.groups
    || !Object.prototype.hasOwnProperty.call(folds.groups, folds.root)) {
    throw new Error('Fold root is missing or has an unsupported version');
  }
  const groupIds = new Set(Object.keys(folds.groups));
  for (const groupId of groupIds) {
    if (base.nodes.has(groupId) || base.nodes.has(`fold:${groupId}`)) {
      throw new Error(`Fold group conflicts with Node ID: ${groupId}`);
    }
  }
  const visiting = new Set<string>();
  const reachedGroups = new Set<string>();
  const reachedLeaves = new Set<string>();
  const groupLeaves = new Map<string, string[]>();
  const collect = (groupId: string): string[] => {
    if (visiting.has(groupId)) throw new Error(`Fold cycle detected: ${groupId}`);
    if (reachedGroups.has(groupId)) throw new Error(`Duplicate fold group: ${groupId}`);
    visiting.add(groupId);
    reachedGroups.add(groupId);
    const leaves: string[] = [];
    if (!Array.isArray(folds.groups[groupId].children)) throw new Error(`Fold children must be an array: ${groupId}`);
    for (const child of folds.groups[groupId].children) {
      if (groupIds.has(child)) {
        leaves.push(...collect(child));
      } else {
        if (!base.nodes.has(child)) throw new Error(`Unknown fold leaf: ${child}`);
        if (reachedLeaves.has(child)) throw new Error(`Duplicate fold leaf: ${child}`);
        reachedLeaves.add(child);
        leaves.push(child);
      }
    }
    visiting.delete(groupId);
    groupLeaves.set(groupId, leaves);
    return leaves;
  };
  collect(folds.root);
  if (reachedGroups.size !== groupIds.size || reachedLeaves.size !== base.nodes.size) {
    throw new Error('Fold coverage must include every group and Node exactly once');
  }

  const nodes = new Map<string, AnalysisNode>();
  const baseNodeToViewNode = new Map<string, string>();
  const expanded: string[] = [];
  const addNode = (id: string, sourceNodeIds: string[], aggregate: boolean): void => {
    const members = sourceNodeIds.map((nodeId) => base.nodes.get(nodeId)!);
    const facts = <K extends 'states' | 'changes' | 'infos' | 'effects'>(key: K) =>
      members.flatMap((member) => member[key]).sort((left, right) => left.address.localeCompare(right.address));
    nodes.set(id, {
      id, name: aggregate ? id.slice('fold:'.length) : members[0].name,
      aggregate, sourceNodeIds: [...sourceNodeIds].sort(),
      states: facts('states'), changes: facts('changes'),
      infos: facts('infos'), effects: facts('effects'),
      inbound: [], internal: [], outbound: [],
    });
    for (const sourceNodeId of sourceNodeIds) baseNodeToViewNode.set(sourceNodeId, id);
  };
  const expand = (groupId: string, depth: number): void => {
    if (depth >= foldDepth) {
      addNode(`fold:${groupId}`, groupLeaves.get(groupId)!, true);
      return;
    }
    expanded.push(groupId);
    for (const child of folds.groups[groupId].children) {
      if (groupIds.has(child)) expand(child, depth + 1);
      else addNode(child, [child], false);
    }
  };
  expand(folds.root, 0);

  const routesByKey = new Map<string, AnalysisRoute>();
  for (const source of base.routes) {
    const from = baseNodeToViewNode.get(source.from);
    const to = baseNodeToViewNode.get(source.to);
    if (!from || !to) throw new Error(`Fold route has an unmapped Node: ${source.id}`);
    const id = `route:${from}->${to}:${source.infoType}`;
    const existing = routesByKey.get(id);
    if (existing) {
      existing.routeCount += source.routeCount;
      existing.witnesses.push(...source.witnesses);
    } else {
      routesByKey.set(id, {
        id, from, to, infoType: source.infoType,
        routeCount: source.routeCount, internal: from === to,
        witnesses: [...source.witnesses],
      });
    }
  }
  const routes = [...routesByKey.values()].sort((left, right) => (
    left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
    || left.infoType.localeCompare(right.infoType)
  ));
  for (const route of routes) {
    if (route.internal) nodes.get(route.from)!.internal.push(route);
    else {
      nodes.get(route.from)!.outbound.push(route);
      nodes.get(route.to)!.inbound.push(route);
    }
  }
  return {
    id: `fold-depth:${foldDepth}`, kind: 'configured', root: folds.root,
    expanded, nodes, routes, baseNodeToViewNode,
  };
}
