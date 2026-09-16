/** Language-neutral, read-only graph analysis. No Node reflection or TypeScript parser. */
export { buildCausalIndexFromSnapshot, type PortableIndexOptions } from './portable-index';
export { validateCausalIndex } from './validate-index';
export { queryEntity, expandEntity } from './query';
export { findCausalPaths, findCausalChain } from './path';
export { selectInducedSubgraph } from './select';
export { buildAllNodesView } from './views';
export { buildFoldDepthView } from './fold-depth';
export { analyzeViewHealth } from './health';
export { analyzeViewReachability } from './reachability';
export { analyzeViewCentrality } from './centrality';
export { discoverViewCommunities, discoverGranularCommunities } from './community';
export { compareCommunityPartitions, compareCommunitiesToView } from './community-comparison';
export type {
  PortableAnalysisSnapshot, CausalIndex, CausalEntity, CausalEdge, AnalysisView,
  FoldDefinitionFile, FrontendLinkDefinition, FrontendServiceLinkDefinition,
} from './model';
