import { Node, defineBackendPlugin, defineNodeFactory } from '@graphframework/sdk/plugin'

export class CounterNode extends Node {
  constructor(id = 'example.counter') {
    super(id, 'Counter', { count: 0 })
  }

  change(info, ctx) {
    if (info.type === 'IncrementInfo') {
      ctx.patchState({ count: ctx.read('count') + 1 })
    }
  }
}

export const createCounterNode = defineNodeFactory((ctx) => {
  const nodeId = typeof ctx?.nodeId === 'string' && ctx.nodeId ? ctx.nodeId : 'example.counter';
  return new CounterNode(nodeId);
});
createCounterNode.describe = () => ({
  kind: 'node',
  localIds: ['counter'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'counter', infoType: 'IncrementInfo' }],
});

export default defineBackendPlugin({
  id: 'example.hello-counter',
  createNodes: (context) => [createCounterNode(context)],
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
