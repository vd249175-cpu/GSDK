import { Node } from '@graphvideo/backend-sdk'

/**
 * 热更演示的新版本代码制品：与 `plugins/hello-counter/backend.mjs` 同一
 * Node ID、同一 Info 协议，步长改为 +10。独立模块文件模拟磁盘上已更新
 * 的插件代码；宿主经 `hotSwap` 重载它，不重启进程。
 */
export class CounterNodeV2 extends Node {
  constructor() {
    super('example.counter', 'CounterV2', { count: 0 })
  }

  change(info, ctx) {
    if (info.type === 'IncrementInfo') {
      ctx.patchState({ count: ctx.read('count') + 10 })
    }
  }
}
