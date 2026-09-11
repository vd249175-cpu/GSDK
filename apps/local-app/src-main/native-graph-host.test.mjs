import { describe, expect, it } from 'vitest'
import { locateNativeBinding } from '@graphvideo/backend-sdk'
import plugin from '../plugins/hello-counter/backend.mjs'
import { CounterNodeV2 } from './counter-v2.fixture.mjs'
import { createNativeGraphHost } from './native-graph-host.mjs'

const binary = locateNativeBinding()

/**
 * M4 应用级热重载演示：同一进程、同一规则空间内，用新版本插件代码
 * 原子替换运行中的业务 Node。旧 backlog 丢弃、新逻辑秒级生效。
 */
describe.skipIf(!binary)('native-graph-host hot reload', () => {
  it('生产插件跑在 Rust 调度上，v1 计数可用', async () => {
    const host = createNativeGraphHost({ plugins: [plugin] })
    host.mount(plugin.createNodes({}))
    try {
      await expect(host.injectCounter()).resolves.toEqual({ count: 1 })
      await expect(host.injectCounter()).resolves.toEqual({ count: 2 })
      expect(host.generation('example.counter')).toBe(0)
      const projection = host.readProjection()
      expect(projection.nodes).toHaveLength(1)
      expect(projection.nodes[0]).toMatchObject({ nodeId: 'example.counter', version: 2 })
      expect(projection.revision).toBeGreaterThan(0)
    } finally {
      await host.dispose()
    }
  })

  it('不重启进程热换 v2：未达消息丢弃、新实体纯净启动、新步长立即生效', async () => {
    const host = createNativeGraphHost({ plugins: [plugin] })
    host.mount(plugin.createNodes({}))
    try {
      await expect(host.injectCounter()).resolves.toEqual({ count: 1 })
      // 入队但不泵：这次投递绝不能活过替换。
      const stale = host.space.injectRoot('example.counter', { type: 'IncrementInfo' })
      const generation = await host.hotSwap(new CounterNodeV2())
      expect(generation).toBe(1)
      await host.space.waitForSubmission(stale)
      // 纯净重启：旧 State 不继承，新实体从自身初值启动。
      expect(host.readCounter()).toEqual({ count: 0 })
      // 状态迁移只能是普通 Info：显式重放用户意图，新代码立即生效（步长 +10）。
      await expect(host.injectCounter()).resolves.toEqual({ count: 10 })
      expect(host.generation('example.counter')).toBe(1)
    } finally {
      await host.dispose()
    }
  })
})
