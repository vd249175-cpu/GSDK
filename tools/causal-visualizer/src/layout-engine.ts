import type { CausalCommunity3D, CausalEdge3D, CausalNode3D } from './types'

export interface RawNodeInput {
  nodeId: string
  generation?: number | null
  version?: number
  state?: Record<string, unknown>
  status?: string
}

export interface RawEdgeInput {
  from: string
  to: string
  infoType?: string
}

export type LayoutMode = 'community' | 'pipeline'

export interface LayoutResult {
  nodes: CausalNode3D[]
  edges: CausalEdge3D[]
  communities: CausalCommunity3D[]
}

const COMMUNITY_PALETTES = [
  '#06b6d4', // 电光青（文档与解析）
  '#f59e0b', // 琥珀金（持久化与注册表）
  '#a855f7', // 幽紫色（智算与生成）
  '#10b981', // 翡翠绿（平台与宿主）
  '#ec4899', // 霓虹粉（风控与辅助）
  '#3b82f6', // 湛蓝色（观察与同步）
]

export function inferNodeRole(nodeId: string): 'domain' | 'observation' | 'execution' {
  if (nodeId.startsWith('src-') || nodeId.includes('observer') || nodeId.includes('poll')) {
    return 'observation'
  }
  if (
    nodeId.startsWith('sink-') ||
    nodeId.startsWith('host-') ||
    nodeId.includes('writer') ||
    nodeId.includes('download') ||
    nodeId.includes('submit')
  ) {
    return 'execution'
  }
  return 'domain'
}

/**
 * 图无关标签传播聚类算法 (Label Propagation Algorithm, LPA)
 * 纯图无关：输入任意有向图与节点，基于拓扑邻域密度自适应收敛出自然社区结构。
 */
export function detectGraphCommunities(
  nodeIds: string[],
  edges: RawEdgeInput[],
  inDegree: Map<string, number>,
  outDegree: Map<string, number>,
): Map<string, string[]> {
  const communities = new Map<string, string>()
  const neighbors = new Map<string, Array<{ id: string; weight: number }>>()

  for (const id of nodeIds) {
    communities.set(id, id)
    neighbors.set(id, [])
  }

  for (const e of edges) {
    if (neighbors.has(e.from) && neighbors.has(e.to)) {
      // 正向因果权重 2.0，反向关联权重 1.0
      neighbors.get(e.from)!.push({ id: e.to, weight: 2.0 })
      neighbors.get(e.to)!.push({ id: e.from, weight: 1.0 })
    }
  }

  // 迭代标签传播（最多 8 轮，通常 3-5 轮收敛）
  let changed = true
  let iter = 0
  while (changed && iter < 8) {
    changed = false
    iter++
    // 按节点度数从大到小确定性排序传播，避免随机波动
    const sorted = [...nodeIds].sort((a, b) => {
      const degA = (inDegree.get(a) || 0) + (outDegree.get(a) || 0)
      const degB = (inDegree.get(b) || 0) + (outDegree.get(b) || 0)
      return degB - degA || a.localeCompare(b)
    })

    for (const u of sorted) {
      const nbrs = neighbors.get(u) || []
      if (nbrs.length === 0) continue

      const labelWeights = new Map<string, number>()
      for (const nbr of nbrs) {
        const lbl = communities.get(nbr.id)!
        labelWeights.set(lbl, (labelWeights.get(lbl) || 0) + nbr.weight)
      }

      let bestLabel = communities.get(u)!
      let maxWeight = labelWeights.get(bestLabel) || 0

      for (const [lbl, wt] of labelWeights.entries()) {
        if (wt > maxWeight || (wt === maxWeight && lbl.localeCompare(bestLabel) < 0)) {
          bestLabel = lbl
          maxWeight = wt
        }
      }

      if (bestLabel !== communities.get(u)) {
        communities.set(u, bestLabel)
        changed = true
      }
    }
  }

  // 整理社区分组
  const groups = new Map<string, string[]>()
  for (const [nodeId, commId] of communities.entries()) {
    if (!groups.has(commId)) groups.set(commId, [])
    groups.get(commId)!.push(nodeId)
  }

  return groups
}

/**
 * 纯图无关 3D 拓扑布局引擎 (Graph-Agnostic 3D Layout Engine)
 * 支持：
 * 1. 3D 拓扑群落聚类布局 (community mode, 默认)：LPA 自然聚类 + 社区 Pod 星云空间放射排布
 * 2. 因果流水线分层布局 (pipeline mode)：BFS 拓扑分层 + X 轴流水线圆环展开
 */
