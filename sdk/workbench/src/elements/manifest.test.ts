import { describe, expect, it } from 'vitest'
import { parseElementManifest } from './manifest'

describe('Element package manifest', () => {
  it('parses the single minimal Element package contract', () => {
    expect(parseElementManifest('{"id":"vendor.storyboard","name":"Storyboard","apiVersion":1,"entry":"element.ts"}')).toEqual({
      id: 'vendor.storyboard', name: 'Storyboard', apiVersion: 1, entry: 'element.ts',
    })
  })

  it('rejects invalid IDs and entries outside the package', () => {
    expect(() => parseElementManifest('{"id":"Bad ID","name":"Bad","apiVersion":1,"entry":"element.ts"}')).toThrow('Element id')
    expect(() => parseElementManifest('{"id":"bad","name":"Bad","apiVersion":1,"entry":"dist/index.js"}')).toThrow('Element entry')
  })
})
