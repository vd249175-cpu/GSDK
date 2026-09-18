import { describe, expect, it } from 'vitest'
import { defineGraphFactory, defineNodeFactory, type FactoryDescription } from '../src/plugin/plugin'
import { Node } from '../src/node/node'

class CounterNode extends Node<{ count: number }> {
  constructor(id = 'example.counter') {
    super(id, 'Counter', { count: 0 })
  }

  protected override change(
    info: { readonly type: string; readonly [key: string]: unknown },
    ctx: { read(key: string): unknown; patchState(patch: Record<string, unknown>): void },
  ): void {
    if (info.type === 'IncrementInfo') ctx.patchState({ count: (ctx.read('count') as number) + 1 })
  }
}

describe('factory contexts and describe purity', () => {
  it('produces fresh object and State identity on every call', () => {
    const factory = defineNodeFactory((_ctx: unknown) => new CounterNode('example.counter'))
    const first = factory(undefined)
    const second = factory(undefined)
    expect(first).not.toBe(second)
    expect(first.getState()).not.toBe(second.getState())
    expect(first.getState()).toEqual(second.getState())
  })

  it('namespaces graph products via nodeIdFor and checks describe purity', () => {
    const description: FactoryDescription = {
      kind: 'graph',
      localIds: ['counter'],
      requiredBindings: [],
      rendererRoots: [{ localId: 'counter', infoType: 'IncrementInfo' }],
    }
    const factory = defineGraphFactory((ctx: {
      instanceId: string
      nodeId: string
      nodeIdFor: (localId: string) => string
    }) => [new CounterNode(ctx.nodeIdFor('counter'))])
    factory.describe = () => description
    const first = factory({ instanceId: 'agent-a', nodeId: 'agent-a', nodeIdFor: (local: string) => `agent-a/${local}` })
    const second = factory({ instanceId: 'agent-b', nodeId: 'agent-b', nodeIdFor: (local: string) => `agent-b/${local}` })
    expect(first.map((node) => node.id)).toEqual(['agent-a/counter'])
    expect(second.map((node) => node.id)).toEqual(['agent-b/counter'])
    expect(first[0]).not.toBe(second[0])
    expect(factory.describe()).toEqual(description)
  })

  it('rejects empty products and impure describe', () => {
    const empty = defineGraphFactory(() => [])
    expect(() => empty(undefined)).toThrow('空集合')
    let calls = 0
    const source = ((ctx: unknown) => [new CounterNode('x')]) as (
      (ctx: unknown) => CounterNode[]
    ) & { describe: () => FactoryDescription }
    source.describe = () => {
      calls += 1
      return {
        kind: 'graph',
        localIds: calls === 1 ? ['x'] : ['y'],
        requiredBindings: [],
        rendererRoots: [],
      }
    }
    const impure = defineGraphFactory(source)
    expect(() => impure(undefined)).toThrow('纯函数')
  })
})
