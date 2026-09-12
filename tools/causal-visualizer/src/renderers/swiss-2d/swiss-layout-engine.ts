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
 * 2D 瑞士先锋主义模块化网格排布算法
 * 严格遵循国际主义平面设计规范：
 * 1. 严苛网格秩序：分列观察（左翼）、领域核心（中央矩阵）、执行动作（右翼）；
 * 2. 90° 曼哈顿正交因果布线（零斜线，纯直角折线）；
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

  // 3. 计算总列定义
  const columns: SwissColumnHeader[] = [
    {
      title: 'OBSERVATION // 01',
      subtitle: '感知世界 · 零写事实 · 悬崖灯塔',
      role: 'observation',
      x: LEFT_MARGIN,
      width: CARD_WIDTH,
    },
  ]

  let currentX = LEFT_MARGIN + CARD_WIDTH + COL_GAP
  for (let c = 0; c < domainColsCount; c++) {
    columns.push({
      title: `DOMAIN CORE // 0${2 + c}`,
      subtitle: '纯领域聚落 · 状态主权 · 确定性因果',
      role: 'domain',
      x: currentX,
      width: CARD_WIDTH,
    })
    currentX += CARD_WIDTH + COL_GAP
  }

  columns.push({
    title: `EXECUTION // 0${2 + domainColsCount}`,
    subtitle: '系统动作 · 下发结算 · 垂钓渔港',
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

  // 5. 曼哈顿正交布线算法（Manhattan Orthogonal Routing）
  const swissEdges: SwissEdgeLayout[] = []
  const edgeList = edges.filter((e) => !e.isVerticalStalk)

  for (const edge of edgeList) {
    const fromNode = nodeLayoutMap.get(edge.from)
    const toNode = nodeLayoutMap.get(edge.to)
    if (!fromNode || !toNode) continue

    const startX = fromNode.x + fromNode.width
    const startY = fromNode.y + fromNode.height / 2

    const endX = toNode.x
    const endY = toNode.y + toNode.height / 2

    const points: Array<{ x: number; y: number }> = []

    if (endX > startX) {
      // 正常前向因果流向：H-V-H 正交折线
      const midX = Math.round(startX + (endX - startX) * 0.5)
      points.push({ x: startX, y: startY })
      points.push({ x: midX, y: startY })
      points.push({ x: midX, y: endY })
      points.push({ x: endX, y: endY })
    } else if (Math.abs(endX - fromNode.x) < 5) {
      // 同列上下节点流向：右侧凸出正交绕线
      const gutterX = startX + 36
      points.push({ x: startX, y: startY })
      points.push({ x: gutterX, y: startY })
      points.push({ x: gutterX, y: endY })
      points.push({ x: startX, y: endY })
    } else {
      // 回流/循环流向：上方或下方正交绕线
      const loopY = Math.min(startY, endY) - 50
      const loopStartX = startX + 24
      const loopEndX = endX - 24
      points.push({ x: startX, y: startY })
      points.push({ x: loopStartX, y: startY })
      points.push({ x: loopStartX, y: loopY })
      points.push({ x: loopEndX, y: loopY })
      points.push({ x: loopEndX, y: endY })
      points.push({ x: endX, y: endY })
    }

    // 生成 SVG 正交路径指令
    let svgPath = `M ${points[0].x} ${points[0].y}`
    for (let p = 1; p < points.length; p++) {
      svgPath += ` L ${points[p].x} ${points[p].y}`
    }

    swissEdges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      infoType: edge.lastInfoType || 'info',
      points,
      svgPath,
      edge,
    })
  }

  // 6. 计算整体画布包围盒
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

  if (swissNodes.length === 0) {
    minX = 0
    minY = 0
    maxX = 1200
    maxY = 800
  }

  const bounds = {
    minX,
    minY,
    maxX: maxX + 100,
    maxY: maxY + 140,
    width: maxX - minX + 200,
    height: maxY - minY + 240,
  }

  return {
    nodes: swissNodes,
    edges: swissEdges,
    columns,
    bounds,
  }
}
