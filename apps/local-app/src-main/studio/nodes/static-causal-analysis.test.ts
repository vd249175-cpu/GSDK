import { describe, expect, it } from 'vitest'
import { buildAllNodesView, buildCausalIndex } from '@graphvideo/sdk/analysis'
import { createStudioNodes } from './studio-factories'
import { Node } from '@graphvideo/kernel'

class DynamicMockExtensionNode extends Node<{ pingCount: number }> {
  constructor(id = 'node-mock-extension') {
    super(id, '动态扩展节点', { pingCount: 0 })
  }

  change(info: any, ctx: any) {
    if (info.type === 'PingInfo') {
      ctx.send({ type: 'PongInfo' }, 'node-outliner')
      ctx.write({ pingCount: this.state.pingCount + 1 })
    }
  }
}

describe('Static Causal Operator Analysis', () => {
  it('statically extracts all potential send routes from studio nodes without running them', () => {
    const nodes = createStudioNodes({})
    const index = buildCausalIndex({ nodeObjects: nodes })
    const view = buildAllNodesView(index)

    expect(view.routes.length).toBeGreaterThanOrEqual(15)

    const routeKeys = view.routes.map((r) => `${r.from}->${r.to}`)
    expect(routeKeys).toContain('src-fs-source->node-md-source')
    expect(routeKeys).toContain('node-md-source->node-md-parser')
    expect(routeKeys).toContain('node-md-parser->node-outliner')
    expect(routeKeys).toContain('node-outliner->node-sec-gate')
    expect(routeKeys).toContain('node-sqlite->sink-sqlite-writer')
    expect(routeKeys).toContain('sink-sqlite-writer->src-sqlite-observer')
    expect(routeKeys).toContain('src-sqlite-observer->node-sqlite')
    expect(routeKeys).toContain('node-sec-gate->node-generation-task')
    expect(routeKeys).toContain('node-generation-task->node-sec-gate')
    expect(routeKeys).toContain('node-generation-task->src-generation-poll')
    expect(routeKeys).toContain('node-generation-task->sink-generation-download')
  })

  it('re-runs static analysis dynamically when nodes are evicted or admitted', () => {
    const baseNodes = createStudioNodes({})

    // 1. 初始分析
    const index1 = buildCausalIndex({ nodeObjects: baseNodes })
    const view1 = buildAllNodesView(index1)
    expect(view1.nodes.has('node-generation-task')).toBe(true)

    // 2. 踢出节点 (Evict node-generation-task)
    const evictedNodes = baseNodes.filter((n) => n.id !== 'node-generation-task')
    const index2 = buildCausalIndex({ nodeObjects: evictedNodes })
    const view2 = buildAllNodesView(index2)
    expect(view2.nodes.has('node-generation-task')).toBe(false)
    const routesAfterEvict = view2.routes.map((r) => `${r.from}->${r.to}`)
    expect(routesAfterEvict.some((k) => k.includes('node-generation-task'))).toBe(false)

    // 3. 动态准入新节点 (Admit dynamic node)
    const admittedNodes = [...baseNodes, new DynamicMockExtensionNode('node-mock-ext')]
    const index3 = buildCausalIndex({ nodeObjects: admittedNodes })
    const view3 = buildAllNodesView(index3)
    expect(view3.nodes.has('node-mock-ext')).toBe(true)
    const routesAfterAdmit = view3.routes.map((r) => `${r.from}->${r.to}`)
    expect(routesAfterAdmit).toContain('node-mock-ext->node-outliner')
  })
})
