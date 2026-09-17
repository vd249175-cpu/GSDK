import { describe, expect, it } from 'vitest'
import { Node, locateNativeBinding } from '@graphvideo/sdk/node'
import { createEmptyNativeGraphHost } from './native-graph-host.mjs'

class FixtureNode extends Node {
  constructor(id, calls, fail = false) {
    super(id, id, { count: 0 })
    this.calls = calls
    this.fail = fail
  }
  onMount() { if (this.fail) throw new Error('mount failed') }
  onUnmount() { this.calls.push(this.id) }
  change(_info, ctx) { ctx.write('count', ctx.read('count') + 1) }
}

describe.skipIf(!locateNativeBinding())('explicit graph host assembly', () => {
  it('boots empty, admits without injecting, and independently evicts and stops', async () => {
    const calls = []
    const host = createEmptyNativeGraphHost({ plugins: [{ createNodes: () => [new FixtureNode('owner', calls)] }] })
    expect(host.space.admittedEntities()).toEqual([])
    expect(await host.mountPlugins()).toEqual([{ nodeId: 'owner', generation: 0 }])
    expect(host.readNodeState('owner')).toEqual({ count: 0 })
    expect(await host.evict(['owner'])).toEqual([{ nodeId: 'owner', evicted: true }])
    expect(calls).toEqual(['owner'])
    expect(host.nodes).toEqual([])
    await host.shutdown()
  })

  it('cleans every created node exactly once after partial assembly failure', async () => {
    const calls = []
    const host = createEmptyNativeGraphHost({ plugins: [{ createNodes: () => [
      new FixtureNode('one', calls), new FixtureNode('two', calls, true), new FixtureNode('three', calls),
    ] }] })
    host.mount([new FixtureNode('existing', calls)])
    await expect(host.mountPlugins()).rejects.toThrow('assembly failed')
    expect(calls.sort()).toEqual(['one', 'three', 'two'])
    expect(host.space.admittedEntities()).toEqual(['existing'])
    await host.dispose()
  })
})
