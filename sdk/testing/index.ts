import { KernelRuntime, type Node } from '@graphvideo/kernel'

export { EffectHarness } from '@graphvideo/kernel'
export type {
  EffectFixture,
  EffectHarnessRecord,
  EffectHarnessResult,
} from '@graphvideo/kernel'

export interface TestRuntimeOptions {
  nodes?: readonly Node<any, any>[]
}

export function createTestRuntime(options: TestRuntimeOptions = {}) {
  const kernel = new KernelRuntime()
  if (options.nodes) {
    kernel.mount(...options.nodes)
  }
  const resolveTarget = (targetOrId: string | Node<any>): Node<any> => {
    if (typeof targetOrId === 'string') {
      const node = kernel.nodes.get(targetOrId)
      if (!node) throw new Error(`未找到目标节点: ${targetOrId}`)
      return node
    }
    return targetOrId
  }
  return {
    kernel,
    inject: (
      targetOrPayload: string | Node<any> | { targetNodeId: string; info: any; submissionId?: string },
      info?: any,
      options?: { signal?: AbortSignal; submissionId?: string },
    ) => {
      if (typeof targetOrPayload === 'string' || (targetOrPayload && typeof targetOrPayload === 'object' && 'category' in targetOrPayload)) {
        return kernel.injectRootInfo(resolveTarget(targetOrPayload as any), info, options)
      }
      const payload = targetOrPayload as { targetNodeId: string; info: any; submissionId?: string }
      return kernel.injectRootInfo(resolveTarget(payload.targetNodeId), payload.info, {
        submissionId: payload.submissionId,
      })
    },
    injectRootInfo: (target: string | Node<any>, info: any, options?: any) => (
      kernel.injectRootInfo(resolveTarget(target), info, options)
    ),
    waitForQuiescence: kernel.waitForQuiescence.bind(kernel),
    getState: (nodeId: string) => kernel.nodes.get(nodeId)?.getState(),
    getNode: (nodeId: string) => kernel.nodes.get(nodeId),
    readProjection: () => kernel.readProjection(),
    createProjection: () => kernel.readProjection(),
    dispose: () => kernel.dispose(),
  }
}
