import type {
  AnalysisNode,
  AnalysisRoute,
  AnalysisRouteWitness,
  AnalysisView,
  CausalIndex,
} from './model';

function parseChangeAddress(address: string): { nodeId: string; infoType: string } | null {
  if (!address.startsWith('change:')) return null;
  const rest = address.slice('change:'.length);
  const sep = rest.indexOf('::');
  if (sep <= 0 || sep === rest.length - 2) return null;
  return { nodeId: rest.slice(0, sep), infoType: rest.slice(sep + 2) };
}

function parseInfoAddress(address: string): { infoType: string; nodeId: string } | null {
  if (!address.startsWith('info:')) return null;
  const rest = address.slice('info:'.length);
  const sep = rest.indexOf('@');
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { infoType: rest.slice(0, sep), nodeId: rest.slice(sep + 1) };
}

/**
 * `all-nodes` 总览：每个已构造 Node 即一个 View 节点，每条 `send` 边按
 * from/to/infoType 聚合成一条带 witness 的 Route。`inject` 边（entry →
 * info）是 UI 边界而非 Node 间流量，不进入 Route；trigger/read-by/write/
 * effect 边是 Node 内部事实，仅当 Node 向自身 send 时才产生 internal Route。
 * 地址解析失败的边直接跳过；结构性缺陷由 `validateCausalIndex` 报告，
 * 不归这个投影管。
 */
export function buildAllNodesView(index: CausalIndex): AnalysisView {
  const routesById = new Map<string, AnalysisRoute>();
  const witnessesById = new Map<string, AnalysisRouteWitness[]>();

  for (const edge of index.edges) {
    if (edge.type !== 'send') continue;
    const from = parseChangeAddress(edge.from);
    const to = parseInfoAddress(edge.to);
    if (!from || !to) continue;
    if (!index.nodes.has(from.nodeId) || !index.nodes.has(to.nodeId)) continue;
    const id = `route:${from.nodeId}->${to.nodeId}:${to.infoType}`;
    const witness: AnalysisRouteWitness = {
      edgeId: edge.id,
      sourceNodeId: from.nodeId,
      sourceChangeAddress: edge.from,
      targetNodeId: to.nodeId,
      targetInfoAddress: edge.to,
      infoType: to.infoType,
      location: edge.location,
    };
    const existing = witnessesById.get(id);
    if (existing) existing.push(witness);
    else witnessesById.set(id, [witness]);
    const route = routesById.get(id);
    if (route) route.routeCount += 1;
    else {
      routesById.set(id, {
        id,
        from: from.nodeId,
        to: to.nodeId,
        infoType: to.infoType,
        routeCount: 1,
        internal: from.nodeId === to.nodeId,
        witnesses: witnessesById.get(id)!,
      });
    }
  }

  const routes = [...routesById.values()].sort((a, b) => (
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.infoType.localeCompare(b.infoType)
  ));
  // 聚合后统一回填 witness，保证同一引用。
  for (const route of routes) route.witnesses = witnessesById.get(route.id)!;

  const nodes = new Map<string, AnalysisNode>();
  for (const [nodeId, entity] of index.nodes) {
    const states = [...index.entities.values()]
      .filter((e) => e.kind === 'state' && e.nodeId === nodeId)
      .sort((a, b) => a.address.localeCompare(b.address));
    const changes = [...index.entities.values()]
      .filter((e) => e.kind === 'change' && e.nodeId === nodeId)
      .sort((a, b) => a.address.localeCompare(b.address));
    const infos = [...index.entities.values()]
      .filter((e) => e.kind === 'info' && e.nodeId === nodeId)
      .sort((a, b) => a.address.localeCompare(b.address));
    const effects = [...index.entities.values()]
      .filter((e) => e.kind === 'effect' && e.nodeId === nodeId)
      .sort((a, b) => a.address.localeCompare(b.address));
    nodes.set(nodeId, {
      id: nodeId,
      name: entity.name ?? nodeId,
      aggregate: false,
      sourceNodeIds: [nodeId],
      states,
      changes,
      infos,
      effects,
      inbound: routes.filter((r) => !r.internal && r.to === nodeId),
      internal: routes.filter((r) => r.internal && r.from === nodeId),
      outbound: routes.filter((r) => !r.internal && r.from === nodeId),
    });
  }

  return {
    id: 'all-nodes',
    kind: 'all-nodes',
    root: '',
    expanded: [],
    nodes,
    routes,
    baseNodeToViewNode: new Map([...nodes.keys()].map((nodeId) => [nodeId, nodeId])),
  };
}
