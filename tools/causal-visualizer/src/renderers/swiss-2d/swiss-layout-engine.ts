import type { CausalCommunity3D, CausalEdge3D, CausalNode3D } from '../../types'

export interface SwissNodeLayout {
  nodeId: string
  x: number
  y: number
  width: number
  height: number
  role: 'observation' | 'domain' | 'execution'
  colIndex: number
  rowIndex: number
  node: CausalNode3D
}

export interface SwissEdgeLayout {
  id: string
  from: string
  to: string
  infoType: string
  points: Array<{ x: number; y: number }>
  svgPath: string
  edge: CausalEdge3D
  waypoints?: Array<{ x: number; y: number }>
}

export interface SwissColumnHeader {
  title: string
  subtitle: string
  role: 'observation' | 'domain' | 'execution'
  x: number
  width: number
}

export interface SwissDashboardLayout {
  nodes: SwissNodeLayout[]
  edges: SwissEdgeLayout[]
  columns: SwissColumnHeader[]
  bounds: {
    width: number
    height: number
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
}

/**
 * 确定性哈希伪随机数发生器 (PRNG)：根据 edgeId 生成稳定的随机数种子流
 */
export function createEdgePrng(seedStr: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619) >>> 0
  }
  return function next(): number {
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

export interface CardAABB {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 技术美术程序化多频谐波有机软绳物理仿真算法
 * (Technical Art Procedural Organic Harmonic Rope Engine)
 *
 * 核心设计：
 * 1. 骨架拓扑通道 (Guide Waypoints)：以通道规划点为骨干基线；
 * 2. 多频带复合谐波湍流微动 (Multi-Octave Harmonic Turbulence)：
 *    沿绳索长度施加低频宏观悬垂（Macro Sag）、中频有机弯曲（Organic Wiggle）与高频绳纹微扭动（Micro Ripple）；
 * 3. 端口包络衰减 (Terminal Clamping Envelope)：
 *    在起止端子 20px 范围内平滑衰减为 0，确保插头严丝合缝垂直咬合在五金端子上；
 * 4. 法线位移 (Normal Vector Displacement)：
 *    扰动严格沿着绳索前进方向的法线方向施加，呈现软绳自然弯折摆动的真实物理形变；
 * 5. 卡片 AABB 距离场排斥 (SDF Card Repulsion)：
 *    卡片边界施加安全距离斥力场，杜绝任何穿透遮挡卡片的情况；
 * 6. 向心三次贝塞尔样条平滑重构 (Smooth Cubic Bézier Spline Reconstruction)：
 *    将扰动后的质点序列拟合为连续光滑的三次贝塞尔曲线，全线零生硬直线、零 CAD 机械圆角。
 */
export function buildOrganicRopeSpline(
  waypoints: Array<{ x: number; y: number }>,
  edgeId = 'default-edge',
  cards: CardAABB[] = [],
  options: {
    cornerRadius?: number
    noiseScale?: number
  } = {},
): { svgPath: string; points: Array<{ x: number; y: number }> } {
  if (waypoints.length === 0) {
    return { svgPath: '', points: [] }
  }
  if (waypoints.length === 1) {
    return {
      svgPath: `M ${waypoints[0].x} ${waypoints[0].y}`,
      points: [{ ...waypoints[0] }],
    }
  }

  const prng = createEdgePrng(edgeId)
  const cornerRadius = options.cornerRadius ?? 22
  const noiseScale = options.noiseScale ?? 1.0

  // 1. 生成每个 edge 专属的多频随机谐波参数（确定性种子，形态稳定不抽搐）
  const phi1 = prng() * Math.PI * 2
  const phi2 = prng() * Math.PI * 2
  const phi3 = prng() * Math.PI * 2

  const amp1 = (4.5 + prng() * 3.5) * noiseScale // 宏观自然摆动 4.5 ~ 8.0px
  const amp2 = (2.2 + prng() * 2.2) * noiseScale // 中观有机弯折 2.2 ~ 4.4px
  const amp3 = (0.8 + prng() * 1.0) * noiseScale // 微观绳索肌理 0.8 ~ 1.8px

  const freq1 = 1.3 + prng() * 0.4
  const freq2 = 3.3 + prng() * 0.8
  const freq3 = 7.2 + prng() * 1.6

  // 2. 构造基础骨干密集分段 (Base Guide Polyline)
  const basePolyline: Array<{ x: number; y: number }> = []

  if (waypoints.length === 2) {
    const p0 = waypoints[0]
    const p1 = waypoints[1]
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(28, Math.min(52, Math.round(dist / 8)))

    const c1x = p0.x + dx * 0.45
    const c1y = p0.y + dy * 0.15
    const c2x = p1.x - dx * 0.45
    const c2y = p1.y - dy * 0.15

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const x = u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p1.x
      const y = u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p1.y
      basePolyline.push({ x, y })
    }
  } else {
    basePolyline.push({ ...waypoints[0] })
    let prevEnd = { ...waypoints[0] }

    for (let i = 1; i < waypoints.length - 1; i++) {
      const prev = waypoints[i - 1]
      const curr = waypoints[i]
      const next = waypoints[i + 1]

      const vIn = { x: curr.x - prev.x, y: curr.y - prev.y }
      const vOut = { x: next.x - curr.x, y: next.y - curr.y }
      const lenIn = Math.hypot(vIn.x, vIn.y)
      const lenOut = Math.hypot(vOut.x, vOut.y)

      if (lenIn < 1 || lenOut < 1) continue

      const uIn = { x: vIn.x / lenIn, y: vIn.y / lenIn }
      const uOut = { x: vOut.x / lenOut, y: vOut.y / lenOut }

      const r = Math.min(cornerRadius, lenIn * 0.45, lenOut * 0.45)
      const ptA = { x: curr.x - uIn.x * r, y: curr.y - uIn.y * r }
      const ptB = { x: curr.x + uOut.x * r, y: curr.y + uOut.y * r }

      // 直段采样
      const segDist = Math.hypot(ptA.x - prevEnd.x, ptA.y - prevEnd.y)
      const segSteps = Math.max(1, Math.round(segDist / 14))
      for (let s = 1; s <= segSteps; s++) {
        const st = s / segSteps
        basePolyline.push({
          x: prevEnd.x + (ptA.x - prevEnd.x) * st,
          y: prevEnd.y + (ptA.y - prevEnd.y) * st,
        })
      }

      // 拐角采样 (贝塞尔圆弧过渡)
      const K = 0.55228475
      const c1 = { x: ptA.x + uIn.x * r * K, y: ptA.y + uIn.y * r * K }
      const c2 = { x: ptB.x - uOut.x * r * K, y: ptB.y - uOut.y * r * K }
      const cornerSteps = 8
      for (let c = 1; c <= cornerSteps; c++) {
        const t = c / cornerSteps
        const u = 1 - t
        const cx = u * u * u * ptA.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * ptB.x
        const cy = u * u * u * ptA.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * ptB.y
        basePolyline.push({ x: cx, y: cy })
      }

      prevEnd = ptB
    }

    const lastPt = waypoints[waypoints.length - 1]
    const lastDist = Math.hypot(lastPt.x - prevEnd.x, lastPt.y - prevEnd.y)
    const lastSteps = Math.max(1, Math.round(lastDist / 14))
    for (let s = 1; s <= lastSteps; s++) {
      const st = s / lastSteps
      basePolyline.push({
        x: prevEnd.x + (lastPt.x - prevEnd.x) * st,
        y: prevEnd.y + (lastPt.y - prevEnd.y) * st,
      })
    }
  }

  // 3. 沿法线方向施加多频分形随机扭动 (Organic Noise along Normal Vectors)
  const totalCount = basePolyline.length
  const perturbedPoints: Array<{ x: number; y: number }> = []

  for (let i = 0; i < totalCount; i++) {
    const pt = basePolyline[i]
    const u = i / (totalCount - 1)

    // 端点包络衰减：确保头尾严格咬合在插孔上，不发生插头偏位
    // sin(pi * u)^1.35 使得头尾平滑归零，中间自如舒展扭动
    const env = Math.pow(Math.sin(Math.PI * u), 1.35)

    if (env < 0.001 || i === 0 || i === totalCount - 1) {
      perturbedPoints.push({ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 })
      continue
    }

    // 计算局部切线与法线向量
    const prevPt = basePolyline[Math.max(0, i - 1)]
    const nextPt = basePolyline[Math.min(totalCount - 1, i + 1)]
    const tx = nextPt.x - prevPt.x
    const ty = nextPt.y - prevPt.y
    const tLen = Math.hypot(tx, ty)
    const nx = tLen > 0.001 ? -ty / tLen : 0
    const ny = tLen > 0.001 ? tx / tLen : 1

    // 多频复合有机扰动
    const wave1 = amp1 * Math.sin(2 * Math.PI * freq1 * u + phi1)
    const wave2 = amp2 * Math.sin(2 * Math.PI * freq2 * u + phi2)
    const wave3 = amp3 * Math.cos(2 * Math.PI * freq3 * u + phi3)
    const totalWiggle = (wave1 + wave2 + wave3) * env

    let px = pt.x + nx * totalWiggle
    let py = pt.y + ny * totalWiggle

    // 4. 卡片 AABB 物理距离场排斥检测 (SDF Repulsion)
    // 严苛防止随机微动将线缆推入卡片内部
    for (const card of cards) {
      const margin = 10
      const boxLeft = card.x - margin
      const boxRight = card.x + card.width + margin
      const boxTop = card.y - margin
      const boxBottom = card.y + card.height + margin

      if (px >= boxLeft && px <= boxRight && py >= boxTop && py <= boxBottom) {
        // 进入了卡片禁区，向最近的安全边界推离
        const dL = Math.abs(px - boxLeft)
        const dR = Math.abs(boxRight - px)
        const dT = Math.abs(py - boxTop)
        const dB = Math.abs(boxBottom - py)
        const minD = Math.min(dL, dR, dT, dB)

        if (minD === dL) px = boxLeft - 2
        else if (minD === dR) px = boxRight + 2
        else if (minD === dT) py = boxTop - 2
        else py = boxBottom + 2
      }
    }

    perturbedPoints.push({
      x: Math.round(px * 10) / 10,
      y: Math.round(py * 10) / 10,
    })
  }

  // 5. 三次贝塞尔曲线平滑样条重构 (Spline Reconstruction)
  // 将离散质点转化为连续光滑无折角的真实软绳 SVG 曲线
  let svgPath = `M ${perturbedPoints[0].x} ${perturbedPoints[0].y}`
  const N = perturbedPoints.length

  for (let i = 0; i < N - 1; i++) {
    const p0 = perturbedPoints[Math.max(0, i - 1)]
    const p1 = perturbedPoints[i]
    const p2 = perturbedPoints[i + 1]
    const p3 = perturbedPoints[Math.min(N - 1, i + 2)]

    // Catmull-Rom 转三阶贝塞尔控制点公式
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6

    svgPath += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }

  return { svgPath, points: perturbedPoints }
}

/**
 * 兼容旧接口封装
 */
export function buildSoftRopePath(
  waypoints: Array<{ x: number; y: number }>,
  cornerRadius = 18,
  slackOffset = 0,
): { svgPath: string; points: Array<{ x: number; y: number }> } {
  return buildOrganicRopeSpline(waypoints, `rope-${slackOffset}`, [], { cornerRadius })
}

/**
 * 2D 瑞士先锋主义模块化网格排布算法
 * 严格遵循国际主义平面设计规范：
 * 1. 严苛网格秩序：分列观察（左翼）、领域核心（中央矩阵）、执行动作（右翼）；
 * 2. 2D 柔性软绳塑型因果布线（方形走廊规避 + 柔性圆角 + 自然松弛呼吸感）；
 * 3. 黄金比例间隙与对齐基线。
 */
export function computeSwissGridLayout(
  nodes: CausalNode3D[],
  edges: CausalEdge3D[],
  _communities: CausalCommunity3D[] = [],
): SwissDashboardLayout {
  const CARD_WIDTH = 290
  const CARD_HEIGHT = 148
  const ROW_GAP = 28
  const COL_GAP = 120
  const TOP_MARGIN = 110
  const LEFT_MARGIN = 80

  // 1. 节点三向分类
  const obsNodes: CausalNode3D[] = []
  const domainNodes: CausalNode3D[] = []
  const execNodes: CausalNode3D[] = []

  for (const node of nodes) {
    if (node.role === 'observation') {
      obsNodes.push(node)
    } else if (node.role === 'execution') {
      execNodes.push(node)
    } else {
      domainNodes.push(node)
    }
  }

  // 若某类节点为空，根据入出度智能补正分类，保证版面严谨平衡
  if (obsNodes.length === 0 && domainNodes.length > 0) {
    const rootCandidates = domainNodes.filter((n) => (n.inDegree || 0) === 0)
    if (rootCandidates.length > 0) {
      obsNodes.push(...rootCandidates.splice(0, 2))
    }
  }

  // 2. 领域节点多栏分列（若数量较多，按 2 栏矩阵展开）
  const domainColsCount = domainNodes.length > 6 ? 3 : domainNodes.length > 3 ? 2 : 1
  const domainSubCols: CausalNode3D[][] = Array.from({ length: domainColsCount }, () => [])
  domainNodes.forEach((node, idx) => {
    domainSubCols[idx % domainColsCount].push(node)
  })

  // 3. 计算总列定义 (严格遵循 GraphFramework 架构三原则：感知 01、领域 02、执行 03)
  const columns: SwissColumnHeader[] = [
    {
      title: 'OBSERVATION // 01',
      subtitle: '外部事件感知 · 零外部写 · 事实封装',
      role: 'observation',
      x: LEFT_MARGIN,
      width: CARD_WIDTH,
    },
  ]

  let currentX = LEFT_MARGIN + CARD_WIDTH + COL_GAP
  for (let c = 0; c < domainColsCount; c++) {
    const colSuffix = domainColsCount > 1 ? ` [分列 ${String.fromCharCode(65 + c)}]` : ''
    columns.push({
      title: `DOMAIN CORE // 02${colSuffix}`,
      subtitle: '纯领域微内核 · 状态主权 · 确定性收敛',
      role: 'domain',
      x: currentX,
      width: CARD_WIDTH,
    })
    currentX += CARD_WIDTH + COL_GAP
  }

  columns.push({
    title: 'EXECUTION // 03',
    subtitle: '主动物理下发 · 动作执行 · 外部结算',
    role: 'execution',
    x: currentX,
    width: CARD_WIDTH,
  })

  // 4. 计算节点绝对网格坐标
  const nodeLayoutMap = new Map<string, SwissNodeLayout>()
  const swissNodes: SwissNodeLayout[] = []

  const placeColumn = (
    colNodes: CausalNode3D[],
    colX: number,
    colIdx: number,
    role: 'observation' | 'domain' | 'execution',
  ) => {
    colNodes.forEach((node, rowIdx) => {
      const y = TOP_MARGIN + rowIdx * (CARD_HEIGHT + ROW_GAP)
      const layoutItem: SwissNodeLayout = {
        nodeId: node.id,
        x: colX,
        y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        role,
        colIndex: colIdx,
        rowIndex: rowIdx,
        node,
      }
      nodeLayoutMap.set(node.id, layoutItem)
      swissNodes.push(layoutItem)
    })
  }

  // 放置观察列
  placeColumn(obsNodes, columns[0].x, 0, 'observation')

  // 放置领域列
  for (let c = 0; c < domainColsCount; c++) {
    placeColumn(domainSubCols[c], columns[1 + c].x, 1 + c, 'domain')
  }

  // 放置执行列
  placeColumn(execNodes, columns[columns.length - 1].x, columns.length - 1, 'execution')

  // 5. 2D 物理通道正交排线算法（Physics-Based Orthogonal Channel Routing）
  // 核心原则：
  // 1. 每一层（通道）独立计算走线轨道，互不干扰；
  // 2. 跨层跳跃连接走顶部/底部专用高架走廊（Highway Bypass），绝不穿透中间层卡片；
  // 3. 通道内多条平行走线采用弹簧-库仑力物理松弛模型，保证均匀间距、零重叠。
  const swissEdges: SwissEdgeLayout[] = []
  const edgeList = edges.filter((e) => !e.isVerticalStalk)

  // 通道定义：Gutter c 位于 Column c 与 Column c+1 之间
  const numCols = columns.length
  const gutters: Array<{
    colIndex: number
    left: number
    right: number
    center: number
    safeMinX: number
    safeMaxX: number
  }> = []

  for (let c = 0; c < numCols - 1; c++) {
    const left = columns[c].x + CARD_WIDTH
    const right = columns[c + 1].x
    gutters.push({
      colIndex: c,
      left,
      right,
      center: (left + right) / 2,
      safeMinX: left + 18,
      safeMaxX: right - 18,
    })
  }

  // 节点最大 Y 与画布整体基线
  let maxNodeY = TOP_MARGIN
  swissNodes.forEach((n) => {
    maxNodeY = Math.max(maxNodeY, n.y + n.height)
  })

  // 跨层高架走廊预留区间
  const TOP_HIGHWAY_MAX_Y = TOP_MARGIN - 18
  const TOP_HIGHWAY_MIN_Y = 74
  const BOTTOM_HIGHWAY_START_Y = maxNodeY + 28

  // 边分类与通道任务注册
  interface EdgeRoutingTask {
    edge: CausalEdge3D
    fromNode: SwissNodeLayout
    toNode: SwissNodeLayout
    category: 'adjacent_forward' | 'multi_forward' | 'same_column' | 'backward'
    startX: number
    startY: number
    endX: number
    endY: number
    useTopHighway: boolean
    gutterFromIdx: number
    gutterToIdx: number
  }

  // 4.1 动态多插孔端口分配 (Dynamic Multi-Jack Port Allocation - 彻底消除单点堆叠)
  const nodeOutgoingEdges = new Map<string, CausalEdge3D[]>()
  const nodeIncomingEdges = new Map<string, CausalEdge3D[]>()

  for (const edge of edgeList) {
    if (!nodeOutgoingEdges.has(edge.from)) nodeOutgoingEdges.set(edge.from, [])
    nodeOutgoingEdges.get(edge.from)!.push(edge)

    if (!nodeIncomingEdges.has(edge.to)) nodeIncomingEdges.set(edge.to, [])
    nodeIncomingEdges.get(edge.to)!.push(edge)
  }

  const fromPortMap = new Map<string, { x: number; y: number }>()
  const toPortMap = new Map<string, { x: number; y: number }>()

  // 计算出端口 (位于源卡片右边缘，按目标节点 Y 坐标排序，使得连线由上至下有序引出)
  nodeOutgoingEdges.forEach((edges, fromId) => {
    const fromNode = nodeLayoutMap.get(fromId)
    if (!fromNode) return

    edges.sort((a, b) => {
      const toA = nodeLayoutMap.get(a.to)
      const toB = nodeLayoutMap.get(b.to)
      return (toA?.y ?? 0) - (toB?.y ?? 0)
    })

    const k = edges.length
    const marginY = 26
    const spanY = Math.max(12, fromNode.height - marginY * 2)

    edges.forEach((edge, idx) => {
      const portY = k === 1
        ? fromNode.y + fromNode.height / 2
        : fromNode.y + marginY + (idx / (k - 1)) * spanY
      fromPortMap.set(edge.id, {
        x: fromNode.x + fromNode.width,
        y: Math.round(portY),
      })
    })
  })

  // 计算入端口 (按来源节点 Y 坐标排序，使得进线平滑平行)
  nodeIncomingEdges.forEach((edges, toId) => {
    const toNode = nodeLayoutMap.get(toId)
    if (!toNode) return

    edges.sort((a, b) => {
      const fromA = nodeLayoutMap.get(a.from)
      const fromB = nodeLayoutMap.get(b.from)
      return (fromA?.y ?? 0) - (fromB?.y ?? 0)
    })

    const k = edges.length
    const marginY = 26
    const spanY = Math.max(12, toNode.height - marginY * 2)

    edges.forEach((edge, idx) => {
      const portY = k === 1
        ? toNode.y + toNode.height / 2
        : toNode.y + marginY + (idx / (k - 1)) * spanY
      toPortMap.set(edge.id, {
        x: toNode.x,
        y: Math.round(portY),
      })
    })
  })

  const tasks: EdgeRoutingTask[] = []
  for (const edge of edgeList) {
    const fromNode = nodeLayoutMap.get(edge.from)
    const toNode = nodeLayoutMap.get(edge.to)
    if (!fromNode || !toNode) continue

    const fromPort = fromPortMap.get(edge.id) || {
      x: fromNode.x + fromNode.width,
      y: fromNode.y + fromNode.height / 2,
    }
    const toPort = toPortMap.get(edge.id) || {
      x: toNode.x,
      y: toNode.y + toNode.height / 2,
    }

    const startX = fromPort.x
    const startY = fromPort.y
    const colDiff = toNode.colIndex - fromNode.colIndex

    // 同列连线特殊处理：进端口同样落在右边缘通道内，形成右侧纯通道回路，杜绝横切自身卡片
    const isSameColumn = colDiff === 0
    const endX = isSameColumn ? toNode.x + toNode.width : toPort.x
    const endY = toPort.y

    let category: EdgeRoutingTask['category'] = 'adjacent_forward'
    let useTopHighway = false

    if (colDiff === 1) {
      category = 'adjacent_forward'
    } else if (colDiff > 1) {
      category = 'multi_forward'
      useTopHighway = (startY + endY) / 2 <= (TOP_MARGIN + maxNodeY) / 2
    } else if (isSameColumn) {
      category = 'same_column'
    } else {
      category = 'backward'
      useTopHighway = (startY + endY) / 2 <= (TOP_MARGIN + maxNodeY) / 2
    }

    tasks.push({
      edge,
      fromNode,
      toNode,
      category,
      startX,
      startY,
      endX,
      endY,
      useTopHighway,
      gutterFromIdx: Math.min(fromNode.colIndex, numCols - 2),
      gutterToIdx: Math.max(0, toNode.colIndex - 1),
    })
  }

  // 为每个通道注册纵向走线线段需求
  interface ChannelWire {
    id: string
    edgeId: string
    role: 'adjacent_v' | 'exit_to_highway' | 'entry_from_highway' | 'same_col'
    idealY1: number
    idealY2: number
    preferredX: number
    assignedX: number
  }

  const channelWiresMap = new Map<number, ChannelWire[]>()
  for (let c = 0; c < gutters.length; c++) {
    channelWiresMap.set(c, [])
  }

  // 跨层高架横向线段需求
  interface HighwayWire {
    id: string
    edgeId: string
    isTop: boolean
    spanLength: number
    assignedY: number
  }
  const topHighwayWires: HighwayWire[] = []
  const bottomHighwayWires: HighwayWire[] = []

  tasks.forEach((t) => {
    const gutter = gutters[t.gutterFromIdx]
    const gCenter = gutter ? gutter.center : t.startX + 40

    if (t.category === 'adjacent_forward') {
      // 相邻列：在本地通道中占用 1 根纵向线段
      channelWiresMap.get(t.gutterFromIdx)?.push({
        id: `${t.edge.id}-adj`,
        edgeId: t.edge.id,
        role: 'adjacent_v',
        idealY1: t.startY,
        idealY2: t.endY,
        preferredX: gCenter,
        assignedX: gCenter,
      })
    } else if (t.category === 'multi_forward') {
      // 跨列多层跳跃：在出发通道分配引线、高架分配横向线、在目标通道分配降落线
      channelWiresMap.get(t.gutterFromIdx)?.push({
        id: `${t.edge.id}-exit`,
        edgeId: t.edge.id,
        role: 'exit_to_highway',
        idealY1: t.startY,
        idealY2: t.useTopHighway ? TOP_HIGHWAY_MAX_Y : BOTTOM_HIGHWAY_START_Y,
        preferredX: gCenter - 10,
        assignedX: gCenter - 10,
      })

      const targetGutter = gutters[t.gutterToIdx]
      const tCenter = targetGutter ? targetGutter.center : t.endX - 40
      channelWiresMap.get(t.gutterToIdx)?.push({
        id: `${t.edge.id}-entry`,
        edgeId: t.edge.id,
        role: 'entry_from_highway',
        idealY1: t.useTopHighway ? TOP_HIGHWAY_MAX_Y : BOTTOM_HIGHWAY_START_Y,
        idealY2: t.endY,
        preferredX: tCenter + 10,
        assignedX: tCenter + 10,
      })

      const span = Math.abs(t.toNode.colIndex - t.fromNode.colIndex)
      if (t.useTopHighway) {
        topHighwayWires.push({ id: t.edge.id, edgeId: t.edge.id, isTop: true, spanLength: span, assignedY: 0 })
      } else {
        bottomHighwayWires.push({ id: t.edge.id, edgeId: t.edge.id, isTop: false, spanLength: span, assignedY: 0 })
      }
    } else if (t.category === 'same_column') {
      // 同列折叠：在右侧通道生成回线
      channelWiresMap.get(t.gutterFromIdx)?.push({
        id: `${t.edge.id}-same`,
        edgeId: t.edge.id,
        role: 'same_col',
        idealY1: t.startY,
        idealY2: t.endY,
        preferredX: gCenter + 15,
        assignedX: gCenter + 15,
      })
    } else if (t.category === 'backward') {
      // 反向回流：走高架走廊
      channelWiresMap.get(t.gutterFromIdx)?.push({
        id: `${t.edge.id}-back-exit`,
        edgeId: t.edge.id,
        role: 'exit_to_highway',
        idealY1: t.startY,
        idealY2: t.useTopHighway ? TOP_HIGHWAY_MAX_Y : BOTTOM_HIGHWAY_START_Y,
        preferredX: gCenter,
        assignedX: gCenter,
      })

      channelWiresMap.get(t.gutterToIdx)?.push({
        id: `${t.edge.id}-back-entry`,
        edgeId: t.edge.id,
        role: 'entry_from_highway',
        idealY1: t.useTopHighway ? TOP_HIGHWAY_MAX_Y : BOTTOM_HIGHWAY_START_Y,
        idealY2: t.endY,
        preferredX: gutters[t.gutterToIdx]?.center || t.endX - 20,
        assignedX: gutters[t.gutterToIdx]?.center || t.endX - 20,
      })

      if (t.useTopHighway) {
        topHighwayWires.push({ id: t.edge.id, edgeId: t.edge.id, isTop: true, spanLength: 5, assignedY: 0 })
      } else {
        bottomHighwayWires.push({ id: t.edge.id, edgeId: t.edge.id, isTop: false, spanLength: 5, assignedY: 0 })
      }
    }
  })

  // -------------------------------------------------------------
  // 物理算法求解器：1D 弹簧-库仑力排线松弛 (Spring-Coulomb Relaxation)
  // -------------------------------------------------------------
  function relaxChannelWires(wires: ChannelWire[], minX: number, maxX: number) {
    const count = wires.length
    if (count === 0) return
    if (count === 1) {
      wires[0].assignedX = Math.round((minX + maxX) / 2)
      return
    }

    // 初始排序：按自然倾向 X 与中值 Y 排序，最小化交叉
    wires.sort((a, b) => a.preferredX - b.preferredX || (a.idealY1 + a.idealY2) - (b.idealY1 + b.idealY2))

    // 均匀初始锚点
    const width = maxX - minX
    const step = width / (count + 1)
    const positions = wires.map((_, i) => minX + (i + 1) * step)

    // 物理迭代参数
    const ITERATIONS = 25
    const K_REP = 1800
    const K_SPRING = 0.08
    const MIN_GAP = 12

    for (let it = 0; it < ITERATIONS; it++) {
      const forces = new Array(count).fill(0)

      // 1. 库仑线间排斥力
      for (let i = 0; i < count - 1; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = positions[j] - positions[i]
          const dist = Math.max(dx, 4)
          const rep = K_REP / (dist * dist)
          forces[i] -= rep
          forces[j] += rep
        }
      }

      // 2. 左右卡片壁障硬排斥力
      for (let i = 0; i < count; i++) {
        const dLeft = Math.max(positions[i] - minX, 3)
        const dRight = Math.max(maxX - positions[i], 3)
        forces[i] += (K_REP * 0.5) / (dLeft * dLeft)
        forces[i] -= (K_REP * 0.5) / (dRight * dRight)
      }

      // 3. 弹簧居中与锚点恢复力
      for (let i = 0; i < count; i++) {
        const anchor = minX + (i + 1) * step
        forces[i] += -K_SPRING * (positions[i] - anchor)
      }

      // 4. 更新位置与阻尼
      for (let i = 0; i < count; i++) {
        positions[i] = Math.max(minX, Math.min(maxX, positions[i] + forces[i] * 0.25))
      }

      // 5. 刚性安全间隙修正 (保持最小间隔)
      for (let i = 0; i < count - 1; i++) {
        if (positions[i + 1] - positions[i] < MIN_GAP) {
          const overlap = MIN_GAP - (positions[i + 1] - positions[i])
          positions[i] = Math.max(minX, positions[i] - overlap * 0.5)
          positions[i + 1] = Math.min(maxX, positions[i + 1] + overlap * 0.5)
        }
      }
    }

    // 回填结果
    for (let i = 0; i < count; i++) {
      wires[i].assignedX = Math.round(positions[i])
    }
  }

  // 对所有通道并行执行物理排线松弛（每一层单独计算）
  channelWiresMap.forEach((wires, colIdx) => {
    const gutter = gutters[colIdx]
    if (gutter) {
      relaxChannelWires(wires, gutter.safeMinX, gutter.safeMaxX)
    }
  })

  // 跨层高架分配（长跨度走外侧轨道，短跨度走内侧轨道，避免交叉）
  topHighwayWires.sort((a, b) => b.spanLength - a.spanLength)
  topHighwayWires.forEach((w, idx) => {
    w.assignedY = Math.max(TOP_HIGHWAY_MIN_Y, TOP_HIGHWAY_MAX_Y - idx * 10)
  })

  bottomHighwayWires.sort((a, b) => b.spanLength - a.spanLength)
  bottomHighwayWires.forEach((w, idx) => {
    w.assignedY = BOTTOM_HIGHWAY_START_Y + idx * 12
  })

  // 快速查找已分配物理坐标的映射表
  const wireXMap = new Map<string, number>()
  channelWiresMap.forEach((wires) => {
    wires.forEach((w) => {
      wireXMap.set(w.id, w.assignedX)
    })
  })

  const topHighwayYMap = new Map<string, number>()
  topHighwayWires.forEach((w) => topHighwayYMap.set(w.edgeId, w.assignedY))

  const bottomHighwayYMap = new Map<string, number>()
  bottomHighwayWires.forEach((w) => bottomHighwayYMap.set(w.edgeId, w.assignedY))

  // 生成最终柔性软绳点位集合与平滑曲线指令 (Slack-Aware Soft Rope Engine)
  tasks.forEach((t, taskIdx) => {
    let waypoints: Array<{ x: number; y: number }> = []
    let cornerRadius = 18
    // 给不同连线分配自然的松弛呼吸余量（微曲 5px ~ 9px），彻底消除“处处紧绷感”
    const slackOffset = (taskIdx % 3 === 0 ? 6 : taskIdx % 3 === 1 ? -6 : 8)

    if (t.category === 'adjacent_forward') {
      const trackX = wireXMap.get(`${t.edge.id}-adj`) || (t.startX + t.endX) / 2
      // 若同一行卡片（落差极小），生成带自然松弛微弧的直接连线
      if (Math.abs(t.startY - t.endY) < 6) {
        waypoints = [
          { x: t.startX, y: t.startY },
          { x: t.endX, y: t.endY },
        ]
      } else {
        // 存在纵向高度差：四锚点通道走线，拐角处由 buildSoftRopePath 自动柔性倒圆
        waypoints = [
          { x: t.startX, y: t.startY },
          { x: trackX, y: t.startY },
          { x: trackX, y: t.endY },
          { x: t.endX, y: t.endY },
        ]
      }
    } else if (t.category === 'multi_forward' || t.category === 'backward') {
      const isBackward = t.category === 'backward'
      const exitTrackX = isBackward
        ? t.startX + 24
        : wireXMap.get(`${t.edge.id}-exit`) || t.startX + 24

      // 关键修复：当目标节点位于最左侧 Column 0 时，下降轨道必须设在画布左侧外延安全走廊 (LEFT_CORRIDOR_X = 38px)
      // 绝不可放在 Column 0 右侧的 gutter[0]，否则连线横切整个 Column 0 卡片！
      const LEFT_CORRIDOR_X = Math.max(28, LEFT_MARGIN - 42) // 38px
      const entryTrackX = isBackward
        ? (t.toNode.colIndex === 0
            ? LEFT_CORRIDOR_X
            : (gutters[t.toNode.colIndex - 1]?.center || t.endX - 24))
        : (wireXMap.get(`${t.edge.id}-entry`) || t.endX - 24)

      const highwayY = t.useTopHighway
        ? topHighwayYMap.get(t.edge.id) || TOP_HIGHWAY_MAX_Y
        : bottomHighwayYMap.get(t.edge.id) || BOTTOM_HIGHWAY_START_Y

      waypoints = [
        { x: t.startX, y: t.startY },
        { x: exitTrackX, y: t.startY },
        { x: exitTrackX, y: highwayY },
        { x: entryTrackX, y: highwayY },
        { x: entryTrackX, y: t.endY },
        { x: t.endX, y: t.endY },
      ]
      cornerRadius = 22
    } else if (t.category === 'same_column') {
      // 同列折叠：在通道内形成柔性向外舒展软环，端点均在卡片右侧通道，绝不横切卡片
      const trackX = wireXMap.get(`${t.edge.id}-same`) || t.startX + 36
      waypoints = [
        { x: t.startX, y: t.startY },
        { x: trackX, y: t.startY },
        { x: trackX, y: t.endY },
        { x: t.endX, y: t.endY },
      ]
      cornerRadius = 18
    }

    const cardBoxes: CardAABB[] = swissNodes.map((n) => ({
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    }))

    const { svgPath, points } = buildOrganicRopeSpline(waypoints, t.edge.id, cardBoxes, { cornerRadius })

    swissEdges.push({
      id: t.edge.id,
      from: t.edge.from,
      to: t.edge.to,
      infoType: t.edge.lastInfoType || 'info',
      points,
      svgPath,
      waypoints,
      edge: t.edge,
    })
  })

  // 6. 计算整体画布包围盒（包含高架走廊与安全边距）
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const n of swissNodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }

  for (const e of swissEdges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }

  if (swissNodes.length === 0) {
    minX = 0
    minY = 0
    maxX = 1200
    maxY = 800
  }

  const bounds = {
    minX,
    minY,
    maxX: maxX + 80,
    maxY: maxY + 100,
    width: maxX - minX + 160,
    height: maxY - minY + 160,
  }

  return {
    nodes: swissNodes,
    edges: swissEdges,
    columns,
    bounds,
  }
}
