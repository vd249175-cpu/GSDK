import { describe, expect, it } from 'vitest'
import { assertRendererRoot, createPluginNodes, defineBackendPlugin, Node } from './index'

class PluginNode extends Node<Record<string, never>> {
  constructor() { super('example-node', {}) }
  protected async change() {}
}

describe('plugin public commands', () => {
  it('uses the same opt-in root contract for third-party backend plugins', () => {
    const plugin = defineBackendPlugin({ id: 'example.third-party', createNodes: () => [new PluginNode()], rendererRoots: [
      { targetNodeId: 'example-node', infoType: 'ExampleCommand', validate: (info) => typeof info.text === 'string' },
    ] })
    expect(createPluginNodes([plugin], {})).toHaveLength(1)
    expect(() => assertRendererRoot([plugin], { targetNodeId: 'example-node', info: { type: 'ExampleCommand', text: 'hello' } })).not.toThrow()
    expect(() => assertRendererRoot([plugin], { targetNodeId: 'example-node', info: { type: 'ExampleCommand', text: 1 } })).toThrow()
    expect(() => assertRendererRoot([plugin], { targetNodeId: 'example-node', info: { type: 'InternalObservation' } })).toThrow()
  })

  it('refuses a plugin declaration for a node it does not own', () => {
    const plugin = defineBackendPlugin({ id: 'example.third-party', createNodes: () => [new PluginNode()], rendererRoots: [
      { targetNodeId: 'sink-generation-submit', infoType: 'GenerationSubmitBatchRequestedInfo', validate: () => true },
    ] })
    expect(() => createPluginNodes([plugin], {})).toThrow(/renderer root 无效/)
  })
})
