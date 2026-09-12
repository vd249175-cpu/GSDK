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
  const noiseScale = options.noiseScale ?? 1.0

  // 1. 生成每个 edge 专属的多频随机谐波相位（确定性种子，形态稳定不抽搐）
  const phi1 = prng() * Math.PI * 2
  const phi2 = prng() * Math.PI * 2
  const phi3 = prng() * Math.PI * 2

  // 2. 构造离散物理质点链 (Resample Waypoints into Uniform Particle Chain with Arc-length s)
  let totalLength = 0
  const segLengths: number[] = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const len = Math.hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].y - waypoints[i].y)
    segLengths.push(len)
    totalLength += len
  }

  // 短线自适应质点密度：短线不需要堆砌过量质点，避免数值震荡；长线保证平滑 (约 10px 一采样)
  const N = Math.max(16, Math.min(72, Math.round(totalLength / 10)))
  const particles: Array<{ x: number; y: number; s: number }> = []

  for (let i = 0; i < N; i++) {
    const targetDist = (i / (N - 1)) * totalLength
    let accumulated = 0
    let placed = false

    for (let s = 0; s < segLengths.length; s++) {
      if (accumulated + segLengths[s] >= targetDist || s === segLengths.length - 1) {
        const segT = segLengths[s] > 0.001 ? (targetDist - accumulated) / segLengths[s] : 0
        const p0 = waypoints[s]
        const p1 = waypoints[s + 1]
        particles.push({
          x: p0.x + (p1.x - p0.x) * segT,
          y: p0.y + (p1.y - p0.y) * segT,
          s: targetDist,
        })
        placed = true
        break
      }
      accumulated += segLengths[s]
    }
    if (!placed) {
      particles.push({ ...waypoints[waypoints.length - 1], s: totalLength })
    }
  }

  // 3. 纯物理排斥与张力松弛 (Pure Physical Repulsion & Tension Relaxation)
  // 彻底摒弃独立圆角算法！曲线弯折完全由寻路通道导引、抗弯曲张力平滑与卡片障碍物排斥场自然涌现！
  const RELAX_ITERATIONS = 32
  const K_REPULSION = 2400
  const SAFE_MARGIN = 14

  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    // 3.1 内部张力与抗弯曲拉伸松弛 (Laplacian Tension Smoothing)
    // 质点向相邻质点中点靠拢，消除硬拐角，呈现极其柔韧自然的绳索物理形变
    for (let i = 2; i < N - 2; i++) {
      const midX = (particles[i - 1].x + particles[i + 1].x) * 0.5
      const midY = (particles[i - 1].y + particles[i + 1].y) * 0.5
      particles[i].x += (midX - particles[i].x) * 0.4
      particles[i].y += (midY - particles[i].y) * 0.4
    }

    // 3.2 卡片障碍物边界与转角排斥力场 (Card Obstacle & Corner Repulsion Field)
    for (let i = 2; i < N - 2; i++) {
      const p = particles[i]

      for (const card of cards) {
        const boxLeft = card.x - SAFE_MARGIN
        const boxRight = card.x + card.width + SAFE_MARGIN
        const boxTop = card.y - SAFE_MARGIN
        const boxBottom = card.y + card.height + SAFE_MARGIN

        // 穿透硬排斥：严禁深入卡片禁区
        if (p.x >= boxLeft && p.x <= boxRight && p.y >= boxTop && p.y <= boxBottom) {
          const dL = p.x - boxLeft
          const dR = boxRight - p.x
          const dT = p.y - boxTop
          const dB = boxBottom - p.y
          const minD = Math.min(dL, dR, dT, dB)

          if (minD === dL) p.x = boxLeft - 2
          else if (minD === dR) p.x = boxRight + 2
          else if (minD === dT) p.y = boxTop - 2
          else p.y = boxBottom + 2
          continue
        }

        // 外部近场与角部排斥力场：距离卡片角部 24px 范围内产生径向强排斥，确保圆润环绕卡片外角流过绝不切角
        const nearestX = Math.max(card.x, Math.min(card.x + card.width, p.x))
        const nearestY = Math.max(card.y, Math.min(card.y + card.height, p.y))
        const dx = p.x - nearestX
        const dy = p.y - nearestY
        const dist = Math.hypot(dx, dy)

        const CORNER_RADIUS = 24
        if (dist > 0.001 && dist < CORNER_RADIUS) {
          const nx = dx / dist
          const ny = dy / dist
          const push = (CORNER_RADIUS - dist) * 0.45
          p.x += nx * push
          p.y += ny * push
        }
      }
    }

    // 3.3 端口切线水平咬合锚定 (Port Horizontal Tangent Pins)
    const pinOffset = Math.min(16, totalLength * 0.15)
    particles[1].x = particles[0].x + (particles[1].x >= particles[0].x ? pinOffset : -pinOffset)
    particles[1].y = particles[0].y
    particles[N - 2].x = particles[N - 1].x + (particles[N - 2].x >= particles[N - 1].x ? pinOffset : -pinOffset)
    particles[N - 2].y = particles[N - 1].y
  }

  const basePolyline = particles

  // 4. 基于物理弧长归一化的多频有机扰动 (Arc-Length Normalized Technical Art Wiggle)
  // 杜绝短线高频震荡、锯齿与抖动过大：
  // a) 空间波长以世界坐标物理像素为基准 (固定波长: 宏观 ~320px, 中观 ~160px, 微观 ~75px)
  // b) 振幅随总弧长物理归一化：短线（< 45px）紧绷笔直、振幅归零；中长线自然展开饱满垂坠
  // c) 端部插座保护包络：距两端插孔 14px 范围内严格衰减归零，杜绝插座口抖动锯齿
  const lengthFactor = Math.min(1.0, Math.max(0.0, (totalLength - 45) / 200))

  const wavelength1 = 300 + prng() * 80  // 宏观微垂波长 ~340px
  const wavelength2 = 150 + prng() * 40  // 中观有机波长 ~170px
  const wavelength3 = 70 + prng() * 20   // 微观触感波长 ~80px

  const baseAmp1 = (3.5 + prng() * 2.5) * noiseScale * lengthFactor
  const baseAmp2 = (1.8 + prng() * 1.5) * noiseScale * lengthFactor
  const baseAmp3 = (0.6 + prng() * 0.8) * noiseScale * lengthFactor

  const perturbedPoints: Array<{ x: number; y: number }> = []

  for (let i = 0; i < N; i++) {
    const pt = basePolyline[i]
    const s = pt.s
    const u = i / (N - 1)

    // 端点距离保护包络：距离两端插孔 14px 以内完全笔直锁定，14px 到 38px 平滑过渡
    const distFromEnd = Math.min(s, totalLength - s)
    const portClamp = distFromEnd < 14 ? 0 : Math.min(1.0, (distFromEnd - 14) / 24)
    const sineEnv = Math.sin(Math.PI * u)
    const env = Math.pow(Math.max(0, sineEnv), 1.25) * portClamp

    if (env < 0.001 || lengthFactor < 0.001 || i === 0 || i === N - 1) {
      perturbedPoints.push({ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 })
      continue
    }

    // 计算局部切线与法线向量
    const prevPt = basePolyline[Math.max(0, i - 1)]
    const nextPt = basePolyline[Math.min(N - 1, i + 1)]
    const tx = nextPt.x - prevPt.x
    const ty = nextPt.y - prevPt.y
    const tLen = Math.hypot(tx, ty)
    const nx = tLen > 0.001 ? -ty / tLen : 0
    const ny = tLen > 0.001 ? tx / tLen : 1

    // 基于物理弧长 s 计算世界坐标波形，消除短线参数 u 导致的频率暴增与锯齿
    const wave1 = baseAmp1 * Math.sin((2 * Math.PI * s) / wavelength1 + phi1)
    const wave2 = baseAmp2 * Math.sin((2 * Math.PI * s) / wavelength2 + phi2)
    const wave3 = baseAmp3 * Math.cos((2 * Math.PI * s) / wavelength3 + phi3)
    const totalWiggle = (wave1 + wave2 + wave3) * env

    let px = pt.x + nx * totalWiggle
    let py = pt.y + ny * totalWiggle

    // 卡片禁区与角部硬阻挡防穿透
    for (const card of cards) {
      const margin = 10
      const boxLeft = card.x - margin
      const boxRight = card.x + card.width + margin
      const boxTop = card.y - margin
      const boxBottom = card.y + card.height + margin

      if (px >= boxLeft && px <= boxRight && py >= boxTop && py <= boxBottom) {
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

      // 卡片外角切角防护：距角部 18px 范围内径向推开
      const nearestX = Math.max(card.x, Math.min(card.x + card.width, px))
      const nearestY = Math.max(card.y, Math.min(card.y + card.height, py))
      const cdx = px - nearestX
      const cdy = py - nearestY
      const cdist = Math.hypot(cdx, cdy)
      const CORNER_MIN = 18
      if (cdist > 0.001 && cdist < CORNER_MIN) {
        px += (cdx / cdist) * (CORNER_MIN - cdist)
        py += (cdy / cdist) * (CORNER_MIN - cdist)
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
  const totalPts = perturbedPoints.length

  for (let i = 0; i < totalPts - 1; i++) {
    const p0 = perturbedPoints[Math.max(0, i - 1)]
    const p1 = perturbedPoints[i]
    const p2 = perturbedPoints[i + 1]
    const p3 = perturbedPoints[Math.min(totalPts - 1, i + 2)]

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
  const ROW_GAP = 46
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

  // 5. 2D 卡片间廊道寻路算法与排斥分层引擎 (Inter-Card Corridor Pathfinding, Layering & Repulsion)
  // 核心原则：
  // 1. 寻路算法：跨列连线优先在视线高度附近寻找卡片间的横向缝隙（廊道），自然穿梭，绝不向外挂高架绕远路；
  // 2. 空间分层：对进入同一纵向通道与同一横向廊道的多根线缆排序并分配独立插槽层位；
  // 3. 物理排斥：线缆间施加 1D 库仑斥力 + 卡片边界安全阻挡，消除重叠并保持净空；
  // 4. 柔性软绳：向心圆角平滑过渡 + 多频谐波自然微动 + 严密咬合五金插头。
  const swissEdges: SwissEdgeLayout[] = []
  const edgeList = edges.filter((e) => !e.isVerticalStalk)

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

  // 按列归纳卡片，按垂直 Y 升序排列
  const columnCardsMap = new Map<number, SwissNodeLayout[]>()
  for (let c = 0; c < numCols; c++) {
    columnCardsMap.set(c, [])
  }
  for (const node of swissNodes) {
    columnCardsMap.get(node.colIndex)?.push(node)
  }
  columnCardsMap.forEach((cards) => {
    cards.sort((a, b) => a.y - b.y)
  })

  // 构建各列的横向可通行廊道集合 (Horizontal Corridors)
  interface HorizontalCorridor {
    id: string
    colIndex: number
    minY: number
    maxY: number
    center: number
    safeMinY: number
    safeMaxY: number
  }

  const columnCorridorsMap = new Map<number, HorizontalCorridor[]>()

  for (let c = 0; c < numCols; c++) {
    const cards = columnCardsMap.get(c) || []
    const corridors: HorizontalCorridor[] = []

    if (cards.length === 0) {
      const centerY = TOP_MARGIN + 60
      corridors.push({
        id: `c${c}-g0`,
        colIndex: c,
        minY: centerY - 20,
        maxY: centerY + 20,
        center: centerY,
        safeMinY: centerY - 15,
        safeMaxY: centerY + 15,
      })
    } else {
      // 1. 顶部廊道（第一张卡片上方）
      const topY = cards[0].y
      const topCenter = topY - 24
      corridors.push({
        id: `c${c}-top`,
        colIndex: c,
        minY: topY - 48,
        maxY: topY,
        center: topCenter,
        safeMinY: topY - 36,
        safeMaxY: topY - 12,
      })

      // 2. 卡片与卡片之间的行间缝隙廊道 (Inter-card gaps)
      for (let r = 0; r < cards.length - 1; r++) {
        const cardAbove = cards[r]
        const cardBelow = cards[r + 1]
        const gapTop = cardAbove.y + cardAbove.height
        const gapBottom = cardBelow.y
        const gapCenter = (gapTop + gapBottom) / 2
        corridors.push({
          id: `c${c}-gap-${r}`,
          colIndex: c,
          minY: gapTop,
          maxY: gapBottom,
          center: gapCenter,
          safeMinY: gapTop + 10,
          safeMaxY: gapBottom - 10,
        })
      }

      // 3. 底部廊道（最后一张卡片下方紧随其后）
      const lastCard = cards[cards.length - 1]
      const bottomY = lastCard.y + lastCard.height
      const bottomCenter = bottomY + 24
      corridors.push({
        id: `c${c}-bottom`,
        colIndex: c,
        minY: bottomY,
        maxY: bottomY + 48,
        center: bottomCenter,
        safeMinY: bottomY + 12,
        safeMaxY: bottomY + 36,
      })
    }

    columnCorridorsMap.set(c, corridors)
  }

  // 1D 物理排斥松弛求解器：适用于纵向通道 X 排斥与横向廊道 Y 排斥
  interface Wire1D {
    id: string
    edgeId: string
    preferredPos: number
    span1: number
    span2: number
    assignedPos: number
  }

  function relaxWires1D(
    wires: Wire1D[],
    minCoord: number,
    maxCoord: number,
    options: { minGap?: number; kRep?: number; kSpring?: number; iterations?: number } = {},
  ): void {
    const count = wires.length
    if (count === 0) return
    if (count === 1) {
      wires[0].assignedPos = Math.round((minCoord + maxCoord) / 2)
      return
    }

    const minGap = options.minGap ?? 12
    const kRep = options.kRep ?? 1600
    const kSpring = options.kSpring ?? 0.08
    const iterations = options.iterations ?? 25

    // 1. 初始分层排序：按 preferredPos 升序排布
    wires.sort((a, b) => a.preferredPos - b.preferredPos || (a.span1 + a.span2) - (b.span1 + b.span2))

    // 2. 均匀插槽分布
    const totalSpan = maxCoord - minCoord
    const step = totalSpan / (count + 1)
    const positions = wires.map((_, i) => minCoord + (i + 1) * step)

    // 3. 库仑力与壁障排斥迭代
    for (let it = 0; it < iterations; it++) {
      const forces = new Array(count).fill(0)

      // 线间库仑排斥力
      for (let i = 0; i < count - 1; i++) {
        for (let j = i + 1; j < count; j++) {
          const d = Math.max(positions[j] - positions[i], 2)
          const rep = kRep / (d * d)
          forces[i] -= rep
          forces[j] += rep
        }
      }

      // 边界斥力
      for (let i = 0; i < count; i++) {
        const dMin = Math.max(positions[i] - minCoord, 2)
        const dMax = Math.max(maxCoord - positions[i], 2)
        forces[i] += (kRep * 0.5) / (dMin * dMin)
        forces[i] -= (kRep * 0.5) / (dMax * dMax)
      }

      // 弹簧居中力
      for (let i = 0; i < count; i++) {
        const anchor = minCoord + (i + 1) * step
        forces[i] += -kSpring * (positions[i] - anchor)
      }

      // 更新位置
      for (let i = 0; i < count; i++) {
        positions[i] = Math.max(minCoord, Math.min(maxCoord, positions[i] + forces[i] * 0.25))
      }

      // 刚性最小安全距离约束
      for (let i = 0; i < count - 1; i++) {
        if (positions[i + 1] - positions[i] < minGap) {
          const overlap = minGap - (positions[i + 1] - positions[i])
          positions[i] = Math.max(minCoord, positions[i] - overlap * 0.5)
          positions[i + 1] = Math.min(maxCoord, positions[i + 1] + overlap * 0.5)
        }
      }
    }

    // 4. 回填最终坐标
    for (let i = 0; i < count; i++) {
      wires[i].assignedPos = Math.round(positions[i])
    }
  }

  // 4.1 动态多插孔端口分配 (Dynamic Multi-Jack Port Allocation)
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

  // 计算出端口 (源卡片右边缘，由上至下有序引出)
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

  // 计算入端口 (目标卡片左边缘，平滑平行进线)
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

  // 4.2 廊道寻路与线段注册
  const gutterWiresMap = new Map<number, Wire1D[]>()
  for (let c = 0; c < gutters.length; c++) {
    gutterWiresMap.set(c, [])
  }

  const corridorWiresMap = new Map<string, Wire1D[]>()
  columnCorridorsMap.forEach((corridors) => {
    corridors.forEach((corr) => {
      corridorWiresMap.set(corr.id, [])
    })
  })

  // 廊道拥挤度跟踪表：杜绝多条线缆扎堆在同一缝隙或天花板形成总线
  const corridorUsageCount = new Map<string, number>()

  // 寻路选择器：给定中间列 k，寻找与视线理想高度最近且未拥堵的卡片间缝隙廊道
  const findBestCorridor = (colIdx: number, yIdeal: number): HorizontalCorridor => {
    const corridors = columnCorridorsMap.get(colIdx) || []
    if (corridors.length === 0) {
      return {
        id: `c${colIdx}-dummy`,
        colIndex: colIdx,
        minY: yIdeal - 20,
        maxY: yIdeal + 20,
        center: yIdeal,
        safeMinY: yIdeal - 15,
        safeMaxY: yIdeal + 15,
      }
    }

    // 严禁总线扎堆：综合代价 = 几何高度差 + 外部边缘天花板惩罚 + 拥挤度排斥
    let bestCorr = corridors[0]
    let minCost = Infinity

    for (const corr of corridors) {
      const isExternal = corr.id.includes('top') || corr.id.includes('bottom')
      const externalPenalty = isExternal ? 50 : 0
      const load = corridorUsageCount.get(corr.id) || 0
      const congestionPenalty = load * 28
      const dist = Math.abs(corr.center - yIdeal)
      const cost = dist + externalPenalty + congestionPenalty

      if (cost < minCost) {
        minCost = cost
        bestCorr = corr
      }
    }

    corridorUsageCount.set(bestCorr.id, (corridorUsageCount.get(bestCorr.id) || 0) + 1)
    return bestCorr
  }

  // 辅助选择节点紧邻的上方或下方横向缝隙走廊
  const getAdjacentCorridors = (node: SwissNodeLayout) => {
    const cards = columnCardsMap.get(node.colIndex) || []
    const r = node.rowIndex
    const corrAbove = columnCorridorsMap.get(node.colIndex)?.find(
      (c) => c.id === (r === 0 ? `c${node.colIndex}-top` : `c${node.colIndex}-gap-${r - 1}`),
    )
    const corrBelow = columnCorridorsMap.get(node.colIndex)?.find(
      (c) => c.id === (r >= cards.length - 1 ? `c${node.colIndex}-bottom` : `c${node.colIndex}-gap-${r}`),
    )
    return { corrAbove, corrBelow }
  }

  // 智能选择紧邻走廊（综合视线流向与拥堵度分散，杜绝全挤天花板）
  const chooseAdjacentCorridor = (node: SwissNodeLayout, targetY: number): HorizontalCorridor => {
    const { corrAbove, corrBelow } = getAdjacentCorridors(node)
    const options = [corrAbove, corrBelow].filter((c): c is HorizontalCorridor => Boolean(c))
    if (options.length === 1) {
      corridorUsageCount.set(options[0].id, (corridorUsageCount.get(options[0].id) || 0) + 1)
      return options[0]
    }

    let best = options[0]
    let minCost = Infinity

    for (const opt of options) {
      const isExternal = opt.id.includes('top') || opt.id.includes('bottom')
      const externalPenalty = isExternal ? 45 : 0
      const load = corridorUsageCount.get(opt.id) || 0
      const congestionPenalty = load * 28
      const dist = Math.abs(opt.center - targetY)
      const cost = dist + externalPenalty + congestionPenalty

      if (cost < minCost) {
        minCost = cost
        best = opt
      }
    }

    corridorUsageCount.set(best.id, (corridorUsageCount.get(best.id) || 0) + 1)
    return best
  }

  const leftCorridorWires: Wire1D[] = []
  const rightCorridorWires: Wire1D[] = []

  interface EdgeRoutingPlan {
    edge: CausalEdge3D
    fromNode: SwissNodeLayout
    toNode: SwissNodeLayout
    startX: number
    startY: number
    endX: number
    endY: number
    colDiff: number
    intermediateCorridorIds: string[]
  }

  const routingPlans: EdgeRoutingPlan[] = []

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
    // 目标端点永远严格连接目标节点的左侧入插孔 (toPort.x = toNode.x)
    const endX = toPort.x
    const endY = toPort.y

    const intermediateCorridorIds: string[] = []

    if (colDiff === 1) {
      // 相邻列：仅在出发通道占用一根纵向线
      const gIdx = fromNode.colIndex
      const gutter = gutters[gIdx]
      gutterWiresMap.get(gIdx)?.push({
        id: `${edge.id}-v-${gIdx}`,
        edgeId: edge.id,
        preferredPos: gutter ? gutter.center : startX + 40,
        span1: startY,
        span2: endY,
        assignedPos: gutter ? gutter.center : startX + 40,
      })
    } else if (colDiff > 1) {
      // 跨列前向通信：寻路穿过中间各列的卡片间缝隙廊道
      for (let k = fromNode.colIndex + 1; k < toNode.colIndex; k++) {
        const colK = columns[k]
        const tProgress = (colK.x + CARD_WIDTH / 2 - startX) / (endX - startX)
        const yIdeal = startY + (endY - startY) * tProgress
        const bestCorr = findBestCorridor(k, yIdeal)
        intermediateCorridorIds.push(bestCorr.id)

        // 注册横向廊道穿行线段需求
        corridorWiresMap.get(bestCorr.id)?.push({
          id: `${edge.id}-h-${k}`,
          edgeId: edge.id,
          preferredPos: bestCorr.center,
          span1: startY,
          span2: endY,
          assignedPos: bestCorr.center,
        })
      }

      // 出发 gutter (fromNode.colIndex)
      const firstCorrId = intermediateCorridorIds[0]
      let firstCorrY = startY
      for (const corridors of columnCorridorsMap.values()) {
        const c = corridors.find((x) => x.id === firstCorrId)
        if (c) {
          firstCorrY = c.center
          break
        }
      }
      const gStartIdx = fromNode.colIndex
      const gutterStart = gutters[gStartIdx]
      gutterWiresMap.get(gStartIdx)?.push({
        id: `${edge.id}-v-${gStartIdx}`,
        edgeId: edge.id,
        preferredPos: gutterStart ? gutterStart.center - 12 : startX + 24,
        span1: startY,
        span2: firstCorrY,
        assignedPos: gutterStart ? gutterStart.center - 12 : startX + 24,
      })

      // 终点前 gutter (toNode.colIndex - 1)
      const lastCorrId = intermediateCorridorIds[intermediateCorridorIds.length - 1]
      let lastCorrY = endY
      for (const corridors of columnCorridorsMap.values()) {
        const c = corridors.find((x) => x.id === lastCorrId)
        if (c) {
          lastCorrY = c.center
          break
        }
      }
      const gEndIdx = toNode.colIndex - 1
      const gutterEnd = gutters[gEndIdx]
      gutterWiresMap.get(gEndIdx)?.push({
        id: `${edge.id}-v-${gEndIdx}`,
        edgeId: edge.id,
        preferredPos: gutterEnd ? gutterEnd.center + 12 : endX - 24,
        span1: lastCorrY,
        span2: endY,
        assignedPos: gutterEnd ? gutterEnd.center + 12 : endX - 24,
      })
    } else if (colDiff === 0) {
      // 同列折叠：通过源卡与目标卡之间的缝隙廊道循环绕行到左侧入插孔，绝不直接横切卡片！
      const cSame = fromNode.colIndex
      const rFrom = fromNode.rowIndex
      const rTo = toNode.rowIndex
      let gapCorr: HorizontalCorridor
      if (rFrom < rTo) {
        gapCorr = columnCorridorsMap.get(cSame)?.find((x) => x.id === `c${cSame}-gap-${rFrom}`)
          || chooseAdjacentCorridor(fromNode, endY)
      } else if (rFrom > rTo) {
        gapCorr = columnCorridorsMap.get(cSame)?.find((x) => x.id === `c${cSame}-gap-${rFrom - 1}`)
          || chooseAdjacentCorridor(fromNode, endY)
      } else {
        gapCorr = chooseAdjacentCorridor(fromNode, endY)
      }
      intermediateCorridorIds.push(gapCorr.id)

      corridorWiresMap.get(gapCorr.id)?.push({
        id: `${edge.id}-same-h`,
        edgeId: edge.id,
        preferredPos: gapCorr.center,
        span1: startY,
        span2: endY,
        assignedPos: gapCorr.center,
      })

      if (cSame < numCols - 1) {
        const gutterRight = gutters[cSame]
        gutterWiresMap.get(cSame)?.push({
          id: `${edge.id}-same-v-right`,
          edgeId: edge.id,
          preferredPos: gutterRight ? gutterRight.center + 12 : startX + 24,
          span1: startY,
          span2: gapCorr.center,
          assignedPos: gutterRight ? gutterRight.center + 12 : startX + 24,
        })
      } else {
        const rightClearX = columns[numCols - 1].x + CARD_WIDTH + 28
        rightCorridorWires.push({
          id: `${edge.id}-same-v-right`,
          edgeId: edge.id,
          preferredPos: rightClearX,
          span1: startY,
          span2: gapCorr.center,
          assignedPos: rightClearX,
        })
      }

      if (cSame > 0) {
        const gutterLeft = gutters[cSame - 1]
        gutterWiresMap.get(cSame - 1)?.push({
          id: `${edge.id}-same-v-left`,
          edgeId: edge.id,
          preferredPos: gutterLeft ? gutterLeft.center - 12 : endX - 24,
          span1: gapCorr.center,
          span2: endY,
          assignedPos: gutterLeft ? gutterLeft.center - 12 : endX - 24,
        })
      } else {
        leftCorridorWires.push({
          id: `${edge.id}-same-v-left`,
          edgeId: edge.id,
          preferredPos: LEFT_MARGIN - 36,
          span1: gapCorr.center,
          span2: endY,
          assignedPos: LEFT_MARGIN - 36,
        })
      }
    } else {
      // 反向跨列通信 (colDiff < 0: 从右向左穿梭，彻底消除顶部单一总线，严禁对角穿透卡片)
      const cs = fromNode.colIndex
      const ct = toNode.colIndex

      // 1. 出发列 cs：选择源卡片上方或下方缝隙走廊
      const exitCorr = chooseAdjacentCorridor(fromNode, endY)
      intermediateCorridorIds.push(exitCorr.id)

      corridorWiresMap.get(exitCorr.id)?.push({
        id: `${edge.id}-back-h-${cs}`,
        edgeId: edge.id,
        preferredPos: exitCorr.center,
        span1: startY,
        span2: endY,
        assignedPos: exitCorr.center,
      })

      // 出发通道 (cs 右侧) 垂直段
      if (cs < numCols - 1) {
        const gutterStart = gutters[cs]
        gutterWiresMap.get(cs)?.push({
          id: `${edge.id}-back-v-exit`,
          edgeId: edge.id,
          preferredPos: gutterStart ? gutterStart.center + 12 : startX + 24,
          span1: startY,
          span2: exitCorr.center,
          assignedPos: gutterStart ? gutterStart.center + 12 : startX + 24,
        })
      } else {
        const rightClearX = columns[numCols - 1].x + CARD_WIDTH + 28
        rightCorridorWires.push({
          id: `${edge.id}-back-v-exit`,
          edgeId: edge.id,
          preferredPos: rightClearX,
          span1: startY,
          span2: exitCorr.center,
          assignedPos: rightClearX,
        })
      }

      // 2. 中间各列与对应 gutter 垂直过渡段
      let prevY = exitCorr.center
      for (let k = cs - 1; k > ct; k--) {
        const colK = columns[k]
        const tProgress = (colK.x + CARD_WIDTH / 2 - startX) / (endX - startX)
        const yIdeal = startY + (endY - startY) * tProgress
        const bestCorr = findBestCorridor(k, yIdeal)
        intermediateCorridorIds.push(bestCorr.id)

        corridorWiresMap.get(bestCorr.id)?.push({
          id: `${edge.id}-back-h-${k}`,
          edgeId: edge.id,
          preferredPos: bestCorr.center,
          span1: startY,
          span2: endY,
          assignedPos: bestCorr.center,
        })

        // 在 Gutter k (列 k 右侧) 注册垂直过渡段
        const gutterK = gutters[k]
        gutterWiresMap.get(k)?.push({
          id: `${edge.id}-back-v-${k}`,
          edgeId: edge.id,
          preferredPos: gutterK ? gutterK.center : 0,
          span1: prevY,
          span2: bestCorr.center,
          assignedPos: gutterK ? gutterK.center : 0,
        })
        prevY = bestCorr.center
      }

      // 3. 目标列 ct 廊道：选择目标卡片紧邻走廊
      const entryCorr = chooseAdjacentCorridor(toNode, prevY)
      intermediateCorridorIds.push(entryCorr.id)

      corridorWiresMap.get(entryCorr.id)?.push({
        id: `${edge.id}-back-h-${ct}`,
        edgeId: edge.id,
        preferredPos: entryCorr.center,
        span1: startY,
        span2: endY,
        assignedPos: entryCorr.center,
      })

      // 在 Gutter ct (列 ct 右侧) 注册垂直过渡段，严禁从右向左对角斜切卡片！
      const gutterCt = gutters[ct]
      gutterWiresMap.get(ct)?.push({
        id: `${edge.id}-back-v-${ct}`,
        edgeId: edge.id,
        preferredPos: gutterCt ? gutterCt.center : 0,
        span1: prevY,
        span2: entryCorr.center,
        assignedPos: gutterCt ? gutterCt.center : 0,
      })

      // 在目标列 ct 左侧通道 (ct-1 或左安全廊道) 垂直引线到 endY
      if (ct > 0) {
        const gutterLeft = gutters[ct - 1]
        gutterWiresMap.get(ct - 1)?.push({
          id: `${edge.id}-back-v-entry`,
          edgeId: edge.id,
          preferredPos: gutterLeft ? gutterLeft.center - 12 : endX - 24,
          span1: entryCorr.center,
          span2: endY,
          assignedPos: gutterLeft ? gutterLeft.center - 12 : endX - 24,
        })
      } else {
        leftCorridorWires.push({
          id: `${edge.id}-back-v-entry`,
          edgeId: edge.id,
          preferredPos: LEFT_MARGIN - 36,
          span1: entryCorr.center,
          span2: endY,
          assignedPos: LEFT_MARGIN - 36,
        })
      }
    }

    routingPlans.push({
      edge,
      fromNode,
      toNode,
      startX,
      startY,
      endX,
      endY,
      colDiff,
      intermediateCorridorIds,
    })
  }

  // 4.3 物理松弛：通道与廊道全面执行库仑斥力排斥与分层插槽分配
  const vTrackMap = new Map<string, number>()
  const hTrackMap = new Map<string, number>()

  gutterWiresMap.forEach((wires, gIdx) => {
    const gutter = gutters[gIdx]
    if (gutter) {
      relaxWires1D(wires, gutter.safeMinX, gutter.safeMaxX, { minGap: 12 })
      wires.forEach((w) => vTrackMap.set(w.id, w.assignedPos))
    }
  })

  // 左安全走廊松弛 (供 Column 0 反向入线，消除左侧重叠并留足转弯净空)
  if (leftCorridorWires.length > 0) {
    relaxWires1D(leftCorridorWires, LEFT_MARGIN - 60, LEFT_MARGIN - 24, { minGap: 10 })
    leftCorridorWires.forEach((w) => vTrackMap.set(w.id, w.assignedPos))
  }

  // 右安全走廊松弛 (供最右侧执行列反向出线，消除右侧重叠)
  const rightClearX = columns[numCols - 1].x + CARD_WIDTH + 28
  if (rightCorridorWires.length > 0) {
    relaxWires1D(rightCorridorWires, rightClearX - 8, rightClearX + 28, { minGap: 10 })
    rightCorridorWires.forEach((w) => vTrackMap.set(w.id, w.assignedPos))
  }

  corridorWiresMap.forEach((wires, corrId) => {
    let safeMinY = 0
    let safeMaxY = 0
    for (const corridors of columnCorridorsMap.values()) {
      const found = corridors.find((c) => c.id === corrId)
      if (found) {
        safeMinY = found.safeMinY
        safeMaxY = found.safeMaxY
        break
      }
    }
    if (safeMaxY > safeMinY) {
      relaxWires1D(wires, safeMinY, safeMaxY, { minGap: 10 })
    }
    wires.forEach((w) => hTrackMap.set(w.id, w.assignedPos))
  })

  // 4.4 组装平滑锚点并生成自然软绳样条 (基于寻路通道与物理排斥松弛，零独立圆角)
  routingPlans.forEach((plan) => {
    let waypoints: Array<{ x: number; y: number }> = []

    if (plan.colDiff === 1) {
      const trackX = vTrackMap.get(`${plan.edge.id}-v-${plan.fromNode.colIndex}`)
        || (gutters[plan.fromNode.colIndex]?.center ?? (plan.startX + plan.endX) / 2)

      if (Math.abs(plan.startY - plan.endY) < 6) {
        waypoints = [
          { x: plan.startX, y: plan.startY },
          { x: plan.endX, y: plan.endY },
        ]
      } else {
        waypoints = [
          { x: plan.startX, y: plan.startY },
          { x: trackX, y: plan.startY },
          { x: trackX, y: plan.endY },
          { x: plan.endX, y: plan.endY },
        ]
      }
    } else if (plan.colDiff > 1) {
      const pts: Array<{ x: number; y: number }> = [{ x: plan.startX, y: plan.startY }]
      const cs = plan.fromNode.colIndex
      const ct = plan.toNode.colIndex

      // 出发 gutter (cs)
      const firstTrackX = vTrackMap.get(`${plan.edge.id}-v-${cs}`)
        || (gutters[cs]?.center ? gutters[cs].center - 12 : plan.startX + 24)
      const firstCorrY = hTrackMap.get(`${plan.edge.id}-h-${cs + 1}`) || plan.startY

      pts.push({ x: firstTrackX, y: plan.startY })
      pts.push({ x: firstTrackX, y: firstCorrY })

      // 穿过各中间列的卡片间缝隙
      for (let k = cs + 1; k < ct; k++) {
        const corrY = hTrackMap.get(`${plan.edge.id}-h-${k}`) || firstCorrY
        const nextGutterIdx = k
        const nextGutter = gutters[nextGutterIdx]
        const nextTrackX = vTrackMap.get(`${plan.edge.id}-v-${nextGutterIdx}`)
          || (nextGutter?.center ? nextGutter.center + 12 : plan.endX - 24)

        // 穿行中间列廊道到达下一个通道
        pts.push({ x: nextTrackX, y: corrY })

        if (k < ct - 1) {
          const nextCorrY = hTrackMap.get(`${plan.edge.id}-h-${k + 1}`) || corrY
          pts.push({ x: nextTrackX, y: nextCorrY })
        } else {
          pts.push({ x: nextTrackX, y: plan.endY })
        }
      }

      pts.push({ x: plan.endX, y: plan.endY })
      waypoints = pts
    } else if (plan.colDiff === 0) {
      // 同列折叠：从右侧出通道绕过间隙廊道进入左侧通道接插孔，零卡片穿透
      const cSame = plan.fromNode.colIndex
      const rightClearX = columns[numCols - 1].x + CARD_WIDTH + 28
      const rightTrackX = cSame < numCols - 1
        ? (vTrackMap.get(`${plan.edge.id}-same-v-right`) || gutters[cSame]?.center || plan.startX + 28)
        : (vTrackMap.get(`${plan.edge.id}-same-v-right`) || rightClearX)
      const leftTrackX = cSame > 0
        ? (vTrackMap.get(`${plan.edge.id}-same-v-left`) || gutters[cSame - 1]?.center || plan.endX - 24)
        : (vTrackMap.get(`${plan.edge.id}-same-v-left`) || LEFT_MARGIN - 36)
      const gapCorrY = hTrackMap.get(`${plan.edge.id}-same-h`) || (plan.startY + plan.endY) / 2

      waypoints = [
        { x: plan.startX, y: plan.startY },
        { x: rightTrackX, y: plan.startY },
        { x: rightTrackX, y: gapCorrY },
        { x: leftTrackX, y: gapCorrY },
        { x: leftTrackX, y: plan.endY },
        { x: plan.endX, y: plan.endY },
      ]
    } else {
      // 反向跨列通信：严格正交廊道寻路，彻底消除顶部单一总线与对角斜穿卡片
      const pts: Array<{ x: number; y: number }> = [{ x: plan.startX, y: plan.startY }]
      const cs = plan.fromNode.colIndex
      const ct = plan.toNode.colIndex

      // 1. 出发通道 (cs 右侧)
      const exitTrackX = vTrackMap.get(`${plan.edge.id}-back-v-exit`)
        || (cs < numCols - 1 ? (gutters[cs]?.center ? gutters[cs].center + 12 : plan.startX + 24) : rightClearX)
      const exitCorrY = hTrackMap.get(`${plan.edge.id}-back-h-${cs}`) || plan.startY

      pts.push({ x: exitTrackX, y: plan.startY })
      pts.push({ x: exitTrackX, y: exitCorrY })

      // 2. 逐列向左遍历中间各列 (从 cs - 1 到 ct + 1)
      let currY = exitCorrY
      for (let k = cs - 1; k > ct; k--) {
        const gutterK = gutters[k]
        const trackX_k = vTrackMap.get(`${plan.edge.id}-back-v-${k}`)
          || (gutterK ? gutterK.center : plan.startX - (cs - k) * 350)
        // 穿越列 k + 1 到达 Gutter k
        pts.push({ x: trackX_k, y: currY })

        // 在 Gutter k 内部垂直过渡到该列廊道高度
        const corrY_k = hTrackMap.get(`${plan.edge.id}-back-h-${k}`) || currY
        if (Math.abs(currY - corrY_k) > 1) {
          pts.push({ x: trackX_k, y: corrY_k })
          currY = corrY_k
        }
      }

      // 3. 到达目标列 ct 右侧的 Gutter ct
      const gutterCt = gutters[ct]
      const trackX_ct = vTrackMap.get(`${plan.edge.id}-back-v-${ct}`)
        || (gutterCt ? gutterCt.center : plan.endX + 350)
      pts.push({ x: trackX_ct, y: currY })

      // 在 Gutter ct 内部垂直过渡到目标列入口廊道高度 entryCorrY
      const entryCorrY = hTrackMap.get(`${plan.edge.id}-back-h-${ct}`) || plan.endY
      if (Math.abs(currY - entryCorrY) > 1) {
        pts.push({ x: trackX_ct, y: entryCorrY })
        currY = entryCorrY
      }

      // 4. 横向穿过目标列 ct 的入口廊道到达其左侧通道
      const entryTrackX = ct === 0
        ? (vTrackMap.get(`${plan.edge.id}-back-v-entry`) || LEFT_MARGIN - 36)
        : (vTrackMap.get(`${plan.edge.id}-back-v-entry`) || gutters[ct - 1]?.center || plan.endX - 24)
      pts.push({ x: entryTrackX, y: currY })

      // 5. 在目标列左侧通道垂直过渡到目标端口高度
      if (Math.abs(currY - plan.endY) > 1) {
        pts.push({ x: entryTrackX, y: plan.endY })
      }

      // 6. 水平进入目标端口
      pts.push({ x: plan.endX, y: plan.endY })

      waypoints = pts
    }

    const cardBoxes: CardAABB[] = swissNodes.map((n) => ({
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    }))

    const { svgPath, points } = buildOrganicRopeSpline(waypoints, plan.edge.id, cardBoxes)

    swissEdges.push({
      id: plan.edge.id,
      from: plan.edge.from,
      to: plan.edge.to,
      infoType: plan.edge.lastInfoType || 'info',
      points,
      svgPath,
      waypoints,
      edge: plan.edge,
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
