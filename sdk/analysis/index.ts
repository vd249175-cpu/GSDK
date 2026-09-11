/**
 * 可发布的因果分析核：纯实例 DTO + 确定性算法，无宿主装配、无文件 IO。
 * Studio 绑定（默认装配、UI 联动表、服务校验、报告生成）留在 tools/causal。
 */
export { buildCausalIndex, type ScanIndexOptions } from './scan-index';
export { validateCausalIndex } from './validate-index';
export { scanNodeChanges } from './scan-changes';
export { inspectNodeObjects, nodeObjectFactToScannedNode } from './inspect-nodes';
export { queryEntity, expandEntity } from './query';
export { findCausalPaths, findCausalChain } from './path';
export type { PathSearchOptions } from './path';
export { selectInducedSubgraph } from './select';
export { buildAllNodesView } from './views';
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
