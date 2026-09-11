export type EntityKind =
  | 'node'
  | 'change'
  | 'state'
  | 'info'
  | 'effect'
  | 'entry'
  | 'ui';

export type RelationType =
  | 'trigger' // info@Target -> change
  | 'send' // change -> info@Target
  | 'read-by' // state -> change
  | 'write' // change -> state
  | 'effect' // change -> effect
  | 'inject' // entry -> info@Target
  | 'project'; // state -> ui

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface SourceLocation {
  filePath: string;
  line: number;
  column: number;
}

export interface CausalEntity {
  address: string; // e.g. "node:node-md-source", "change:node-md-source::DocumentUpdatedInfo"
  kind: EntityKind;
  id: string; // e.g. "node-md-source"
  name?: string;
  subId?: string; // field name, info type, adapter id, etc.
  nodeId?: string; // owner node ID if applicable
  location?: SourceLocation;
  meta?: Record<string, any>;
}

export interface CausalEdge {
  id: string;
  from: string; // source address
  to: string; // target address
  type: RelationType;
  confidence: ConfidenceLevel;
  location?: SourceLocation;
  unresolved?: boolean;
}

export interface FoldGroupDefinition {
  children: string[];
}

export interface FoldDefinitionFile {
  version: 1;
  root: string;
  groups: Record<string, FoldGroupDefinition>;
}

export interface ExpansionViewFile {
  version: 1;
  id: string;
  root?: string;
  expanded: string[];
  description?: string;
}

export interface AnalysisCatalog {
  folds: FoldDefinitionFile;
  views: Map<string, ExpansionViewFile>;
}

export interface AnalysisRouteWitness {
  edgeId: string;
  sourceNodeId: string;
  sourceChangeAddress: string;
  targetNodeId: string;
  targetInfoAddress: string;
  infoType: string;
  location?: SourceLocation;
}

export interface AnalysisRoute {
  id: string;
  from: string;
  to: string;
  infoType: string;
  routeCount: number;
  internal: boolean;
  witnesses: AnalysisRouteWitness[];
}

export interface AnalysisNode {
  id: string;
  name: string;
  aggregate: boolean;
  sourceNodeIds: string[];
  states: CausalEntity[];
  changes: CausalEntity[];
  infos: CausalEntity[];
  effects: CausalEntity[];
  inbound: AnalysisRoute[];
  internal: AnalysisRoute[];
  outbound: AnalysisRoute[];
}

export interface AnalysisView {
  id: string;
  kind: 'configured' | 'all-nodes';
  root: string;
  expanded: string[];
  nodes: Map<string, AnalysisNode>;
  routes: AnalysisRoute[];
  baseNodeToViewNode: Map<string, string>;
}

export interface AnalysisNodePath {
  from: string;
  to: string;
  diagnostics: PathSearchDiagnostics;
  paths: Array<{
    nodes: string[];
    routes: AnalysisRoute[];
    length: number;
  }>;
}

export interface ViewReachabilityReport {
  viewId: string;
  originNodeId: string;
  upstream: Array<{ nodeId: string; distance: number }>;
  downstream: Array<{ nodeId: string; distance: number }>;
  unreachableNodeIds: string[];
}

export interface ViewHealthNode {
  nodeId: string;
  sourceNodeCount: number;
  internalRoutes: number;
  inboundRoutes: number;
  outboundRoutes: number;
  inboundNeighbors: number;
  outboundNeighbors: number;
  afferentCoupling: number;
  efferentCoupling: number;
  instability: number;
  conductance: number;
  boundaryRatio: number;
  cohesion: number;
  directionalBalance: number;
  cycleMember: boolean;
}

export interface ViewHealthReport {
  viewId: string;
  nodeCount: number;
  routeCount: number;
  internalRouteCount: number;
  externalRouteCount: number;
  density: number;
  reciprocity: number;
  isolatedNodeIds: string[];
  sourceNodeIds: string[];
  sinkNodeIds: string[];
  weaklyConnectedComponents: string[][];
  cyclicNodeIds: string[];
  stronglyConnectedComponents: string[][];
  nodes: ViewHealthNode[];
}

export interface ViewCentralityNode {
  nodeId: string;
  inDegree: number;
  outDegree: number;
  weightedInDegree: number;
  weightedOutDegree: number;
  inDegreeCentrality: number;
  outDegreeCentrality: number;
  pageRank: number;
  betweennessCentrality: number;
  harmonicCloseness: number;
  coreNumber: number;
}

