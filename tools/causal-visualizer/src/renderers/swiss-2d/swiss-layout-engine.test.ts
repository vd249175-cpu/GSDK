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

  const segmentIntersectsBox = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    box: { left: number; right: number; top: number; bottom: number },
  ): boolean => {
    if (p1.x >= box.left && p1.x <= box.right && p1.y >= box.top && p1.y <= box.bottom) return true
    if (p2.x >= box.left && p2.x <= box.right && p2.y >= box.top && p2.y <= box.bottom) return true

    const dx = p2.x - p1.x
    const dy = p2.y - p1.y

    let t0 = 0
    let t1 = 1

    const p = [-dx, dx, -dy, dy]
    const q = [p1.x - box.left, box.right - p1.x, p1.y - box.top, box.bottom - p1.y]

    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false
      } else {
        const t = q[i] / p[i]
        if (p[i] < 0) {
          if (t > t1) return false
          if (t > t0) t0 = t
        } else {
          if (t < t0) return false
          if (t < t1) t1 = t
        }
      }
    }

    return t0 <= t1
  }

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

    // 严苛验证：跳跃线在卡片间就近穿行，绝对没有无故向下绕行画布底部大外圈 (maxY 紧贴卡片高度)
    const maxY = Math.max(...skipEdge.points.map((p) => p.y))
    const domCardBottom = domCard.y + domCard.height
    expect(maxY).toBeLessThan(domCardBottom + 60)
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

    it('normalizes short-line wiggle: zero jitter for short wires and smooth tangent at port sockets', () => {
      // 1. 短线 (40px) 紧绷无抖动测试
      const shortWaypoints = [
        { x: 100, y: 150 },
        { x: 140, y: 150 },
      ]
      const shortResult = buildOrganicRopeSpline(shortWaypoints, 'short-wire')
      expect(shortResult.svgPath).toContain('C')
      // 短线所有点 Y 坐标严格等于 150，绝无锯齿高频乱晃
      for (const pt of shortResult.points) {
        expect(pt.y).toBe(150)
      }

      // 2. 长线 (400px) 端部插孔保护：两端 14px 范围内严格水平无抖动
      const longWaypoints = [
        { x: 100, y: 300 },
        { x: 500, y: 300 },
      ]
      const longResult = buildOrganicRopeSpline(longWaypoints, 'long-wire')
      const nearStartPoints = longResult.points.filter((pt) => pt.x <= 114)
      for (const pt of nearStartPoints) {
        expect(pt.y).toBe(300)
      }
      const nearEndPoints = longResult.points.filter((pt) => pt.x >= 486)
      for (const pt of nearEndPoints) {
        expect(pt.y).toBe(300)
      }

      // 中部有舒展自然的有机垂坠 (最大微动在安全范围内 < 8px)
      const midPoints = longResult.points.filter((pt) => pt.x > 200 && pt.x < 400)
      const maxDev = Math.max(...midPoints.map((pt) => Math.abs(pt.y - 300)))
      expect(maxDev).toBeGreaterThan(0.5)
      expect(maxDev).toBeLessThan(8.0)
    })

    it('strictly avoids card penetration for backward edges and same-column edges across intermediate cards', () => {
      // 复现用户遇到的真实场景：
      // Col 0: src-generation-poll (row 0)
      // Col 1: node-md-source (row 0)
      // Col 2: node-sqlite (row 0), node-generation-task (row 1)
      // Col 3: node-sec-gate (row 0)
      // Col 4: sink-generation-submit (row 0)
      const nodes: CausalNode3D[] = [
        createMockNode('src-generation-poll', 'observation'),
        createMockNode('node-md-source', 'domain'),
        createMockNode('node-sqlite', 'domain'),
        createMockNode('node-generation-task', 'domain'),
        createMockNode('node-sec-gate', 'domain'),
        createMockNode('sink-generation-submit', 'execution'),
      ]

      const edges: CausalEdge3D[] = [
        // 1. 跨列反向通信：Col 4 -> Col 2 (sink-generation-submit -> node-generation-task)
        { id: 'e_back_col4_to_col2', from: 'sink-generation-submit', to: 'node-generation-task', color: '#000', active: true },
        // 2. 同列回流：Col 2 -> Col 2 (node-sqlite -> node-generation-task)
        { id: 'e_same_col2', from: 'node-sqlite', to: 'node-generation-task', color: '#000', active: true },
        // 3. 跨列反向通信：Col 2 -> Col 0 (node-generation-task -> src-generation-poll)
        { id: 'e_back_col2_to_col0', from: 'node-generation-task', to: 'src-generation-poll', color: '#000', active: true },
      ]

      const layout = computeSwissGridLayout(nodes, edges)
      const taskCard = layout.nodes.find((n) => n.nodeId === 'node-generation-task')!
      expect(taskCard).toBeDefined()

      // 卡片绝对安全区域 (微缩小 2px 排除插头插口边缘接触)
      const cardLeft = taskCard.x + 3
      const cardRight = taskCard.x + taskCard.width - 3
      const cardTop = taskCard.y + 3
      const cardBottom = taskCard.y + taskCard.height - 3

      for (const edge of layout.edges) {
        for (let i = 0; i < edge.points.length - 1; i++) {
          const p1 = edge.points[i]
          const p2 = edge.points[i + 1]

          const segMinX = Math.min(p1.x, p2.x)
          const segMaxX = Math.max(p1.x, p2.x)
          const segMinY = Math.min(p1.y, p2.y)
          const segMaxY = Math.max(p1.y, p2.y)

          const isPenetrating = segmentIntersectsBox(p1, p2, {
            left: cardLeft,
            right: cardRight,
            top: cardTop,
            bottom: cardBottom,
          })
          if (isPenetrating) {
            console.error(`Penetration detected in edge ${edge.id}: segment (${p1.x},${p1.y}) -> (${p2.x},${p2.y}) cuts into card [${cardLeft}, ${cardRight}] x [${cardTop}, ${cardBottom}]`)
          }
          expect(isPenetrating).toBe(false)
        }
      }
    })

    it('successfully lays out all 16 nodes and 37 routes with zero card penetrations and zero ceiling clumping', () => {
      const nodes: CausalNode3D[] = [
        createMockNode('src-fs-source', 'observation'),
        createMockNode('src-sqlite-observer', 'observation'),
        createMockNode('src-generation-poll', 'observation'),
        createMockNode('src-generation-poll-scheduler', 'observation'),
        createMockNode('node-md-source', 'domain'),
        createMockNode('n-hist', 'domain'),
        createMockNode('node-generation-model-resolver', 'domain'),
        createMockNode('node-md-parser', 'domain'),
        createMockNode('node-sqlite', 'domain'),
        createMockNode('node-generation-task', 'domain'),
        createMockNode('node-outliner', 'domain'),
        createMockNode('node-sec-gate', 'domain'),
        createMockNode('host-el', 'execution'),
        createMockNode('sink-sqlite-writer', 'execution'),
        createMockNode('sink-generation-submit', 'execution'),
        createMockNode('sink-generation-download', 'execution'),
      ]

      const routes = [
        { from: 'src-fs-source', to: 'node-sqlite', infoType: 'ProjectMetadataHydratedInfo' },
        { from: 'src-fs-source', to: 'node-md-source', infoType: 'ProjectMarkdownRunRequestedInfo' },
        { from: 'src-fs-source', to: 'host-el', infoType: 'StoppedInfo' },
        { from: 'node-md-source', to: 'node-outliner', infoType: 'ProjectTreeEditTaskInfo' },
        { from: 'node-md-source', to: 'node-md-parser', infoType: 'DocumentUpdatedInfo' },
        { from: 'node-md-parser', to: 'node-outliner', infoType: 'ParsedAstTreeInfo' },
        { from: 'node-md-parser', to: 'node-sqlite', infoType: 'SyncTreeInfo' },
        { from: 'node-outliner', to: 'node-md-source', infoType: 'ProjectDocumentReplacementInfo' },
        { from: 'node-outliner', to: 'node-sec-gate', infoType: 'StructureMarkdownInfo' },
        { from: 'node-outliner', to: 'n-hist', infoType: 'StateToCaptureInfo' },
        { from: 'n-hist', to: 'node-sqlite', infoType: 'RevertMetadataTaskInfo' },
        { from: 'node-sqlite', to: 'n-hist', infoType: 'ProjectHistoryResetInfo' },
        { from: 'node-sqlite', to: 'node-generation-task', infoType: 'DatabaseSavedObservedInfo' },
        { from: 'node-sqlite', to: 'node-generation-task', infoType: 'DatabaseWriteFailedObservedInfo' },
        { from: 'node-sqlite', to: 'sink-sqlite-writer', infoType: 'PersistProjectStructureTaskInfo' },
        { from: 'node-sqlite', to: 'n-hist', infoType: 'TaskFactObservedInfo' },
        { from: 'sink-sqlite-writer', to: 'src-sqlite-observer', infoType: 'DatabaseWriteFailedObservedInfo' },
        { from: 'sink-sqlite-writer', to: 'src-sqlite-observer', infoType: 'PhysicalProjectStructureMutationInfo' },
        { from: 'sink-sqlite-writer', to: 'src-sqlite-observer', infoType: 'PhysicalDiskMutationInfo' },
        { from: 'src-sqlite-observer', to: 'node-sqlite', infoType: 'Info' },
        { from: 'src-sqlite-observer', to: 'node-sqlite', infoType: 'ProjectStructurePersistedObservedInfo' },
        { from: 'node-sec-gate', to: 'node-generation-task', infoType: 'Info' },
        { from: 'node-sec-gate', to: 'node-generation-task', infoType: 'GenerationBatchSubmittedObservedInfo' },
        { from: 'node-sec-gate', to: 'sink-generation-submit', infoType: 'GenerationBatchSubmittedObservedInfo' },
        { from: 'node-sec-gate', to: 'node-sqlite', infoType: 'Info' },
        { from: 'node-generation-model-resolver', to: 'node-generation-task', infoType: 'GenerationBatchPlannedInfo' },
        { from: 'node-generation-model-resolver', to: 'node-generation-task', infoType: 'GenerationModelResolutionCompletedInfo' },
        { from: 'node-generation-model-resolver', to: 'node-generation-task', infoType: 'GenerationModelResolutionFailedInfo' },
        { from: 'node-generation-task', to: 'node-sec-gate', infoType: 'GenerationSubmitBatchRequestedInfo' },
        { from: 'node-generation-task', to: 'src-generation-poll', infoType: 'GenerationPollBatchRequestedInfo' },
        { from: 'node-generation-task', to: 'sink-generation-download', infoType: 'GenerationDownloadBatchRequestedInfo' },
        { from: 'node-generation-task', to: 'src-generation-poll-scheduler', infoType: 'GenerationPollScheduleRequestedInfo' },
        { from: 'node-generation-task', to: 'node-sec-gate', infoType: 'ArtifactSavedObservedInfo' },
        { from: 'sink-generation-submit', to: 'node-generation-task', infoType: 'GenerationBatchSubmittedObservedInfo' },
        { from: 'src-generation-poll', to: 'node-generation-task', infoType: 'GenerationBatchPolledObservedInfo' },
        { from: 'src-generation-poll-scheduler', to: 'node-generation-task', infoType: 'GenerationTasksPollRequestedInfo' },
        { from: 'sink-generation-download', to: 'node-generation-task', infoType: 'GenerationBatchDownloadedObservedInfo' },
      ]

      const edges: CausalEdge3D[] = routes.map((r, idx) => ({
        id: `route-${idx}-${r.from}-${r.to}`,
        from: r.from,
        to: r.to,
        lastInfoType: r.infoType,
        color: '#000',
        active: true,
      }))

      const layout = computeSwissGridLayout(nodes, edges)
      expect(layout.nodes).toHaveLength(16)
      expect(layout.edges).toHaveLength(37)

      // 验证对全量 16 张卡片与 37 条连线，绝无任何穿透
      for (const card of layout.nodes) {
        const cardLeft = card.x + 3
        const cardRight = card.x + card.width - 3
        const cardTop = card.y + 3
        const cardBottom = card.y + card.height - 3

        for (const edge of layout.edges) {
          for (let i = 0; i < edge.points.length - 1; i++) {
            const p1 = edge.points[i]
            const p2 = edge.points[i + 1]

            const segMinX = Math.min(p1.x, p2.x)
            const segMaxX = Math.max(p1.x, p2.x)
            const segMinY = Math.min(p1.y, p2.y)
            const segMaxY = Math.max(p1.y, p2.y)

            const isPenetrating = segmentIntersectsBox(p1, p2, {
              left: cardLeft,
              right: cardRight,
              top: cardTop,
              bottom: cardBottom,
            })
            if (isPenetrating) {
              console.error(`Penetration on card ${card.nodeId} by edge ${edge.id}: (${p1.x},${p1.y}) -> (${p2.x},${p2.y})`)
            }
            expect(isPenetrating).toBe(false)
          }
        }
      }
    })

    it('dynamically assigns port sides based on natural flow direction (not rigidly fixed to left/right)', () => {
      // 场景包含：
      // 1. 前向通信 (Observation -> Domain)
      // 2. 反向通信 (Execution -> Observation)
      // 3. 同列向下紧邻 (Domain Row 0 -> Domain Row 1)
      // 4. 同列向上紧邻 (Domain Row 1 -> Domain Row 0)
      const nodes: CausalNode3D[] = [
        createMockNode('obs_node', 'observation'),
        createMockNode('dom_top', 'domain'),
        createMockNode('dom_bottom', 'domain'),
        createMockNode('exec_node', 'execution'),
      ]

      const edges: CausalEdge3D[] = [
        { id: 'e_fwd', from: 'obs_node', to: 'dom_top', color: '#000', active: true, lastInfoType: 'Fwd' },
        { id: 'e_back', from: 'exec_node', to: 'obs_node', color: '#000', active: true, lastInfoType: 'Back' },
        { id: 'e_down', from: 'dom_top', to: 'dom_bottom', color: '#000', active: true, lastInfoType: 'Down' },
        { id: 'e_up', from: 'dom_bottom', to: 'dom_top', color: '#000', active: true, lastInfoType: 'Up' },
      ]

      const layout = computeSwissGridLayout(nodes, edges)

      const fwdEdge = layout.edges.find((e) => e.id === 'e_fwd')!
      const backEdge = layout.edges.find((e) => e.id === 'e_back')!
      const downEdge = layout.edges.find((e) => e.id === 'e_down')!
      const upEdge = layout.edges.find((e) => e.id === 'e_up')!

      // 1. 前向边：自然从右出，从左入
      expect(fwdEdge.fromSide).toBe('right')
      expect(fwdEdge.toSide).toBe('left')
      expect(fwdEdge.points[0].x).toBeLessThan(fwdEdge.points[fwdEdge.points.length - 1].x)

      // 2. 反向边：自然从左直接引出，从右直接接入（绝不向右环卡绕圈）
      expect(backEdge.fromSide).toBe('left')
      expect(backEdge.toSide).toBe('right')
      expect(backEdge.points[0].x).toBeGreaterThan(backEdge.points[backEdge.points.length - 1].x)

      // 3. 同列向下相邻边：自然从底出，从顶入（直接在行间垂直连接）
      expect(downEdge.fromSide).toBe('bottom')
      expect(downEdge.toSide).toBe('top')
      expect(downEdge.points[0].y).toBeLessThan(downEdge.points[downEdge.points.length - 1].y)

      // 4. 同列向上相邻边：自然从顶出，从底入
      expect(upEdge.fromSide).toBe('top')
      expect(upEdge.toSide).toBe('bottom')
      expect(upEdge.points[0].y).toBeGreaterThan(upEdge.points[upEdge.points.length - 1].y)
    })

    it('evenly arranges multiple ports along horizontal and vertical edges without stacking', () => {
      // 场景：同一个节点接收多个同列垂直输入与多个水平输入
      const nodes: CausalNode3D[] = [
        createMockNode('top_1', 'domain'),
        createMockNode('top_2', 'domain'),
        createMockNode('target_node', 'domain'),
      ]

      const edges: CausalEdge3D[] = [
        { id: 'v1', from: 'top_1', to: 'target_node', color: '#000', active: true },
        { id: 'v2', from: 'top_2', to: 'target_node', color: '#000', active: true },
      ]

      const layout = computeSwissGridLayout(nodes, edges)
      const targetCard = layout.nodes.find((n) => n.nodeId === 'target_node')!
      const ev1 = layout.edges.find((e) => e.id === 'v1')!
      const ev2 = layout.edges.find((e) => e.id === 'v2')!

      // 两个终点端子均位于卡片边界上，且不重叠
      const pt1 = ev1.points[ev1.points.length - 1]
      const pt2 = ev2.points[ev2.points.length - 1]

      expect(pt1.x !== pt2.x || pt1.y !== pt2.y).toBe(true)
    })
  })
})

