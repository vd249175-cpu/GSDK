/**
 * 可发布的因果分析核：纯实例 DTO + 确定性算法，无宿主装配、无文件 IO。
 * NativeRuleSpace 按需复用这些只读算法；插件装配与 UI 联动表仍由消费方提供。
 */
export { buildCausalIndex, type ScanIndexOptions } from './scan-index';
export { buildCausalIndexFromSnapshot, type PortableIndexOptions } from './portable-index';
export { validateCausalIndex } from './validate-index';
export { scanNodeChanges } from './scan-changes';
export { inspectNodeObjects, nodeObjectFactToScannedNode } from './inspect-nodes';
export { queryEntity, expandEntity } from './query';
export { findCausalPaths, findCausalChain } from './path';
export type { PathSearchOptions } from './path';
export { selectInducedSubgraph } from './select';
export { buildAllNodesView } from './views';
export { buildFoldDepthView } from './fold-depth';
export { analyzeViewHealth } from './health';
export { analyzeViewReachability } from './reachability';
export { shortestDirectedPaths } from './shortest-path';
export { analyzeViewCentrality } from './centrality';
export {
  discoverViewCommunities,
  discoverGranularCommunities,
} from './community';
export { compareCommunityPartitions, compareCommunitiesToView } from './community-comparison';
export type {
  CausalIndex,
  PortableAnalysisSnapshot,
  CausalEntity,
  CausalEdge,
  CausalPathResult,
  AnalysisNodePath,
  OrderedPathResult,
  PathSearchDiagnostics,
  InducedSubgraphResult,
  ValidationReport,
  ValidationIssue,
  AnalysisView,
  AnalysisCatalog,
  EntityExpansion,
  AnalysisNode,
  AnalysisRoute,
  ViewHealthReport,
  ExpansionViewFile,
  FoldDefinitionFile,
  CommunityResult,
  ViewCentralityReport,
  FrontendLinkDefinition,
  FrontendServiceLinkDefinition,
} from './model';
export type { NodeObjectFact } from './inspect-nodes';
export type { AnalysisInstanceDescriptor } from './inspect-nodes';
