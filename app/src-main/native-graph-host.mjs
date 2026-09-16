import {NativeRuleSpace, mountDomainNode, replaceDomainNode} from '@graphvideo/sdk/node'
import {assertRendererRoot} from '@graphvideo/sdk/plugin'
import studioPlugin from '../../plugins/graphvideo.studio/backend.js'

/**
 * 原生微内核图宿主 (NativeGraphHost)：
 * 统一基于 Rust 原生微内核（crates/kernel 经 NativeRuleSpace），
 * 负责 Studio 节点的调度、生命周期、物理适配器依赖注入以及 Projection 导出。
 */
export function createNativeGraphHost({
  dependencies = {}, plugins = [studioPlugin], mountStudioNodes = true,
  analysisFrontendLinks = [], analysisFrontendServiceLinks = [],
} = {}) {
  const explicitlyLinked = new Set(analysisFrontendLinks.map((link) => (
    `${link.injection.targetNodeId}\0${link.injection.infoType}`
  )))
  const rendererRootLinks = plugins.flatMap((plugin) => (plugin.rendererRoots ?? []).flatMap((root) => {
    const key = `${root.targetNodeId}\0${root.infoType}`
    if (explicitlyLinked.has(key)) return []
    const id = `rendererRoot:${plugin.id}:${root.targetNodeId}:${root.infoType}`
    return [{ id, applicationMethod: id, injection: {
      targetNodeId: root.targetNodeId, infoType: root.infoType,
    }, projections: [] }]
  }))
  const space = new NativeRuleSpace({
    analysisFrontendLinks: [...analysisFrontendLinks, ...rendererRootLinks],
    analysisFrontendServiceLinks,
  })
  const mountedNodes = []

  const mountedStudioPlugin = plugins.find((p) => p?.id === studioPlugin.id)
  if (mountStudioNodes && mountedStudioPlugin) {
    const studioNodes = mountedStudioPlugin.createNodes({ dependencies })
    for (const node of studioNodes) {
      mountDomainNode(space, node)
      mountedNodes.push(node)
    }
  }

  return {
    space,
    nodes: mountedNodes,

    /**
     * 挂载额外节点（如测试用节点）
     */
    mount(nodes) {
      for (const node of nodes) {
        mountDomainNode(space, node)
        mountedNodes.push(node)
      }
    },

    /**
     * 前端/外部指令强类型根注入：
     * 1. 严格校验是否在 plugins 的 rendererRoots 显式声明白名单中；
     * 2. 调用 Rust 微内核的 injectRoot 发起 submission；
     * 3. 阻塞等待 submission 达成因果确定性收敛后返回最新 Projection。
     */
    async injectRoot(targetNodeId, info, submissionId) {
      assertRendererRoot(plugins, { targetNodeId, info })
      if (space.generation(targetNodeId) === null) {
        throw new Error(`未找到目标节点: ${targetNodeId}`)
      }
      const actualSubmissionId = space.injectRoot(targetNodeId, info, submissionId)
      await space.waitForSubmission(actualSubmissionId)
      return {
        status: 'accepted',
        submissionId: actualSubmissionId,
        projection: space.readProjection(),
      }
    },

    readProjection() {
      return space.readProjection()
    },

    readStaticTopology() {
      return space.readStaticTopology()
    },

    subscribeCausalTelemetry(callback) {
      return space.subscribeCausalEvents(callback)
    },

    readNodeState(nodeId) {
      const projection = space.readProjection()
      const entry = projection.nodes.find((n) => n.nodeId === nodeId)
      if (!entry) return undefined
      return space.valueCodec.decode(entry.state)
    },

    /** Trusted main-process Agent control plane. Never route through graph:request. */
    agentInspect({ after = 0, limit = 100 } = {}) {
      const projection = space.readProjection()
      return {
        projection,
        nodeStates: projection.nodes.map((entry) => ({
          nodeId: entry.nodeId,
          generation: space.generation(entry.nodeId),
          version: entry.version,
          state: space.valueCodec.decode(entry.state),
        })),
        pendingInfos: space.readPendingInfos(),
        drops: space.drops(),
        causalEvents: space.readCausalEvents({ after, limit }),
      }
    },

    agentAnalyze(request) {
      return space.analyze(request)
    },

    async agentInject(targetNodeId, info, { actor, reason }) {
      const result = space.injectAgentInfo(targetNodeId, info, { actor, reason })
      await space.waitForSubmission(result.submissionId)
      return { ...result, projection: space.readProjection() }
    },

    agentInterveneState(nodeId, patch, options) {
      return space.interveneState(nodeId, patch, options)
    },

    generation(nodeId) {
      return space.generation(nodeId)
    },

    async hotSwap(node) {
      if (!space.getState(node.id)) throw new Error(`热替换目标未装配: ${node.id}`)
      return replaceDomainNode(space, node)
    },

    dispose() {
      return space.dispose()
    },

    // 计数器兼容
    async injectCounter() {
      const targetNodeId = 'example.counter'
      const info = { type: 'IncrementInfo' }
      if (space.generation(targetNodeId) === null) throw new Error(`未找到目标节点: ${targetNodeId}`)
      const subId = space.injectRoot(targetNodeId, info)
      await space.waitForSubmission(subId)
      return this.readCounter()
    },
    readCounter() {
      const node = space.readProjection().nodes.find((entry) => entry.nodeId === 'example.counter')
      if (!node) return { count: 0 }
      return { count: space.valueCodec.decode(node.state).count }
    },
  }
}
