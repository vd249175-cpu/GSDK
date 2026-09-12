import { describe, it, expect } from 'vitest'
import { computeGraphAgnosticLayout, type RawNodeInput, type RawEdgeInput } from './layout-engine'

describe('2D Collision-Free Archipelago Layout Engine (2D海岛群岛无重叠排布算法)', () => {
  const sampleNodes: RawNodeInput[] = [
    { nodeId: 'node-generation-task', generation: 0, version: 1, status: 'RUNNING', state: { step: 1 } },
    { nodeId: 'src-generation-poll', generation: 0, version: 1, status: 'IDLE', state: {} },
    { nodeId: 'src-generation-poll-scheduler', generation: 0, version: 1, status: 'IDLE', state: {} },
    { nodeId: 'sink-generation-download', generation: 1, version: 2, status: 'IDLE', state: {} },
    { nodeId: 'sink-generation-asset-register', generation: 1, version: 2, status: 'IDLE', state: {} },
    { nodeId: 'node-outliner', generation: 2, version: 3, status: 'IDLE', state: { title: 'Main Story' } },
  ]

  const sampleEdges: RawEdgeInput[] = [
    { from: 'src-generation-poll-scheduler', to: 'src-generation-poll', infoType: 'PollTrigger' },
    { from: 'src-generation-poll', to: 'node-generation-task', infoType: 'TaskProgress' },
    { from: 'node-generation-task', to: 'sink-generation-download', infoType: 'DownloadAction' },
    { from: 'sink-generation-download', to: 'sink-generation-asset-register', infoType: 'RegisterAction' },
    { from: 'sink-generation-asset-register', to: 'node-outliner', infoType: 'AssetReady' },
  ]

  it('所有海岛高度 Y 必须恒等于 0.0（严格 2D 海平面）', () => {
    const layoutComm = computeGraphAgnosticLayout(sampleNodes, sampleEdges, 'community')
    for (const node of layoutComm.nodes) {
      expect(node.position[1]).toBe(0.0)
    }

    const layoutPipe = computeGraphAgnosticLayout(sampleNodes, sampleEdges, 'pipeline')
    for (const node of layoutPipe.nodes) {
      expect(node.position[1]).toBe(0.0)
    }
  })

  it('任意两个海岛之间必须满足安全间距（距离 >= 12.0），绝对杜绝岛屿重叠', () => {
    const layout = computeGraphAgnosticLayout(sampleNodes, sampleEdges, 'community')
    const nodes = layout.nodes

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].position
        const b = nodes[j].position
        const dist = Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2)
        // 任何两个岛屿中心的物理间距至少 12.0，保证海面开阔且绝不相交重叠
        expect(dist).toBeGreaterThanOrEqual(12.0)
      }
    }
  })

  it('流水线模式下也必须满足安全间距且不能坍缩为简单直线', () => {
    const layout = computeGraphAgnosticLayout(sampleNodes, sampleEdges, 'pipeline')
    const nodes = layout.nodes

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].position
        const b = nodes[j].position
        const dist = Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2)
        expect(dist).toBeGreaterThanOrEqual(12.0)
      }
    }

    // 检查 Z 轴并非全部为 0（即非生硬直线）
    const zCoords = nodes.map((n) => n.position[2])
    const uniqueZ = new Set(zCoords.map((z) => Math.round(z * 10)))
    expect(uniqueZ.size).toBeGreaterThan(1)
  })

  it('群落海域光环必须精准包络群落内的全部岛屿', () => {
    const layout = computeGraphAgnosticLayout(sampleNodes, sampleEdges, 'community')
    for (const comm of layout.communities) {
      const memberNodes = layout.nodes.filter((n) => comm.nodeIds.includes(n.id))
      for (const m of memberNodes) {
        const distToCenter = Math.sqrt(
          (m.position[0] - comm.center[0]) ** 2 + (m.position[2] - comm.center[2]) ** 2,
        )
        // 每个成员岛屿的中心到群落中心的距离必须小于群落半径
        expect(distToCenter).toBeLessThanOrEqual(comm.radius)
      }
    }
  })
})
