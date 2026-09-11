import { mountDomainNode } from '@graphvideo/backend-sdk'
import { FraudNode, InventoryNode, createDemoTopology } from '../plugins/demo-topology/backend.mjs'

/**
 * 演示控制器（main 侧可信调用）：把 CLI 演示的 admit/evict 编成固定步骤。
 * renderer 经 `demo/step`、`demo/reset` 触发，只能拿到投影 DTO，
 * 不能点名任意 Node/Info——拓扑决策永远在 main 侧。
 */
const DEMO_IDS = [
  'demo.orders',
  'demo.router',
  'demo.billing',
  'demo.inventory',
  'demo.ledger',
  'demo.fraud',
]

const PHASE_LABELS = [
  '已启动：基础拓扑已装配',
  '流量运行中',
  '运行中 admit：demo.fraud 已加入并挂接筛查',
  '新流量经过 fraud（verdict 入账）',
  '运行中 evict：demo.inventory 已卸载（send 反馈 dropped，提交照常结算）',
  '重准入 demo.inventory：代次 +1，纯净初值启动',
]

// main 侧现有的节点代码清单：admit 接纳的是已经在这里的代码，不是凭空
// 创造逻辑——没有代码的 id 加不进来，这是物理限制，不是权限。
const NODE_BUILDERS = {
  'demo.fraud': () => new FraudNode(),
  'demo.inventory': () => new InventoryNode(),
}

export function createDemoController(host) {
  const space = host.space
  let phase = 0
  let orderSeq = 0
  let note = null

  function mountBase() {
    for (const node of Object.values(createDemoTopology())) {
      if (space.getState(node.id) === undefined) mountDomainNode(space, node)
    }
  }

  async function submitOrder() {
    orderSeq += 1
    const submission = space.injectRoot('demo.orders', { type: 'SubmitOrder', orderId: `order-${orderSeq}` })
    await space.waitForSubmission(submission)
  }

  function readDemo() {
    const projection = space.readProjection()
    const nodes = projection.nodes
      .filter((entry) => entry.nodeId.startsWith('demo.'))
      .map((entry) => ({
        nodeId: entry.nodeId,
        generation: space.generation(entry.nodeId),
        state: space.valueCodec.decode(entry.state),
      }))
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    const live = new Set(nodes.map((entry) => entry.nodeId))
    const edges = []
    const link = (from, to) => {
      if (live.has(from) && live.has(to)) edges.push({ from, to })
    }
    link('demo.orders', 'demo.router')
    const screening = nodes.find((entry) => entry.nodeId === 'demo.router')?.state.screening ?? []
    for (const id of screening) {
      if (typeof id === 'string') {
        link('demo.router', id)
        link(id, 'demo.ledger')
      }
    }
    link('demo.router', 'demo.billing')
    link('demo.router', 'demo.inventory')
    link('demo.billing', 'demo.ledger')
    link('demo.inventory', 'demo.ledger')
    return { phase, phaseLabel: note ?? PHASE_LABELS[phase], revision: projection.revision, nodes, edges }
  }

  async function admitNode(id) {
    const create = NODE_BUILDERS[id]
    if (!create) throw new Error(`未知节点类型：main 侧没有 ${id} 的代码`)
    const generation = mountDomainNode(space, create())
    if (id === 'demo.fraud') {
      const attach = space.injectRoot('demo.router', { type: 'AttachScreening', nodeId: id })
      await space.waitForSubmission(attach)
    }
    return generation
  }

  function evictNode(id) {
    return space.unregister(id)
  }

  async function step() {
    if (phase === 0) {
      await submitOrder()
      await submitOrder()
      phase = 1
    } else if (phase === 1) {
      await admitNode('demo.fraud')
      phase = 2
    } else if (phase === 2) {
      await submitOrder()
      phase = 3
    } else if (phase === 3) {
      evictNode('demo.inventory')
      phase = 4
    } else if (phase === 4) {
      await admitNode('demo.inventory')
      await submitOrder()
      phase = 5
    } else {
      await submitOrder()
    }
    return readDemo()
  }

  function reset() {
    for (const id of DEMO_IDS) space.unregister(id)
    phase = 0
    orderSeq = 0
    note = null
    mountBase()
    return readDemo()
  }

  async function applyOp(cmd, id) {
    if (cmd === 'reset') {
      reset()
      return '[demo-op] reset done'
    }
    if (cmd === 'admit') {
      if (space.getState(id) !== undefined) return `[demo-op] ${id} already admitted`
      const generation = await admitNode(id)
      note = `外部命令：已 admit ${id}@${generation}`
      return `[demo-op] admitted ${id}@${generation}`
    }
    if (cmd === 'evict') {
      const removed = evictNode(id)
      note = removed ? `外部命令：已 evict ${id}` : `外部命令：${id} 不在图中`
      return `[demo-op] evict ${id}: ${removed}`
    }
    throw new Error(`未知演示命令: ${cmd}`)
  }

  return { mountBase, readDemo, step, reset, applyOp }
}
