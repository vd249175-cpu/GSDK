import { describe, expect, it } from 'vitest'
import { locateNativeBinding } from '@graphframework/sdk/node'
import plugin from '../backend.mjs'
import { createCounterHost as createGraphHost } from './counter-host.mjs'

const binary = locateNativeBinding()

/**
 * 回归：Projection state 是 EncodedValue，直接取 .count 会得到
 * undefined（界面空白但显示已连接）。host 必须经 valueCodec.decode。
 */
describe.skipIf(!binary)('graph-host (unified native host)', () => {
  it('injectCounter/readCounter 返回解码后的数字', async () => {
    const host = createGraphHost({ plugins: [plugin] })
    try {
      await expect(host.injectCounter()).resolves.toEqual({ count: 1 })
      await expect(host.injectCounter()).resolves.toEqual({ count: 2 })
      await expect(host.readCounter()).toEqual({ count: 2 })
    } finally {
      host.dispose()
    }
  })
})
