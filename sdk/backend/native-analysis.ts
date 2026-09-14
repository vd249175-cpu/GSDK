import { Node } from '@graphvideo/kernel';
import {
  analyzeViewCentrality, analyzeViewHealth, analyzeViewReachability,
  buildAllNodesView, buildCausalIndex, buildFoldDepthView,
  compareCommunitiesToView, discoverGranularCommunities, discoverViewCommunities,
  expandEntity, findCausalChain, queryEntity, selectInducedSubgraph,
  validateCausalIndex,
} from '../analysis';
import type {
  AnalysisView, CausalEntity, CausalIndex, FoldDefinitionFile,
  FrontendLinkDefinition, FrontendServiceLinkDefinition,
} from '../analysis';

interface ViewSelection { readonly foldDepth?: number; readonly folds?: FoldDefinitionFile }
export type NativeAnalysisRequest =
  | { readonly op: 'index' | 'instances' | 'validate' | 'granularCommunities' }
  | { readonly op: 'entity' | 'expand'; readonly address: string }
  | { readonly op: 'path'; readonly addresses: readonly string[]; readonly maxDepth?: number; readonly maxPaths?: number }
  | { readonly op: 'select'; readonly nodeIds: readonly string[] }
  | ({ readonly op: 'view' | 'health' | 'centrality' | 'communities' } & ViewSelection)
  | ({ readonly op: 'reach'; readonly nodeId: string } & ViewSelection)
  | ({ readonly op: 'compareCommunities'; readonly referenceFolds: FoldDefinitionFile;
      readonly referenceFoldDepth: number } & ViewSelection);

interface LiveNode {
  readonly id: string;
  readonly state: Record<string, unknown>;
  readonly instance?: unknown;
}

/** Static instance evidence owned by the live native rule-space facade. */
export class NativeAnalysisEngine {
  private cachedIndex?: CausalIndex;

  constructor(
    private readonly liveNodes: () => LiveNode[],
    private readonly frontendLinks: readonly FrontendLinkDefinition[] = [],
    private readonly frontendServiceLinks: readonly FrontendServiceLinkDefinition[] = [],
  ) {}

  invalidate(): void { this.cachedIndex = undefined; }

  private index(): CausalIndex {
    if (this.cachedIndex) return this.cachedIndex;
    const live = this.liveNodes();
    const index = buildCausalIndex({
      nodeObjects: live.flatMap((entry) => entry.instance instanceof Node ? [entry.instance] : []),
      frontendLinks: this.frontendLinks,
      frontendServiceLinks: this.frontendServiceLinks,
    });
    for (const entry of live) {
      if (!index.nodes.has(entry.id)) {
        const entity: CausalEntity = {
          address: `node:${entry.id}`, kind: 'node', id: entry.id, name: entry.id,
          meta: { analysis: 'opaque-handler' },
        };
        index.entities.set(entity.address, entity);
        index.nodes.set(entry.id, entity);
      }
      for (const field of Object.keys(entry.state)) {
        const address = `state:${entry.id}::${field}`;
        if (index.states.has(address)) continue;
        const entity: CausalEntity = {
          address, kind: 'state', id: entry.id, nodeId: entry.id, subId: field,
          meta: { analysis: 'live-state' },
        };
        index.entities.set(address, entity);
        index.states.set(address, entity);
      }
    }
    this.cachedIndex = index;
    return index;
  }

  private view(selection: ViewSelection): AnalysisView {
    const base = buildAllNodesView(this.index());
    if (selection.foldDepth === undefined && !selection.folds) return base;
    let autoRoot = 'world';
    while (base.nodes.has(autoRoot) || base.nodes.has(`fold:${autoRoot}`)) autoRoot = `_${autoRoot}`;
    const folds = selection.folds ?? {
      version: 1 as const,
      root: autoRoot,
      groups: { [autoRoot]: { children: [...base.nodes.keys()].sort() } },
    };
    return buildFoldDepthView(base, folds, selection.foldDepth ?? 1);
  }

  analyze(request: NativeAnalysisRequest): unknown {
    const index = this.index();
    switch (request.op) {
      case 'index': return index;
      case 'instances': return index.nodeObjectFacts;
      case 'validate': return validateCausalIndex(index);
      case 'entity': return queryEntity(index, request.address);
      case 'expand': return expandEntity(index, request.address);
      case 'path': return findCausalChain(index, request.addresses, {
        maxDepth: request.maxDepth, maxPaths: request.maxPaths,
      });
      case 'select': return selectInducedSubgraph(index, [...request.nodeIds]);
      case 'view': return this.view(request);
      case 'health': return analyzeViewHealth(this.view(request));
      case 'reach': return analyzeViewReachability(this.view(request), request.nodeId);
      case 'centrality': return analyzeViewCentrality(this.view(request));
      case 'communities': return discoverViewCommunities(this.view(request));
      case 'granularCommunities': return discoverGranularCommunities(index);
      case 'compareCommunities': {
        const discoveredView = this.view(request);
        const referenceView = buildFoldDepthView(
          buildAllNodesView(index), request.referenceFolds, request.referenceFoldDepth,
        );
        return compareCommunitiesToView(
          discoverViewCommunities(discoveredView), discoveredView, referenceView,
        );
      }
      default: throw new Error(`Unknown analysis operation: ${(request as { op?: unknown }).op}`);
    }
  }
}

/** Turn Map-based analysis results into stable JSON DTOs for Agent transport. */
export function analysisToDto(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, item]) => [key, analysisToDto(item)]));
  }
  if (Array.isArray(value)) return value.map(analysisToDto);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, analysisToDto(item)]));
  }
  return value;
}
