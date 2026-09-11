import { describe, expect, it } from 'vitest'
import plugin from '../plugins/hello-counter/backend.mjs'
import { createGraphHost } from './graph-host.mjs'

/**
 * 回归：Projection state 是 EncodedValue，直接取 .count 会得到
 * undefined（界面空白但显示已连接）。host 必须经 valueCodec.decode。
 */
describe('graph-host', () => {
  it('injectCounter/readCounter 返回解码后的数字', async () => {
    const host = createGraphHost({ plugins: [plugin] })
    host.mount(plugin.createNodes({}))
    try {
      await expect(host.injectCounter()).resolves.toEqual({ count: 1 })
      await expect(host.injectCounter()).resolves.toEqual({ count: 2 })
      await expect(host.readCounter()).toEqual({ count: 2 })
    } finally {
      host.dispose()
    }
  })
})
