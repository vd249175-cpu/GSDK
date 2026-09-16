import type {
  CausalEdge, CausalEntity, CausalIndex, FrontendLinkDefinition,
  FrontendServiceLinkDefinition, PortableAnalysisSnapshot,
} from './model';

export interface PortableIndexOptions {
  frontendLinks?: readonly FrontendLinkDefinition[];
  frontendServiceLinks?: readonly FrontendServiceLinkDefinition[];
}

const ENTITY_KINDS = new Set(['node', 'change', 'state', 'info', 'effect']);
const EDGE_TYPES = new Set(['trigger', 'send', 'read-by', 'write', 'effect']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);

function assertSnapshot(snapshot: PortableAnalysisSnapshot): void {
  if (snapshot.version !== 1 || typeof snapshot.nodeId !== 'string' || !snapshot.nodeId
    || !Array.isArray(snapshot.entities) || !Array.isArray(snapshot.edges)) {
    throw new Error('Invalid portable analysis snapshot');
  }
  if (snapshot.entities.filter((entity) => entity.kind === 'node' && entity.id === snapshot.nodeId).length !== 1) {
    throw new Error(`Snapshot must identify exactly one source Node: ${snapshot.nodeId}`);
  }
  const localEntities = new Set<string>();
  for (const entity of snapshot.entities) {
    if (!ENTITY_KINDS.has(entity.kind) || typeof entity.address !== 'string'
      || typeof entity.id !== 'string' || !entity.id) {
      throw new Error(`Invalid analysis entity from source Node ${snapshot.nodeId}`);
    }
    if ((entity.kind === 'node' && (entity.id !== snapshot.nodeId || entity.address !== `node:${snapshot.nodeId}`))
      || (['change', 'state', 'effect'].includes(entity.kind) && entity.nodeId !== snapshot.nodeId)) {
      throw new Error(`Analysis entity impersonates another source Node: ${entity.address}`);
    }
    if (entity.kind === 'info' && (typeof entity.nodeId !== 'string'
      || entity.address !== `info:${entity.id}@${entity.nodeId}`)) {
      throw new Error(`Invalid Info address from source Node ${snapshot.nodeId}: ${entity.address}`);
    }
    if (['change', 'state', 'effect'].includes(entity.kind)
      && (typeof entity.subId !== 'string' || !entity.subId
        || entity.address !== `${entity.kind}:${snapshot.nodeId}::${entity.subId}`)) {
      throw new Error(`Invalid owned fact from source Node ${snapshot.nodeId}: ${entity.address}`);
    }
    if (localEntities.has(entity.address)) throw new Error(`Duplicate analysis entity: ${entity.address}`);
    localEntities.add(entity.address);
  }
  for (const edge of snapshot.edges) {
    if (typeof edge.id !== 'string' || !edge.id || typeof edge.from !== 'string'
      || typeof edge.to !== 'string' || !EDGE_TYPES.has(edge.type)
      || !CONFIDENCE.has(edge.confidence)) {
      throw new Error(`Invalid analysis relation from source Node ${snapshot.nodeId}`);
    }
    if (!localEntities.has(edge.from) || !localEntities.has(edge.to)
      || (edge.type === 'send' && !edge.from.startsWith(`change:${snapshot.nodeId}::`))
      || (edge.type === 'trigger' && (!edge.from.endsWith(`@${snapshot.nodeId}`)
        || !edge.to.startsWith(`change:${snapshot.nodeId}::`)))
      || (edge.type === 'read-by' && (!edge.from.startsWith(`state:${snapshot.nodeId}::`)
        || !edge.to.startsWith(`change:${snapshot.nodeId}::`)))
      || (edge.type === 'write' && (!edge.from.startsWith(`change:${snapshot.nodeId}::`)
        || !edge.to.startsWith(`state:${snapshot.nodeId}::`)))
      || (edge.type === 'effect' && (!edge.from.startsWith(`change:${snapshot.nodeId}::`)
        || !edge.to.startsWith(`effect:${snapshot.nodeId}::`)))) {
      throw new Error(`Invalid causal relation from source Node ${snapshot.nodeId}: ${edge.id}`);
    }
  }
}

