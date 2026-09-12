import { describe, expect, it } from 'vitest'
import { buildOrganicRopeSpline, buildSoftRopePath, computeSwissGridLayout } from './swiss-layout-engine'
import type { CausalEdge3D, CausalNode3D } from '../../types'

describe('Swiss Modular Grid Layout Engine', () => {
  const createMockNode = (id: string, role: 'observation' | 'domain' | 'execution'): CausalNode3D => ({
    id,
    name: `Node ${id}`,
    role,
    generation: 1,
    version: 3,
    status: 'IDLE',
    position: [0, 0, 0],
    color: '#000000',
    state: { counter: 42, active: true },
    inDegree: 1,
    outDegree: 1,
  })

  it('correctly partitions nodes into three distinct Swiss column tiers', () => {
    const nodes: CausalNode3D[] = [
      createMockNode('obs_camera', 'observation'),
      createMockNode('dom_timeline', 'domain'),
      createMockNode('dom_effects', 'domain'),
      createMockNode('exec_renderer', 'execution'),
    ]

    const edges: CausalEdge3D[] = [
      { id: 'e1', from: 'obs_camera', to: 'dom_timeline', color: '#000', active: true, lastInfoType: 'Frame' },
      { id: 'e2', from: 'dom_timeline', to: 'exec_renderer', color: '#000', active: true, lastInfoType: 'RenderCmd' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)

    expect(layout.nodes).toHaveLength(4)
    expect(layout.columns.length).toBeGreaterThanOrEqual(3)

    const obsNode = layout.nodes.find((n) => n.nodeId === 'obs_camera')!
    const domNode = layout.nodes.find((n) => n.nodeId === 'dom_timeline')!
    const execNode = layout.nodes.find((n) => n.nodeId === 'exec_renderer')!

    // 严苛保证从左至右分栏对齐
    expect(obsNode.x).toBeLessThan(domNode.x)
    expect(domNode.x).toBeLessThan(execNode.x)
  })

  it('generates smooth 2D soft rope curves with soft fillets and natural slack', () => {
    const nodes: CausalNode3D[] = [
      createMockNode('n1', 'observation'),
      createMockNode('n2', 'domain'),
    ]
    const edges: CausalEdge3D[] = [
      { id: 'n1->n2', from: 'n1', to: 'n2', color: '#000', active: true, lastInfoType: 'DataInfo' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)
    expect(layout.edges).toHaveLength(1)

    const edge = layout.edges[0]
    // 验证生成了平滑贝塞尔曲线指令 (C) 与密集的 60fps 脉冲插值点 (>= 16 点)
    expect(edge.svgPath).toContain('C')
    expect(edge.points.length).toBeGreaterThanOrEqual(16)

    // 起点与终点 X 坐标单调递增 (由左向右流向)
    expect(edge.points[0].x).toBeLessThan(edge.points[edge.points.length - 1].x)
  })

  it('routes cross-layer skip-column edges via corridor bypass with ZERO intersection with intermediate cards', () => {
    // 构造跨列跳跃场景：Col 0 (Observation) 直连 Col 2 (Execution)，跳过 Col 1 (Domain)
    const nodes: CausalNode3D[] = [
      createMockNode('obs_root', 'observation'),
      createMockNode('dom_center', 'domain'),
      createMockNode('exec_target', 'execution'),
    ]

    const edges: CausalEdge3D[] = [
      { id: 'skip_edge', from: 'obs_root', to: 'exec_target', color: '#000', active: true, lastInfoType: 'DirectTrigger' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)
    const domCard = layout.nodes.find((n) => n.nodeId === 'dom_center')!
    const skipEdge = layout.edges.find((e) => e.id === 'skip_edge')!

    expect(domCard).toBeDefined()
    expect(skipEdge).toBeDefined()

    // 验证跳跃线使用了六锚点规整走廊塑型并平滑倒角
    expect(skipEdge.waypoints?.length).toBe(6)
    expect(skipEdge.svgPath).toContain('C')
    expect(skipEdge.points.length).toBeGreaterThanOrEqual(24)

    // 严格几何证明：折线与曲线采样点绝对不穿透中间卡片内部矩形 [x+2, x+w-2] x [y+2, y+h-2]
    const cardLeft = domCard.x + 2
    const cardRight = domCard.x + domCard.width - 2
    const cardTop = domCard.y + 2
    const cardBottom = domCard.y + domCard.height - 2

    for (let i = 0; i < skipEdge.points.length - 1; i++) {
      const p1 = skipEdge.points[i]
      const p2 = skipEdge.points[i + 1]

      const segMinX = Math.min(p1.x, p2.x)
      const segMaxX = Math.max(p1.x, p2.x)
      const segMinY = Math.min(p1.y, p2.y)
      const segMaxY = Math.max(p1.y, p2.y)

      const xOverlap = Math.max(0, Math.min(segMaxX, cardRight) - Math.max(segMinX, cardLeft))
      const yOverlap = Math.max(0, Math.min(segMaxY, cardBottom) - Math.max(segMinY, cardTop))

      // 若 X 与 Y 方向均有重叠，则发生了几何穿透
      const isPenetrating = xOverlap > 0 && yOverlap > 0
      expect(isPenetrating).toBe(false)
    }
  })

  it('relaxes parallel vertical wires in the same gutter channel with physical separation', () => {
    // 同一通道内多条具有落差的连线，验证物理排斥使得通道 X 坐标均匀散开且互不重叠
    const nodes: CausalNode3D[] = [
      createMockNode('obs_1', 'observation'),
      createMockNode('obs_2', 'observation'),
      createMockNode('dom_1', 'domain'),
      createMockNode('dom_2', 'domain'),
    ]

    const edges: CausalEdge3D[] = [
      { id: 'e1', from: 'obs_1', to: 'dom_2', color: '#000', active: true, lastInfoType: 'A' },
      { id: 'e2', from: 'obs_2', to: 'dom_1', color: '#000', active: true, lastInfoType: 'B' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)
    const edge1 = layout.edges.find((e) => e.id === 'e1')!
    const edge2 = layout.edges.find((e) => e.id === 'e2')!

    // 两条线在通道中的纵向通道锚点 X 坐标
    const track1X = edge1.waypoints?.[1]?.x ?? edge1.points[1].x
    const track2X = edge2.waypoints?.[1]?.x ?? edge2.points[1].x

    // 验证物理排斥后间距大于等于 10px，绝不重叠
    expect(Math.abs(track1X - track2X)).toBeGreaterThanOrEqual(10)
  })

  it('generates non-empty, valid SVG paths without NaN or undefined for all edge categories', () => {
    const nodes: CausalNode3D[] = [
      createMockNode('n_obs', 'observation'),
      createMockNode('n_dom1', 'domain'),
      createMockNode('n_dom2', 'domain'),
      createMockNode('n_exec', 'execution'),
    ]

    const edges: CausalEdge3D[] = [
      { id: 'e_adj', from: 'n_obs', to: 'n_dom1', color: '#000', active: true, lastInfoType: 'Adj' },
      { id: 'e_same', from: 'n_dom1', to: 'n_dom2', color: '#000', active: true, lastInfoType: 'Same' },
      { id: 'e_skip', from: 'n_obs', to: 'n_exec', color: '#000', active: true, lastInfoType: 'Skip' },
      { id: 'e_back', from: 'n_exec', to: 'n_obs', color: '#000', active: true, lastInfoType: 'Back' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)
    expect(layout.edges).toHaveLength(4)

    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(4)
      expect(edge.svgPath).toMatch(/^M \d+(\.\d+)? \d+(\.\d+)?/)
      expect(edge.svgPath).not.toContain('NaN')
      expect(edge.svgPath).not.toContain('undefined')

      for (const pt of edge.points) {
        expect(Number.isFinite(pt.x)).toBe(true)
        expect(Number.isFinite(pt.y)).toBe(true)
      }
    }
  })

  it('dynamically distributes connection ports so multiple outgoing or incoming lines do NOT stack onto a single point', () => {
    // 构造 1 个节点向 3 个不同节点连线的扇出场景
    const nodes: CausalNode3D[] = [
      createMockNode('source_node', 'observation'),
      createMockNode('target_1', 'domain'),
      createMockNode('target_2', 'domain'),
      createMockNode('target_3', 'domain'),
    ]

    const edges: CausalEdge3D[] = [
      { id: 'e1', from: 'source_node', to: 'target_1', color: '#000', active: true, lastInfoType: 'A' },
      { id: 'e2', from: 'source_node', to: 'target_2', color: '#000', active: true, lastInfoType: 'B' },
      { id: 'e3', from: 'source_node', to: 'target_3', color: '#000', active: true, lastInfoType: 'C' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)
    const e1 = layout.edges.find((e) => e.id === 'e1')!
    const e2 = layout.edges.find((e) => e.id === 'e2')!
    const e3 = layout.edges.find((e) => e.id === 'e3')!

    const y1 = e1.points[0].y
    const y2 = e2.points[0].y
    const y3 = e3.points[0].y

    // 验证三个出端口 Y 坐标互不相同，绝不堆叠在同一个点上
    expect(y1).not.toBe(y2)
    expect(y2).not.toBe(y3)
    expect(y1).not.toBe(y3)
    // 验证端子间距均匀 (>= 15px)
    expect(Math.abs(y1 - y2)).toBeGreaterThanOrEqual(15)
    expect(Math.abs(y2 - y3)).toBeGreaterThanOrEqual(15)
  })

  it('routes backward edges via left corridor without penetrating the destination card', () => {
    // 构造反向边场景：Execution 节点回流到最左侧 Observation 节点 (Column 0)
    const nodes: CausalNode3D[] = [
      createMockNode('src-sqlite-observer', 'observation'),
      createMockNode('dom-kernel', 'domain'),
      createMockNode('sink-sqlite-writer', 'execution'),
    ]

    const edges: CausalEdge3D[] = [
      { id: 'back_edge', from: 'sink-sqlite-writer', to: 'src-sqlite-observer', color: '#000', active: true, lastInfoType: 'PersistDone' },
    ]

    const layout = computeSwissGridLayout(nodes, edges)
    const obsCard = layout.nodes.find((n) => n.nodeId === 'src-sqlite-observer')!
    const backEdge = layout.edges.find((e) => e.id === 'back_edge')!

    expect(obsCard).toBeDefined()
    expect(backEdge).toBeDefined()

    // 验证反向边的任何采样线段绝不穿透目标卡片内部
    const cardLeft = obsCard.x + 2
    const cardRight = obsCard.x + obsCard.width - 2
    const cardTop = obsCard.y + 2
    const cardBottom = obsCard.y + obsCard.height - 2

    for (let i = 0; i < backEdge.points.length - 1; i++) {
      const p1 = backEdge.points[i]
      const p2 = backEdge.points[i + 1]

      const segMinX = Math.min(p1.x, p2.x)
      const segMaxX = Math.max(p1.x, p2.x)
      const segMinY = Math.min(p1.y, p2.y)
      const segMaxY = Math.max(p1.y, p2.y)

      const xOverlap = Math.max(0, Math.min(segMaxX, cardRight) - Math.max(segMinX, cardLeft))
      const yOverlap = Math.max(0, Math.min(segMaxY, cardBottom) - Math.max(segMinY, cardTop))

      const isPenetrating = xOverlap > 0 && yOverlap > 0
      expect(isPenetrating).toBe(false)
    }
  })

  describe('buildOrganicRopeSpline (TA Procedural Organic Rope Engine)', () => {
    it('generates organic multi-frequency wiggles with zero terminal displacement', () => {
      const waypoints = [
        { x: 100, y: 200 },
        { x: 400, y: 200 },
      ]
      const { svgPath, points } = buildOrganicRopeSpline(waypoints, 'test-edge-1')

      expect(svgPath).toContain('C')
      expect(points.length).toBeGreaterThanOrEqual(28)

      // 端点严格吻合，零位移
      expect(points[0].x).toBe(100)
      expect(points[0].y).toBe(200)
      expect(points[points.length - 1].x).toBe(400)
      expect(points[points.length - 1].y).toBe(200)

      // 验证中间点出现有机随机扭动（Y 坐标由于多频谐波法向微动而偏离 200，绝非平直直线）
      const midPoints = points.slice(5, points.length - 5)
      const hasWiggle = midPoints.some((pt) => Math.abs(pt.y - 200) > 1.0)
      expect(hasWiggle).toBe(true)
    })

    it('generates different deterministic wiggles for different edge IDs', () => {
      const waypoints = [
        { x: 100, y: 150 },
        { x: 350, y: 150 },
      ]
      const r1 = buildOrganicRopeSpline(waypoints, 'edge-alpha')
      const r2 = buildOrganicRopeSpline(waypoints, 'edge-beta')

      // 两个不同边 ID 生成不同的扰动形态（确定性随机种子差异）
      const mid1 = r1.points[Math.floor(r1.points.length / 2)]
      const mid2 = r2.points[Math.floor(r2.points.length / 2)]
      expect(mid1.y).not.toBe(mid2.y)
    })
  })
})
