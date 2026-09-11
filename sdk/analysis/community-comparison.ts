import type {
  AnalysisView,
  CommunityPartitionComparison,
  CommunityResult,
} from './model';

function choose2(value: number): number {
  return value < 2 ? 0 : value * (value - 1) / 2;
}

export function compareCommunityPartitions(
  discoveredViewId: string,
  referenceViewId: string,
  discovered: ReadonlyMap<string, string>,
  reference: ReadonlyMap<string, string>,
): CommunityPartitionComparison {
  const vertices = [...discovered.keys()].filter((vertex) => reference.has(vertex)).sort();
  const discoveredGroups = new Map<string, string[]>();
  const referenceGroups = new Map<string, string[]>();
  const contingency = new Map<string, number>();
  for (const vertex of vertices) {
    const discoveredId = discovered.get(vertex)!;
    const referenceId = reference.get(vertex)!;
    const discoveredMembers = discoveredGroups.get(discoveredId) ?? [];
    discoveredMembers.push(vertex);
    discoveredGroups.set(discoveredId, discoveredMembers);
    const referenceMembers = referenceGroups.get(referenceId) ?? [];
    referenceMembers.push(vertex);
    referenceGroups.set(referenceId, referenceMembers);
    const key = `${discoveredId}\0${referenceId}`;
    contingency.set(key, (contingency.get(key) ?? 0) + 1);
  }

  const n = vertices.length;
  let mutualInformation = 0;
  let discoveredEntropy = 0;
  let referenceEntropy = 0;
  if (n > 0) {
    for (const members of discoveredGroups.values()) {
      const probability = members.length / n;
      discoveredEntropy -= probability * Math.log(probability);
    }
    for (const members of referenceGroups.values()) {
      const probability = members.length / n;
      referenceEntropy -= probability * Math.log(probability);
    }
    for (const [key, count] of contingency) {
      const [discoveredId, referenceId] = key.split('\0');
      const discoveredSize = discoveredGroups.get(discoveredId)!.length;
      const referenceSize = referenceGroups.get(referenceId)!.length;
      mutualInformation += (count / n) * Math.log((count * n) / (discoveredSize * referenceSize));
    }
  }
  const entropyProduct = discoveredEntropy * referenceEntropy;
  const normalizedMutualInformation = entropyProduct > 0
    ? mutualInformation / Math.sqrt(entropyProduct)
    : discoveredEntropy === referenceEntropy ? 1 : 0;

  const sameInBoth = [...contingency.values()].reduce((sum, count) => sum + choose2(count), 0);
  const sameDiscovered = [...discoveredGroups.values()].reduce((sum, members) => sum + choose2(members.length), 0);
  const sameReference = [...referenceGroups.values()].reduce((sum, members) => sum + choose2(members.length), 0);
  const totalPairs = choose2(n);
  const expectedPairs = totalPairs > 0 ? (sameDiscovered * sameReference) / totalPairs : 0;
  const maxPairs = (sameDiscovered + sameReference) / 2;
  const adjustedRandDenominator = maxPairs - expectedPairs;
  const adjustedRandIndex = adjustedRandDenominator === 0
    ? sameInBoth === maxPairs ? 1 : 0
    : (sameInBoth - expectedPairs) / adjustedRandDenominator;
  const pairwisePrecision = sameDiscovered > 0 ? sameInBoth / sameDiscovered : sameReference === 0 ? 1 : 0;
  const pairwiseRecall = sameReference > 0 ? sameInBoth / sameReference : sameDiscovered === 0 ? 1 : 0;
  const pairwiseF1 = pairwisePrecision + pairwiseRecall > 0
    ? 2 * pairwisePrecision * pairwiseRecall / (pairwisePrecision + pairwiseRecall)
    : 0;

  const referenceSplits = [...referenceGroups.entries()].flatMap(([referenceCommunityId, members]) => {
    const discoveredCommunityIds = [...new Set(members.map((member) => discovered.get(member)!))].sort();
    return discoveredCommunityIds.length > 1
      ? [{ referenceCommunityId, discoveredCommunityIds, memberCount: members.length }]
      : [];
  }).sort((a, b) => b.memberCount - a.memberCount || a.referenceCommunityId.localeCompare(b.referenceCommunityId));
  const discoveredMerges = [...discoveredGroups.entries()].flatMap(([discoveredCommunityId, members]) => {
    const referenceCommunityIds = [...new Set(members.map((member) => reference.get(member)!))].sort();
    return referenceCommunityIds.length > 1
      ? [{ discoveredCommunityId, referenceCommunityIds, memberCount: members.length }]
      : [];
  }).sort((a, b) => b.memberCount - a.memberCount || a.discoveredCommunityId.localeCompare(b.discoveredCommunityId));

  return {
    discoveredViewId,
    referenceViewId,
    comparedVertexCount: n,
    discoveredCommunityCount: discoveredGroups.size,
    referenceCommunityCount: referenceGroups.size,
    normalizedMutualInformation,
    adjustedRandIndex,
    pairwisePrecision,
    pairwiseRecall,
    pairwiseF1,
    exactAgreement: referenceSplits.length === 0 && discoveredMerges.length === 0,
    referenceSplits,
    discoveredMerges,
  };
}

export function compareCommunitiesToView(
  result: CommunityResult,
  discoveredView: AnalysisView,
  referenceView: AnalysisView,
): CommunityPartitionComparison {
  if (result.resolution !== 'node') {
    throw new Error('颗粒社区不能与 Node 折叠视角直接比较');
  }
  const discovered = new Map<string, string>();
  for (const community of result.communities) {
    for (const viewNodeId of community.members) {
      const node = discoveredView.nodes.get(viewNodeId);
      if (!node) continue;
      node.sourceNodeIds.forEach((sourceNodeId) => discovered.set(sourceNodeId, community.id));
    }
  }
  return compareCommunityPartitions(
    result.viewId,
    referenceView.id,
    discovered,
    referenceView.baseNodeToViewNode,
  );
}
