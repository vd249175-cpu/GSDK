import { Node, defineBackendPlugin } from '@graphvideo/backend-sdk'

export class CounterNode extends Node {
  constructor() {
    super('example.counter', 'Counter', { count: 0 })
  }

  change(info, ctx) {
    if (info.type === 'IncrementInfo') {
      ctx.patchState({ count: ctx.read('count') + 1 })
    }
  }
}

export default defineBackendPlugin({
  id: 'example.hello-counter',
  createNodes: () => [new CounterNode()],
  // 唯一 renderer 可达根：用户显式自增命令。主进程 inject 前用
  // assertRendererRoot 强制校验。WorldNode/Adapter 演示见 backend.test.mjs
  // 测试夹具（SaverNode），不进生产装配。
  rendererRoots: [
    {
      targetNodeId: 'example.counter',
      infoType: 'IncrementInfo',
      validate: (info) => info?.type === 'IncrementInfo',
    },
  ],
})
