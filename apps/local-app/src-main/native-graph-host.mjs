import { NativeRuleSpace, assertRendererRoot, describeDomainNode, mountDomainNode } from '@graphvideo/backend-sdk'

/**
 * 原生规则空间图宿主：与 `graph-host.mjs` 同一对外契约（mount →
 * injectCounter → 读数），调度由 Rust 微内核承担，业务 change 逻辑仍是
 * 插件的 `Node` 实例（经 `describeDomainNode` 桥接，领域方法零改动）。
 *
 * 差异（有意为之，非兼容承诺）：
 * - 读数直接来自规则空间状态拷贝，不经 Projection/EncodedValue；
 * - 只支持领域 Node，WorldNode 在 `mountDomainNode` 即拒绝；
 * - `hotSwap` 用新代码实例原子替换同 ID 实体：单飞间隙内 backlog 按
 *   Evicted 丢弃，代次 +1。新实体从自身纯净初值启动，State 绝不隐式
 *   继承——状态迁移只能是替换后注入的普通 Info（调用方显式恢复）。
 */
export function createNativeGraphHost({ plugins = [] } = {}) {
  const space = new NativeRuleSpace()
  return {
    space,
    mount(nodes) {
      for (const node of nodes) mountDomainNode(space, node)
    },
    async injectCounter() {
      const targetNodeId = 'example.counter'
      const info = { type: 'IncrementInfo' }
      assertRendererRoot(plugins, { targetNodeId, info })
      if (space.generation(targetNodeId) === null) throw new Error(`未找到目标节点: ${targetNodeId}`)
      const submissionId = space.injectRoot(targetNodeId, info)
      await space.waitForSubmission(submissionId)
      return readCounterState()
    },
    readCounter() {
      return readCounterState()
    },
    generation(nodeId) {
      return space.generation(nodeId)
    },
    async hotSwap(node) {
      const described = describeDomainNode(node)
      if (!space.getState(described.id)) throw new Error(`热替换目标未装配: ${described.id}`)
      return space.replace(described.id, described.initialState, described.handler)
    },
    dispose() {},
  }
  function readCounterState() {
    const state = space.getState('example.counter')
    if (!state) throw new Error('计数器节点未装配')
    return { count: state.count }
  }
}
