import { describe, expect, it, vi } from 'vitest'
import { defineService, ServiceRegistry } from './serviceRegistry'

interface ExampleService {
  read(): string
}

const Example = defineService<ExampleService>('graphvideo.example')

describe('Service registry', () => {
  it('registers, replaces and removes one owner provider', () => {
    const registry = new ServiceRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)

    registry.replaceOwner('example-provider', [{
      id: Example.id, token: Example, value: { read: () => 'first' },
    }])
    expect(registry.require(Example).read()).toBe('first')
    expect(registry.ownerOf(Example)).toBe('example-provider')

    registry.replaceOwner('example-provider', [{
      id: Example.id, token: Example, value: { read: () => 'second' },
    }])
    expect(registry.require(Example).read()).toBe('second')

    registry.unregisterOwner('example-provider')
    expect(registry.get(Example)).toBeUndefined()
    expect(() => registry.require(Example)).toThrow('Service Provider 不可用')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('rejects duplicate and cross-owner providers', () => {
    const registry = new ServiceRegistry()
    const definition = { id: Example.id, token: Example, value: { read: () => 'value' } }
    registry.replaceOwner('first', [definition])

    expect(() => registry.assertCanReplace('second', [definition])).toThrow('Service ID conflict')
    expect(() => registry.assertCanReplace('first', [definition, definition])).toThrow('Service ID 重复')
    expect(registry.require(Example).read()).toBe('value')
  })

  it('rejects invalid stable service IDs', () => {
    expect(() => defineService('Generation Models')).toThrow('Service ID 无效')
    expect(() => defineService('generation/models')).toThrow('Service ID 无效')
  })
})