/** Merge portable evidence with an optional JS-derived index; no source parser is loaded. */
export function buildCausalIndexFromSnapshot(
  snapshots: PortableAnalysisSnapshot | readonly PortableAnalysisSnapshot[],
  base?: CausalIndex,
  options: PortableIndexOptions = {},
): CausalIndex {
  const sources = Array.isArray(snapshots) ? snapshots : [snapshots];
  const entities = new Map<string, CausalEntity>(base?.entities);
  const edges: CausalEdge[] = [...(base?.edges ?? [])];
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const nodes = new Map(base?.nodes);
  const changes = new Map(base?.changes);
  const states = new Map(base?.states);
  const infos = new Map(base?.infos);
  const effects = new Map(base?.effects);
  const entries = new Map(base?.entries);
  const uiPaths = new Map(base?.uiPaths);
  const unresolvedInfoTypes = [...(base?.unresolvedInfoTypes ?? [])];
  const unresolvedSendTargets = [...(base?.unresolvedSendTargets ?? [])];
  const frontendLinks = [...(base?.frontendLinks ?? []), ...(options.frontendLinks ?? [])];
  const frontendServiceLinks = [...(base?.frontendServiceLinks ?? []), ...(options.frontendServiceLinks ?? [])];
  const sourceIds = new Set<string>();
  for (const source of sources) {
    assertSnapshot(source);
    if (sourceIds.has(source.nodeId) || base?.nodes.has(source.nodeId)) {
      throw new Error(`Duplicate source Node facts: ${source.nodeId}`);
    }
    sourceIds.add(source.nodeId);
    for (const entity of source.entities) {
      const existing = entities.get(entity.address);
      if (existing) {
        if (existing.kind !== entity.kind || existing.id !== entity.id || existing.nodeId !== entity.nodeId) {
          throw new Error(`Conflicting analysis entity: ${entity.address}`);
        }
        continue;
      }
      entities.set(entity.address, entity);
      if (entity.kind === 'node') nodes.set(entity.id, entity);
      else if (entity.kind === 'change') changes.set(entity.address, entity);
      else if (entity.kind === 'state') states.set(entity.address, entity);
      else if (entity.kind === 'info') infos.set(entity.address, entity);
      else if (entity.kind === 'effect') effects.set(entity.address, entity);
    }
    for (const edge of source.edges) {
      if (edgeIds.has(edge.id)) throw new Error(`Duplicate analysis relation: ${edge.id}`);
      edgeIds.add(edge.id);
      edges.push(edge);
    }
    unresolvedInfoTypes.push(...(source.unresolvedInfoTypes ?? []));
    unresolvedSendTargets.push(...(source.unresolvedSendTargets ?? []));
  }
  for (const link of options.frontendLinks ?? []) {
    const entryAddress = `entry:${link.applicationMethod}`;
    const targetInfoAddress = `info:${link.injection.infoType}@${link.injection.targetNodeId}`;
    if (!entries.has(entryAddress)) {
      const entry: CausalEntity = { address: entryAddress, kind: 'entry',
        id: link.applicationMethod, name: link.applicationMethod };
      entries.set(entryAddress, entry);
      entities.set(entryAddress, entry);
    }
    if (!infos.has(targetInfoAddress)) {
      const info: CausalEntity = { address: targetInfoAddress, kind: 'info',
        id: link.injection.infoType, subId: link.injection.targetNodeId,
        nodeId: link.injection.targetNodeId };
      infos.set(targetInfoAddress, info);
      entities.set(targetInfoAddress, info);
    }
    const inject: CausalEdge = { id: `inject:${entryAddress}->${targetInfoAddress}`,
      from: entryAddress, to: targetInfoAddress, type: 'inject', confidence: 'high' };
    if (edgeIds.has(inject.id)) throw new Error(`Duplicate frontend relation: ${inject.id}`);
    edgeIds.add(inject.id);
    edges.push(inject);
    for (const projection of link.projections) {
      const stateAddress = `state:${projection.ownerNodeId}::${projection.ownerField}`;
      const uiAddress = `ui:${projection.applicationStatePath}`;
      if (!uiPaths.has(uiAddress)) {
        const ui: CausalEntity = { address: uiAddress, kind: 'ui',
          id: projection.applicationStatePath, name: projection.applicationStatePath,
          meta: { consumers: projection.consumers } };
        uiPaths.set(uiAddress, ui);
        entities.set(uiAddress, ui);
      }
      const project: CausalEdge = { id: `project:${stateAddress}->${uiAddress}`,
        from: stateAddress, to: uiAddress, type: 'project', confidence: 'high' };
      if (edgeIds.has(project.id)) throw new Error(`Duplicate frontend relation: ${project.id}`);
      edgeIds.add(project.id);
      edges.push(project);
    }
  }
  return {
    timestamp: Date.now(), entities, edges, nodes, changes, states, infos, effects,
    entries, uiPaths,
    frontendLinks, frontendServiceLinks,
    nodeObjectFacts: [...(base?.nodeObjectFacts ?? [])],
    unresolvedInfoTypes, unresolvedSendTargets,
  };
}
