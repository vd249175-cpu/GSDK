import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SwissNodeDetailPanel } from './SwissNodeDetailPanel'
import type { CausalEdge3D, CausalNode3D } from '../../types'

describe('SwissNodeDetailPanel Component', () => {
  const mockNode: CausalNode3D = {
    id: 'host-el',
    name: '应用级桌面渲染宿主',
    role: 'execution',
    generation: 0,
    version: 12,
    status: 'RUNNING',
    position: [0, 0, 0],
    color: '#000000',
    state: {
      isWindowOpen: true,
      retryCount: 3,
      config: { title: 'Desktop', width: 1200 },
    },
    inDegree: 1,
    outDegree: 0,
  }

  const allNodes: CausalNode3D[] = [
    {
      id: 'timeline-core',
      name: '时间线调度核心',
      role: 'domain',
      generation: 1,
      version: 5,
      status: 'IDLE',
      position: [0, 0, 0],
      color: '#000000',
      state: {},
      inDegree: 0,
      outDegree: 1,
    },
    mockNode,
  ]

  const edges: CausalEdge3D[] = [
    {
      id: 'e-timeline->host-el',
      from: 'timeline-core',
      to: 'host-el',
      color: '#ff3300',
      active: true,
      lastInfoType: 'WindowRenderCmd',
    },
  ]

  it('renders node specification sheet with correct Bauhaus typography and metadata', () => {
    const html = renderToStaticMarkup(
      <SwissNodeDetailPanel
        node={mockNode}
        allNodes={allNodes}
        edges={edges}
        onClose={() => {}}
        onSelectNode={() => {}}
      />,
    )

    // 1. 验证标题与元数据
    expect(html).toContain('SPECIFICATION SHEET // 03')
    expect(html).toContain('应用级桌面渲染宿主')
    expect(html).toContain('host-el')
    expect(html).toContain('v12')
    expect(html).toContain('ACTIVE')
    expect(html).toContain('GEN.00')

    // 2. 验证上游因果链路展示
    expect(html).toContain('时间线调度核心')
    expect(html).toContain('WindowRenderCmd')

    // 3. 验证状态字典键值解析
    expect(html).toContain('isWindowOpen')
    expect(html).toContain('retryCount')
    expect(html).toContain('Desktop')

    // 4. 验证执行类微内核合规红线说明
    expect(html).toContain('执行类节点规约')
    expect(html).toContain('EffectAdapter')
  })
})
