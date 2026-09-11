import { KernelRuntime } from '@graphvideo/kernel'
import { assertRendererRoot } from '@graphvideo/backend-sdk'

/**
 * 主进程图宿主：唯一 Runtime 所有者。
 * 与 `createTestRuntime` 同构（mount → injectRootInfo → 等待自身 submission），
 * 区别是常驻进程生命周期而非单次测试。公理 8：命令只等自身 submission，
 * 不等全图 quiescence。
 *
 * 边界规则：renderer 不得指定任意 Node/Info。唯一写入通道是插件声明的
 * rendererRoots（inject 前 assertRendererRoot）；唯一读取是 Projection
 * 派生的计数 DTO，不直接暴露 Node 私有 State。
 */
export function createGraphHost({ plugins = [] } = {}) {
  const kernel = new KernelRuntime()
  return {
    mount(nodes) {
      kernel.mount(...nodes)
    },
    async injectCounter() {
      const targetNodeId = 'example.counter'
      const info = { type: 'IncrementInfo' }
      assertRendererRoot(plugins, { targetNodeId, info })
      const node = kernel.nodes.get(targetNodeId)
      if (!node) throw new Error(`未找到目标节点: ${targetNodeId}`)
      const submissionId = kernel.injectRootInfo(node, info)
      await kernel.waitForSubmission(submissionId)
      return readCounterState()
    },
    readCounter() {
      return readCounterState()
    },
    readProjection() {
      return kernel.readProjection()
    },
    dispose() {
      kernel.dispose()
    },
  }
  function readCounterState() {
    // Projection state 是 EncodedValue（见 kernel observation.ts），
    // 必须经 valueCodec.decode，与 Studio runtime-composition 同模式。
    const node = kernel.readProjection().nodes.find((entry) => entry.nodeId === 'example.counter')
    if (!node) throw new Error('计数器节点未装配')
    return { count: kernel.valueCodec.decode(node.state).count }
  }
}
