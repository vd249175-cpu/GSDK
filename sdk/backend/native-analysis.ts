import { Node } from '@graphvideo/kernel';
import { extractPortableAnalysisSnapshots } from '../analysis/portable-facts';
import type {
  FoldDefinitionFile, FrontendLinkDefinition, FrontendServiceLinkDefinition,
  PortableAnalysisSnapshot,
} from '../analysis';

interface ViewSelection {
  readonly foldDepth?: number;
  readonly folds?: FoldDefinitionFile;
}

interface CentralityOptions {
  readonly damping?: number;
  readonly maxIterations?: number;
  readonly tolerance?: number;
}

interface CommunityOptions {
  readonly modularityResolution?: number;
  readonly maxLevels?: number;
  readonly maxPasses?: number;
  readonly minimumGain?: number;
}

export type NativeAnalysisRequest =
  | { readonly op: 'index' | 'facts' | 'validate' }
  | { readonly op: 'entity' | 'expand'; readonly address: string }
  | { readonly op: 'path'; readonly addresses: readonly string[]; readonly maxDepth?: number; readonly maxPaths?: number }
  | { readonly op: 'select'; readonly nodeIds: readonly string[] }
  | ({ readonly op: 'view' | 'health' } & ViewSelection)
  | ({ readonly op: 'reach'; readonly nodeId: string } & ViewSelection)
  | ({ readonly op: 'centrality' } & ViewSelection & CentralityOptions)
  | ({ readonly op: 'communities' } & ViewSelection & CommunityOptions)
  | ({ readonly op: 'granularCommunities' } & CommunityOptions)
  | ({ readonly op: 'compareCommunities'; readonly referenceFolds: FoldDefinitionFile;
      readonly referenceFoldDepth: number } & ViewSelection & CommunityOptions);

interface LiveNode {
  readonly id: string;
  readonly state: Record<string, unknown>;
  readonly instance?: unknown;
}

export type NativeAnalyzeJson = (requestJson: string, factsJson: string) => string;

/**
 * NativeRuleSpace analysis adapter. JavaScript only extracts portable facts
 * from live JS instances; every query, fold and metric is computed by the
 * shared Rust `graphvideo-analysis` crate through N-API.
 */
export class NativeAnalysisEngine {
  private revision = 0;
  private cachedSnapshots?: PortableAnalysisSnapshot[];
  private readonly resultCache = new Map<string, string>();

  constructor(
    private readonly nativeAnalyze: NativeAnalyzeJson,
    private readonly liveNodes: () => LiveNode[],
    private readonly frontendLinks: readonly FrontendLinkDefinition[] = [],
    private readonly frontendServiceLinks: readonly FrontendServiceLinkDefinition[] = [],
    private readonly portableFacts: () => PortableAnalysisSnapshot[] = () => [],
  ) {}

  invalidate(): void {
    this.revision += 1;
    this.cachedSnapshots = undefined;
    this.resultCache.clear();
  }

  private snapshots(live: readonly LiveNode[]): PortableAnalysisSnapshot[] {
    if (this.cachedSnapshots) return this.cachedSnapshots;
    const supplied = this.portableFacts();
    const describedNodeIds = new Set(supplied.map((entry) => entry.nodeId));
    const jsNodes = live.flatMap((entry) => (
      !describedNodeIds.has(entry.id) && entry.instance instanceof Node ? [entry.instance] : []
    ));
    this.cachedSnapshots = [...supplied, ...extractPortableAnalysisSnapshots(jsNodes)]
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    return this.cachedSnapshots;
  }

  async analyze(request: NativeAnalysisRequest): Promise<unknown> {
    const live = this.liveNodes();
    const stateKeys = Object.fromEntries(live
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => [entry.id, Object.fromEntries(Object.keys(entry.state).sort()
        .map((key) => [key, null]))]));
    const key = `${this.revision}\0${JSON.stringify(stateKeys)}\0${JSON.stringify(request)}`;
    const cached = this.resultCache.get(key);
    if (cached !== undefined) return JSON.parse(cached) as unknown;
    const resultJson = this.nativeAnalyze(
      JSON.stringify(request),
      JSON.stringify({
        snapshots: this.snapshots(live),
        liveStates: stateKeys,
        frontendLinks: this.frontendLinks,
        frontendServiceLinks: this.frontendServiceLinks,
      }),
    );
    if (this.resultCache.size >= 16) {
      const oldest = this.resultCache.keys().next().value;
      if (oldest !== undefined) this.resultCache.delete(oldest);
    }
    this.resultCache.set(key, resultJson);
    return JSON.parse(resultJson) as unknown;
  }
}
