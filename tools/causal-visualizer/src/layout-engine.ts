import type { CausalCommunity3D, CausalEdge3D, CausalNode3D } from './types'
import { hashString } from './voxel-models'

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

  // 3. 计算 2D 全域海面无重叠群岛排布 (2D Force-Directed Collision-Free Archipelago Layout)
  interface SimNode2D {
    id: string
    x: number
    z: number
    vx: number
    vz: number
    safeDist: number
    communityId: string
    targetX?: number
    isHub: boolean
    role: 'observation' | 'execution' | 'domain'
  }

  const simNodes: SimNode2D[] = []
  const commCount = communityList.length
  const globalPodRadius = commCount <= 1 ? 0 : Math.max(34, commCount * 18)

  // A. 初始化群落海域中心 (2D 海面坐标)
  communityList.forEach((comm, cIdx) => {
    if (commCount === 1) {
      comm.center = [0, 0, 0]
    } else {
      const angle = (cIdx / commCount) * Math.PI * 2
      const cx = Math.cos(angle) * globalPodRadius
      const cz = Math.sin(angle) * globalPodRadius
      comm.center = [cx, 0.0, cz]
    }
  })

  // B. 节点初始位置播种 (2D 伪随机有机扩散)
  if (mode === 'community') {
    for (const comm of communityList) {
      const [cx, , cz] = comm.center
      const members = comm.nodeIds
      const hubId = comm.hubNodeId

      members.forEach((mId, mIdx) => {
        const isHub = mId === hubId
        const role = inferNodeRole(mId)
        const safeDist = isHub ? 16.0 : (role === 'domain' ? 14.0 : 13.5)
        const seed = hashString(mId)

        let x = cx
        let z = cz

        if (!isHub) {
          // 黄金角发散螺旋播种，杜绝直线对齐与生硬圆环
          const goldenAngle = mIdx * 2.39996323 + (seed % 100) * 0.02
          const spiralR = 14.0 * Math.sqrt(mIdx + 0.5)
          x = cx + Math.cos(goldenAngle) * spiralR
          z = cz + Math.sin(goldenAngle) * spiralR

          // 观察节点灯塔向外海方向轻度偏置，增强迎风远眺意境
          if (role === 'observation' && (cx !== 0 || cz !== 0)) {
            const outLen = Math.sqrt(cx * cx + cz * cz) || 1
            x += (cx / outLen) * 6.0
            z += (cz / outLen) * 6.0
          }
        } else {
          x += ((seed % 17) - 8) * 0.2
          z += ((seed % 19) - 9) * 0.2
        }

        simNodes.push({
          id: mId,
          x,
          z,
          vx: 0,
          vz: 0,
          safeDist,
          communityId: comm.id,
          isHub,
          role,
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

    const layerSpacing = 22.0
    const startX = -(maxTier * layerSpacing) / 2

    for (let t = 0; t <= maxTier; t++) {
      const bucket = tierBuckets.get(t) || []
      const targetX = startX + t * layerSpacing
      const count = bucket.length

      bucket.forEach((nodeId, idx) => {
        const comm = communityList.find((c) => c.nodeIds.includes(nodeId))
        const isHub = comm?.hubNodeId === nodeId
        const role = inferNodeRole(nodeId)
        const safeDist = isHub ? 16.0 : (role === 'domain' ? 14.0 : 13.5)
        const seed = hashString(nodeId)

        // 在 Z 轴方向呈有机波浪发散，杜绝生硬一条直线
        const baseZ = (idx - (count - 1) / 2) * Math.max(16.0, Math.sqrt(count) * 12.0)
        const jitterX = ((seed % 13) - 6) * 1.2
        const jitterZ = ((seed % 17) - 8) * 1.5

        simNodes.push({
          id: nodeId,
          x: targetX + jitterX,
          z: baseZ + jitterZ,
          vx: 0,
          vz: 0,
          safeDist,
          communityId: comm?.id || 'default',
          targetX,
          isHub,
          role,
        })
      })
    }
  }

  // C. 2D 物理力学多轮松弛仿真 (180 Steps Velocity Verlet + Annealing)
  const node2DMap = new Map<string, SimNode2D>()
  simNodes.forEach((n) => node2DMap.set(n.id, n))
  const commMap = new Map<string, CausalCommunity3D>()
  communityList.forEach((c) => commMap.set(c.id, c))

  const totalSteps = 180
  for (let step = 0; step < totalSteps; step++) {
    const temp = Math.max(0.04, 1.0 - (step / totalSteps) * 0.94)

    // 1. 刚体硬碰撞排斥与库仑呼吸斥力 (All-Pairs Repulsion)
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i]
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j]
        let dx = b.x - a.x
        let dz = b.z - a.z
        let d = Math.sqrt(dx * dx + dz * dz)

        if (d < 0.001) {
          dx = ((hashString(a.id + b.id) % 10) - 5) * 0.1 || 0.1
          dz = ((hashString(b.id + a.id) % 10) - 5) * 0.1 || 0.1
          d = Math.sqrt(dx * dx + dz * dz)
        }

        const minDist = (a.safeDist + b.safeDist) / 2

        if (d < minDist) {
          // 强碰撞硬弹力：绝对杜绝岛屿重叠
          const overlap = minDist - d
          const force = (overlap / d) * 2.6
          const fx = force * dx
          const fz = force * dz
          a.vx -= fx
          a.vz -= fz
          b.vx += fx
          b.vz += fz
        } else {
          // 开阔海域舒展斥力
          const coulomb = Math.min(2.8, 220.0 / (d * d))
          const fx = (coulomb * dx) / d
          const fz = (coulomb * dz) / d
          a.vx -= fx
          a.vz -= fz
          b.vx += fx
          b.vz += fz
        }
      }
    }

    // 2. 因果航线连线弹簧引力 (Edge Springs)
    for (const e of rawEdges) {
      const a = node2DMap.get(e.from)
      const b = node2DMap.get(e.to)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dz = b.z - a.z
      const d = Math.max(0.001, Math.sqrt(dx * dx + dz * dz))
      const targetLen = 22.0 // 理想航运水道长度
      const spring = (d - targetLen) * 0.06
      const fx = (spring * dx) / d
      const fz = (spring * dz) / d
      a.vx += fx
      a.vz += fz
      b.vx -= fx
      b.vz -= fz
    }

    // 3. 群落归属向心力 / 流水线分层约束力
    if (mode === 'community') {
      for (const n of simNodes) {
        const comm = commMap.get(n.communityId)
        if (comm) {
          const dx = comm.center[0] - n.x
          const dz = comm.center[2] - n.z
          n.vx += dx * 0.024
          n.vz += dz * 0.024
        }
      }
    } else {
      for (const n of simNodes) {
        if (n.targetX !== undefined) {
          const dx = n.targetX - n.x
          n.vx += dx * 0.28
        }
      }
    }

    // 4. 退火阻尼与位移推进
    const maxVelocity = 5.5 * temp
    for (const n of simNodes) {
      const speed = Math.sqrt(n.vx * n.vx + n.vz * n.vz)
      if (speed > maxVelocity) {
        n.vx = (n.vx / speed) * maxVelocity
        n.vz = (n.vz / speed) * maxVelocity
      }
      n.x += n.vx * 0.82
      n.z += n.vz * 0.82
      n.vx *= 0.58
      n.vz *= 0.58
    }
  }

  // D. 物理硬刚体绝对无重叠碰撞消除 (Hard Distance Clearance Enforcement)
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i]
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.sqrt(dx * dx + dz * dz)
        const minDist = (a.safeDist + b.safeDist) / 2
        if (d < minDist) {
          const pen = (minDist - d) / 2
          const ux = d > 0.001 ? dx / d : 1
          const uz = d > 0.001 ? dz / d : 0
          a.x -= ux * pen
          a.z -= uz * pen
          b.x += ux * pen
          b.z += uz * pen
        }
      }
    }
  }

  // E. 精准动态回算群落海域领地中心与光环半径
  for (const comm of communityList) {
    const memberNodes = simNodes.filter((n) => comm.nodeIds.includes(n.id))
    if (memberNodes.length === 0) continue
    const avgX = memberNodes.reduce((acc, n) => acc + n.x, 0) / memberNodes.length
    const avgZ = memberNodes.reduce((acc, n) => acc + n.z, 0) / memberNodes.length
    let maxR = 6.0
    for (const n of memberNodes) {
      const dist = Math.sqrt((n.x - avgX) ** 2 + (n.z - avgZ) ** 2)
      if (dist + 5.5 > maxR) maxR = dist + 5.5
    }
    comm.center = [avgX, 0.0, avgZ]
    comm.radius = maxR
  }

  // F. 构筑最终 CausalNode3D 列表 (全部紧贴海平面 Y=0.0)
  const finalNodes: CausalNode3D[] = simNodes.map((s) => {
    const raw = nodeMap.get(s.id)!
    const comm = commMap.get(s.communityId)
    return {
      id: s.id,
      name: s.id,
      color: comm?.color || '#38bdf8',
      position: [s.x, 0.0, s.z],
      generation: raw.generation !== undefined ? raw.generation : 0,
      version: raw.version || 0,
      status: (raw.status as any) || 'IDLE',
      state: raw.state || {},
      role: s.role,
      communityId: comm?.id,
      communityName: comm?.name,
      inDegree: inDegree.get(s.id) || 0,
      outDegree: outDegree.get(s.id) || 0,
      isHub: s.isHub,
    }
  })

  // G. 组装近岸航运导道 (Coastal Fairways) 与全局因果航线
  const derivativeEdges: CausalEdge3D[] = []
  if (mode === 'community') {
    for (const comm of communityList) {
      const commMembers = comm.nodeIds
      const obsNodes = simNodes.filter((n) => n.communityId === comm.id && n.role === 'observation')
      const execNodes = simNodes.filter((n) => n.communityId === comm.id && n.role === 'execution')
      const domainNodes = simNodes.filter((n) => n.communityId === comm.id && n.role === 'domain')

      const findClosestDomainId = (target: SimNode2D): string => {
        if (domainNodes.length > 0) {
          let closest = domainNodes[0]
          let minDist = Infinity
          for (const d of domainNodes) {
            const dist = (d.x - target.x) ** 2 + (d.z - target.z) ** 2
            if (dist < minDist) {
              minDist = dist
              closest = d
            }
          }
          return closest.id
        }
        return comm.hubNodeId !== target.id ? comm.hubNodeId : (commMembers[0] || target.id)
      }

      obsNodes.forEach((obs) => {
        const anchorId = findClosestDomainId(obs)
        if (anchorId !== obs.id) {
          derivativeEdges.push({
            id: `coastal-${obs.id}->${anchorId}`,
            from: obs.id,
            to: anchorId,
            color: '#38bdf8',
            active: true,
            isVerticalStalk: true,
            lastInfoType: 'CoastalChannel',
          })
        }
      })

      execNodes.forEach((exec) => {
        const anchorId = findClosestDomainId(exec)
        if (anchorId !== exec.id) {
          derivativeEdges.push({
            id: `coastal-${anchorId}->${exec.id}`,
            from: anchorId,
            to: exec.id,
            color: '#f59e0b',
            active: true,
            isVerticalStalk: true,
            lastInfoType: 'HarborChannel',
          })
        }
      })
    }
  }

  // 4. 组装边（普通因果边 + 近岸航道边）
  const finalEdges: CausalEdge3D[] = rawEdges.map((e) => {
    const sourceNode = finalNodes.find((n) => n.id === e.from)
    const targetNode = finalNodes.find((n) => n.id === e.to)
    const isInterCommunity = sourceNode?.communityId !== targetNode?.communityId
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

  for (const dEdge of derivativeEdges) {
    if (!finalEdges.some((e) => e.id === dEdge.id)) {
      finalEdges.push(dEdge)
    }
  }

  return { nodes: finalNodes, edges: finalEdges, communities: communityList }
}
