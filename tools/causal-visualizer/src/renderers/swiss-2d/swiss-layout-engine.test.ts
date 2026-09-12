import { describe, expect, it } from 'vitest'
import { computeSwissGridLayout } from './swiss-layout-engine'
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

  it('generates strictly Manhattan orthogonal routing paths (only 90 degree elbows)', () => {
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
    expect(edge.points.length).toBe(4)

    // 验证每一段均为纯水平或纯垂直线段（绝无斜线）
    for (let i = 0; i < edge.points.length - 1; i++) {
      const p1 = edge.points[i]
      const p2 = edge.points[i + 1]
      const isHorizontal = Math.abs(p1.y - p2.y) < 0.001
      const isVertical = Math.abs(p1.x - p2.x) < 0.001
      expect(isHorizontal || isVertical).toBe(true)
    }
  })
})
