import {NativeRuleSpace, mountDomainNode, replaceDomainNode} from '@graphvideo/sdk/node'
import {assertRendererRoot} from '@graphvideo/sdk/plugin'

/**
 * 原生微内核图宿主 (NativeGraphHost)：
 * 基于 Rust NativeRuleSpace，装配调用方提供的普通插件并导出 Projection。
 */
export function createEmptyNativeGraphHost({
  dependencies = {}, plugins = [],
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

  let accepting = true
  let assembling = false
  const assertAccepting = () => {
    if (!accepting) throw new Error('Graph host is closing')
  }

  return {
    space,
    nodes: mountedNodes,

    /** Gate untrusted roots and topology changes; lifecycle roots use space. */
    stopAccepting() { accepting = false },

    async mountPlugins() {
      assertAccepting()
      if (assembling) throw new Error('Plugin assembly is already in progress')
      assembling = true
      const created = []
      const admitted = []
      try {
        for (const plugin of plugins) {
          const nodes = plugin.createNodes({ dependencies })
          created.push(...nodes)
          for (const node of nodes) {
            mountDomainNode(space, node)
            admitted.push(node)
            mountedNodes.push(node)
          }
        }
        return admitted.map((node) => ({ nodeId: node.id, generation: space.generation(node.id) }))
      } catch (error) {
        const cleanup = await Promise.allSettled(created.map(async (node) => {
          if (admitted.includes(node)) await space.evict(node.id)
          else await node.dispose()
        }))
        for (const node of admitted) mountedNodes.splice(mountedNodes.indexOf(node), 1)
        const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason)
        try { await space.waitForDisposals() } catch (failure) { failures.push(failure) }
        throw new AggregateError([error, ...failures], 'Plugin assembly failed', { cause: error })
      } finally { assembling = false }
    },

    async evict(nodeIds, options) {
      const results = []
      for (const nodeId of nodeIds) {
        try {
          const evicted = await space.evict(nodeId, options)
          results.push({ nodeId, evicted })
        } catch (error) { results.push({ nodeId, error }) }
        if (!space.admittedEntities().includes(nodeId)) {
          const index = mountedNodes.findIndex((node) => node.id === nodeId)
          if (index !== -1) mountedNodes.splice(index, 1)
        }
      }
      return results
    },

    shutdown() { return space.shutdown() },

    /**
     * 挂载额外节点（如测试用节点）
     */
    mount(nodes) {
      assertAccepting()
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
      assertAccepting()
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
      assertAccepting()
      const result = space.injectAgentInfo(targetNodeId, info, { actor, reason })
      await space.waitForSubmission(result.submissionId)
      return { ...result, projection: space.readProjection() }
    },

    agentInterveneState(nodeId, patch, options) {
      assertAccepting()
      return space.interveneState(nodeId, patch, options)
    },

    generation(nodeId) {
      return space.generation(nodeId)
    },

    async hotSwap(node) {
      assertAccepting()
      if (!space.getState(node.id)) throw new Error(`热替换目标未装配: ${node.id}`)
      return replaceDomainNode(space, node)
    },

    dispose(options) {
      accepting = false
      return space.dispose(options).finally(() => {
        if (!space.admittedEntities().length) mountedNodes.splice(0)
      })
    },

  }
}

/** Convenience assembly; explicit lifecycle callers use createEmptyNativeGraphHost. */
export function createNativeGraphHost(options = {}) {
  const host = createEmptyNativeGraphHost(options)
  const created = []
  try {
    for (const plugin of options.plugins ?? []) {
      const nodes = plugin.createNodes({ dependencies: options.dependencies ?? {} })
      created.push(...nodes)
      host.mount(nodes)
    }
    return host
  } catch (error) {
    const cleanup = Promise.allSettled(created.filter((node) => !host.nodes.includes(node)).map((node) => node.dispose()))
      .then(async (results) => {
        await host.dispose()
        const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
        if (errors.length) throw new AggregateError(errors, 'Assembly cleanup failed')
      })
    void cleanup.catch((failure) => console.error('[NativeGraphHost] Assembly cleanup failed:', failure))
    throw error
  }
}