export function computeGraphAgnosticLayout(
  rawNodes: RawNodeInput[],
  rawEdges: RawEdgeInput[],
  mode: LayoutMode = 'community',
): LayoutResult {
  const nodeCount = rawNodes.length
  if (nodeCount === 0) return { nodes: [], edges: [], communities: [] }

  const nodeMap = new Map<string, RawNodeInput>()
  for (const n of rawNodes) nodeMap.set(n.nodeId, n)

  // 1. 构建邻接与度数统计
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const n of rawNodes) {
    inDegree.set(n.nodeId, 0)
    outDegree.set(n.nodeId, 0)
  }

  for (const e of rawEdges) {
    if (inDegree.has(e.to) && outDegree.has(e.from)) {
      inDegree.set(e.to, inDegree.get(e.to)! + 1)
      outDegree.set(e.from, outDegree.get(e.from)! + 1)
    }
  }

  // 2. 运行 LPA 社区聚类算法
  const nodeIds = rawNodes.map((n) => n.nodeId)
  const rawCommunityGroups = detectGraphCommunities(nodeIds, rawEdges, inDegree, outDegree)

  // 社区元信息解析与 Hub 节点识别
  const communityList: CausalCommunity3D[] = []
  let commIdx = 0
  for (const [rawId, members] of rawCommunityGroups.entries()) {
    // 找出社区内度数最高的中枢节点 (Hub)
    let hubNodeId = members[0]
    let maxDeg = -1
    for (const m of members) {
      const deg = (inDegree.get(m) || 0) * 1.2 + (outDegree.get(m) || 0)
      if (deg > maxDeg) {
        maxDeg = deg
        hubNodeId = m
      }
    }

    const color = COMMUNITY_PALETTES[commIdx % COMMUNITY_PALETTES.length]
    communityList.push({
      id: rawId,
      name: `群落 ${commIdx + 1} (${hubNodeId})`,
      color,
      center: [0, 0, 0],
      radius: Math.max(8, Math.sqrt(members.length) * 5.2),
      nodeIds: members,
      hubNodeId,
    })
    commIdx++
  }

  // 计算各社区在 3D 全局空间中的星云 Pod 中心坐标
  const commCount = communityList.length
  const globalPodRadius = commCount <= 1 ? 0 : Math.max(22, commCount * 11)

  communityList.forEach((comm, cIdx) => {
    if (commCount === 1) {
      comm.center = [0, 0, 0]
    } else {
      const angle = (cIdx / commCount) * Math.PI * 2
      const cx = Math.cos(angle) * globalPodRadius
      const cz = Math.sin(angle) * globalPodRadius
      const cy = Math.sin(cIdx * 1.8) * 4.0 // 高度参差
      comm.center = [cx, cy, cz]
    }
  })

  // 3. 计算节点在 3D 空间中的排布
  const finalNodes: CausalNode3D[] = []
  const derivativeEdges: CausalEdge3D[] = []

  if (mode === 'community') {
    // === 模式 A：3D 拓扑群落聚类排布（中枢纯领域核心，上浮观察层，下沉操作层） ===
    for (const comm of communityList) {
      const members = comm.nodeIds
      const [cx, cy, cz] = comm.center
      const hubId = comm.hubNodeId

      // 分离纯领域核心节点、观察层节点 (src-*)、操作层节点 (sink-*, host-*)
      const domainIds: string[] = []
      const obsIds: string[] = []
      const execIds: string[] = []

      for (const mId of members) {
        const role = inferNodeRole(mId)
        if (role === 'observation') obsIds.push(mId)
        else if (role === 'execution') execIds.push(mId)
        else domainIds.push(mId)
      }

      // 若群落内全为外部世界节点，将 Hub 提升为领域锚点基准
      if (domainIds.length === 0) {
        domainIds.push(hubId)
        const obsIdx = obsIds.indexOf(hubId)
        if (obsIdx !== -1) obsIds.splice(obsIdx, 1)
        const execIdx = execIds.indexOf(hubId)
        if (execIdx !== -1) execIds.splice(execIdx, 1)
      }

      // 1. 中枢核心层（Y=cy 核心基准平面）
      const domainPositions = new Map<string, [number, number, number]>()
      const otherDomains = domainIds.filter((id) => id !== hubId)

      // Hub 置于群落几何中心
      const hubRaw = nodeMap.get(hubId)!
      domainPositions.set(hubId, [cx, cy, cz])
      finalNodes.push({
        id: hubId,
        name: hubId,
        color: comm.color,
        position: [cx, cy, cz],
        generation: hubRaw.generation !== undefined ? hubRaw.generation : 0,
        version: hubRaw.version || 0,
        status: (hubRaw.status as any) || 'IDLE',
        state: hubRaw.state || {},
        role: inferNodeRole(hubId),
        communityId: comm.id,
        communityName: comm.name,
        inDegree: inDegree.get(hubId) || 0,
        outDegree: outDegree.get(hubId) || 0,
        isHub: true,
      })

      // 其余领域核心节点水平环形展开
      otherDomains.forEach((dId, dIdx) => {
        const raw = nodeMap.get(dId)!
        const angle = (dIdx / Math.max(1, otherDomains.length)) * Math.PI * 2 + (comm.center[0] * 0.1)
        const r = Math.min(comm.radius * 0.75, 12)
        const dx = cx + Math.cos(angle) * r
        const dz = cz + Math.sin(angle) * r
        const dy = cy + (dIdx % 2 === 0 ? 0.6 : -0.6) // 轻微高低起伏
        domainPositions.set(dId, [dx, dy, dz])

        finalNodes.push({
          id: dId,
          name: dId,
          color: comm.color,
          position: [dx, dy, dz],
          generation: raw.generation !== undefined ? raw.generation : 0,
          version: raw.version || 0,
          status: (raw.status as any) || 'IDLE',
          state: raw.state || {},
          role: inferNodeRole(dId),
          communityId: comm.id,
          communityName: comm.name,
          inDegree: inDegree.get(dId) || 0,
          outDegree: outDegree.get(dId) || 0,
          isHub: false,
        })
      })

      // 辅助函数：寻找最近有因果连接的领域核心节点作为垂直锚点
      const findAnchorDomain = (targetId: string): { id: string; pos: [number, number, number] } => {
        for (const e of rawEdges) {
          if (e.from === targetId && domainPositions.has(e.to)) {
            return { id: e.to, pos: domainPositions.get(e.to)! }
          }
          if (e.to === targetId && domainPositions.has(e.from)) {
            return { id: e.from, pos: domainPositions.get(e.from)! }
          }
        }
        return { id: hubId, pos: domainPositions.get(hubId)! }
      }

      // 2. 观察层海岛 (位于海湾外缘海角礁盘，迎风瞭望)
      obsIds.forEach((obsId, oIdx) => {
        const raw = nodeMap.get(obsId)!
        const anchor = findAnchorDomain(obsId)
        const angle = (oIdx / Math.max(1, obsIds.length)) * Math.PI + (comm.center[0] * 0.1)
        const dist = Math.min(comm.radius * 0.7, 10.5) + 3.0
        const ox = anchor.pos[0] + Math.cos(angle) * dist
        const oy = 0.6 // 悬崖礁石略微高于海面
        const oz = anchor.pos[2] + Math.sin(angle) * dist

        finalNodes.push({
          id: obsId,
          name: obsId,
          color: '#0284c7', // 蔚蓝海岛色
          position: [ox, oy, oz],
          generation: raw.generation !== undefined ? raw.generation : 0,
          version: raw.version || 0,
          status: (raw.status as any) || 'IDLE',
          state: raw.state || {},
          role: 'observation',
          parentDomainNodeId: anchor.id,
          communityId: comm.id,
          communityName: comm.name,
          inDegree: inDegree.get(obsId) || 0,
          outDegree: outDegree.get(obsId) || 0,
          isHub: false,
        })

        // 添加近岸航道细线
        derivativeEdges.push({
          id: `stalk-${obsId}->${anchor.id}`,
          from: obsId,
          to: anchor.id,
          color: '#38bdf8',
          active: true,
          isVerticalStalk: true,
          lastInfoType: 'CoastalChannel',
        })
      })

      // 3. 操作层海岛 (位于深水良港侧，垂钓码头)
      execIds.forEach((execId, eIdx) => {
        const raw = nodeMap.get(execId)!
        const anchor = findAnchorDomain(execId)
        const angle = Math.PI + (eIdx / Math.max(1, execIds.length)) * Math.PI + (comm.center[0] * 0.1)
        const dist = Math.min(comm.radius * 0.7, 10.5) + 3.0
        const ex = anchor.pos[0] + Math.cos(angle) * dist
        const ey = -0.15 // 栈桥贴近海平面
        const ez = anchor.pos[2] + Math.sin(angle) * dist

        finalNodes.push({
          id: execId,
          name: execId,
          color: '#f59e0b', // 暖金港口色
          position: [ex, ey, ez],
          generation: raw.generation !== undefined ? raw.generation : 0,
          version: raw.version || 0,
          status: (raw.status as any) || 'IDLE',
          state: raw.state || {},
          role: 'execution',
          parentDomainNodeId: anchor.id,
          communityId: comm.id,
          communityName: comm.name,
          inDegree: inDegree.get(execId) || 0,
          outDegree: outDegree.get(execId) || 0,
          isHub: false,
        })

        // 添加近岸航道细线
        derivativeEdges.push({
          id: `stalk-${anchor.id}->${execId}`,
          from: anchor.id,
          to: execId,
          color: '#f59e0b',
          active: true,
          isVerticalStalk: true,
          lastInfoType: 'HarborChannel',
        })
      })
    }
  } else {
    // === 模式 B：因果流水线 BFS 拓扑分层排布 ===
    const tiers = new Map<string, number>()
    const roots: string[] = []
    for (const n of rawNodes) {
      if ((inDegree.get(n.nodeId) || 0) === 0) {
        roots.push(n.nodeId)
        tiers.set(n.nodeId, 0)
      }
    }
    if (roots.length === 0 && rawNodes.length > 0) {
      roots.push(rawNodes[0].nodeId)
      tiers.set(rawNodes[0].nodeId, 0)
    }

    const queue = [...roots]
    const visited = new Set<string>(roots)
    while (queue.length > 0) {
      const curr = queue.shift()!
      const currTier = tiers.get(curr) || 0
      for (const e of rawEdges) {
        if (e.from === curr) {
          const nxt = e.to
          const existingTier = tiers.get(nxt) ?? -1
          if (currTier + 1 > existingTier) tiers.set(nxt, currTier + 1)
          if (!visited.has(nxt)) {
            visited.add(nxt)
            queue.push(nxt)
          }
        }
      }
    }

    for (const n of rawNodes) {
      if (!tiers.has(n.nodeId)) tiers.set(n.nodeId, 0)
    }

    let maxTier = 0
    const tierBuckets = new Map<number, string[]>()
    for (const [nodeId, t] of tiers.entries()) {
      if (t > maxTier) maxTier = t
      if (!tierBuckets.has(t)) tierBuckets.set(t, [])
      tierBuckets.get(t)!.push(nodeId)
    }

    const layerSpacing = 16
    const startX = -(maxTier * layerSpacing) / 2

    for (let t = 0; t <= maxTier; t++) {
      const bucket = tierBuckets.get(t) || []
      const layerX = startX + t * layerSpacing
      const count = bucket.length
      const radius = count <= 1 ? 0 : Math.max(6, Math.sqrt(count) * 4.2)
      const angleOffset = (t * Math.PI) / 6

      bucket.forEach((nodeId, idx) => {
        const raw = nodeMap.get(nodeId)!
        let y = 0
        let z = 0
        if (count > 1) {
          const angle = (idx / count) * Math.PI * 2 + angleOffset
          y = Math.sin(angle) * radius
          z = Math.cos(angle) * radius
        }

        const comm = communityList.find((c) => c.nodeIds.includes(nodeId))
        finalNodes.push({
          id: nodeId,
          name: nodeId,
          color: comm?.color || '#38bdf8',
          position: [layerX, y, z],
          generation: raw.generation !== undefined ? raw.generation : 0,
          version: raw.version || 0,
          status: (raw.status as any) || 'IDLE',
          state: raw.state || {},
          role: inferNodeRole(nodeId),
          tier: t,
          communityId: comm?.id,
          communityName: comm?.name,
          inDegree: inDegree.get(nodeId) || 0,
          outDegree: outDegree.get(nodeId) || 0,
          isHub: comm?.hubNodeId === nodeId,
        })
      })
    }
  }

  // 4. 组装边（普通因果边 + 垂直衍生导管边）
  const finalEdges: CausalEdge3D[] = rawEdges.map((e) => {
    const sourceNode = finalNodes.find((n) => n.id === e.from)
    const targetNode = finalNodes.find((n) => n.id === e.to)
    const isInterCommunity = sourceNode?.communityId !== targetNode?.communityId
    // 跨群落连线赋予高亮能量色，群落内连线遵循源头色
    const color = isInterCommunity ? '#38bdf8' : sourceNode?.color || '#38bdf8'
    return {
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      color,
      active: false,
      isVerticalStalk: false,
      lastInfoType: e.infoType,
    }
  })

  // 汇入上下衍生细线导管
  for (const dEdge of derivativeEdges) {
    if (!finalEdges.some((e) => e.id === dEdge.id)) {
      finalEdges.push(dEdge)
    }
  }

  return { nodes: finalNodes, edges: finalEdges, communities: communityList }
}
