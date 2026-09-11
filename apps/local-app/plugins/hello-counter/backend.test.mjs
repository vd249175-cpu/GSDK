import { describe, expect, it } from 'vitest'
import { WorldNode, assertRendererRoot } from '@graphvideo/backend-sdk'
import { createTestRuntime } from '@graphvideo/sdk/testing'
import plugin from './backend.mjs'

/** 测试夹具：WorldNode 构造注入可替换 Adapter 的演示，不进生产装配。 */
class SaverNode extends WorldNode {
  constructor(adapter) {
    super('example.saver', 'Saver', { lastSaved: null })
    this.adapter = adapter
  }

  async change(info, ctx) {
    if (info.type === 'SaveTextInfo') {
      const observation = await ctx.effectAdapter(this.adapter, { text: info.payload?.text ?? '' })
      ctx.write('lastSaved', observation)
    }
  }
}

describe('hello-counter', () => {
  it('IncrementInfo 推进计数', async () => {
    const runtime = createTestRuntime({ nodes: plugin.createNodes({}) })
    runtime.inject({ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('example.counter').count).toBe(1)
    runtime.dispose()
  })

  it('SaverNode 经可替换 Adapter 完成一次局部运行', async () => {
    const calls = []
    const fake = {
      id: 'test/fake-saver',
      execute: async (request) => {
        calls.push(request)
        return { saved: true, text: request.text }
      },
    }
    const runtime = createTestRuntime({ nodes: [new SaverNode(fake)] })
    runtime.inject({
      targetNodeId: 'example.saver',
      info: { type: 'SaveTextInfo', payload: { text: 'hi' } },
    })
    await runtime.waitForQuiescence()
    expect(calls).toEqual([{ text: 'hi' }])
    expect(runtime.getState('example.saver').lastSaved).toEqual({ saved: true, text: 'hi' })
    runtime.dispose()
  })

  it('rendererRoots 仅放行自增命令', () => {
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.counter', info: { type: 'IncrementInfo' },
    })).not.toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.counter', info: { type: 'ResetInfo' },
    })).toThrow()
    expect(() => assertRendererRoot([plugin], {
      targetNodeId: 'example.saver', info: { type: 'SaveTextInfo', payload: { text: 'hi' } },
    })).toThrow()
  })
})