export interface ViewCentralityReport {
  viewId: string;
  nodeCount: number;
  edgeCount: number;
  pageRankIterations: number;
  pageRankConverged: boolean;
  maxCoreNumber: number;
  weaklyConnectedComponents: string[][];
  articulationPointIds: string[];
  bridges: Array<{ from: string; to: string }>;
  sourceNodeIds: string[];
  sinkNodeIds: string[];
  nodes: ViewCentralityNode[];
}

export interface CommunityResult {
  viewId: string;
  resolution: 'node' | 'granular';
  algorithm: 'louvain';
  modularityResolution: number;
  vertexCount: number;
  edgeCount: number;
  totalEdgeWeight: number;
  modularity: number;
  coverage: number;
  levels: Array<{
    level: number;
    communityCount: number;
    modularity: number;
    passes: number;
    moves: number;
    communities: string[][];
  }>;
  communities: Array<{
    id: string;
    members: string[];
    internalWeight: number;
    boundaryWeight: number;
    conductance: number;
    cohesion: number;
    internalDensity: number;
    cutRatio: number;
  }>;
}

export interface CommunityPartitionComparison {
  discoveredViewId: string;
  referenceViewId: string;
  comparedVertexCount: number;
  discoveredCommunityCount: number;
  referenceCommunityCount: number;
  normalizedMutualInformation: number;
  adjustedRandIndex: number;
  pairwisePrecision: number;
  pairwiseRecall: number;
  pairwiseF1: number;
  exactAgreement: boolean;
  referenceSplits: Array<{
    referenceCommunityId: string;
    discoveredCommunityIds: string[];
    memberCount: number;
  }>;
  discoveredMerges: Array<{
    discoveredCommunityId: string;
    referenceCommunityIds: string[];
    memberCount: number;
  }>;
}

export interface FrontendLinkDefinition {
  id: string;
  applicationMethod: string;
  injection: {
    targetNodeId: string;
    infoType: string;
  };
  projections: Array<{
    ownerNodeId: string;
    ownerField: string;
    applicationStatePath: string;
    consumers: string[];
  }>;
}

export interface FrontendServiceLinkDefinition {
  id: string;
  applicationMethod: string;
  provider: string;
  consumers: string[];
}

export interface CausalIndex {
  timestamp: number;
  entities: Map<string, CausalEntity>;
  edges: CausalEdge[];
  nodes: Map<string, CausalEntity>;
  changes: Map<string, CausalEntity>;
  states: Map<string, CausalEntity>;
  infos: Map<string, CausalEntity>;
  effects: Map<string, CausalEntity>;
  entries: Map<string, CausalEntity>;
  uiPaths: Map<string, CausalEntity>;
  frontendLinks: FrontendLinkDefinition[];
  frontendServiceLinks: FrontendServiceLinkDefinition[];
  nodeObjectFacts: import('./inspect-nodes').NodeObjectFact[];
  unresolvedInfoTypes: Array<{
    sourceChange: string;
    targetNodeId: string | null;
    infoExpression: string;
    location?: SourceLocation;
  }>;
  unresolvedSendTargets: Array<{
    sourceChange: string;
    infoType: string;
    targetExpression: string;
    location?: SourceLocation;
  }>;
}

export interface EntityExpansion {
  target: CausalEntity;
  inbound: Array<{ edge: CausalEdge; entity: CausalEntity }>;
  outbound: Array<{ edge: CausalEdge; entity: CausalEntity }>;
}

export interface CausalPathResult {
  from: string;
  to: string;
  diagnostics: PathSearchDiagnostics;
  paths: Array<{
    steps: CausalEntity[];
    edges: CausalEdge[];
    length: number;
  }>;
}

export interface InducedSubgraphResult {
  selectedNodeIds: string[];
  entities: CausalEntity[];
  edges: CausalEdge[];
  boundaryIn: CausalEdge[];
  boundaryOut: CausalEdge[];
  rootInfos: CausalEntity[];
  entryPoints: CausalEntity[];
  exitPoints: CausalEntity[];
}

export interface PathSearchDiagnostics {
  status: 'found' | 'depth-limited' | 'unreachable';
  shortestDistance: number | null;
  truncated: boolean;
  frontier: Array<{ address: string; distance: number }>;
}

/** Independent adjacent-pair checks, not proof of one runtime execution. */
export interface OrderedPathResult<T extends { paths: unknown[]; diagnostics: PathSearchDiagnostics }> {
  waypoints: string[];
  connected: boolean;
  failedSegmentIndexes: number[];
  segments: Array<T & { connected: boolean; reversePaths: T['paths']; reverseDiagnostics: PathSearchDiagnostics | null }>;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entityAddress?: string;
  location?: SourceLocation;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}
