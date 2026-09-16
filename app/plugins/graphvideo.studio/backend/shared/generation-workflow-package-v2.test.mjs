import { describe, expect, it } from 'vitest'
import { validateComfyWorkflowPackage } from './generation-workflow-package-v2.mjs'

const imageGraph = () => ({ '1': { class_type: 'SaveImage', inputs: { images: ['2', 0] } }, '2': { class_type: 'LoadImage', inputs: { image: '' } } })

describe('Comfy workflow package security', () => {
  it('accepts an approved bounded graph', () => {
    expect(validateComfyWorkflowPackage(imageGraph(), 'image')).toEqual(imageGraph())
  })

  it.each([
    [{ '1': { class_type: 'ShellCommand', inputs: {} } }, /class_type 未批准/],
    [{ '1': { class_type: 'SaveImage', inputs: { api_key: 'secret' } } }, /敏感字段/],
    [{ '1': { class_type: 'SaveImage', inputs: { filename: 'C:\\outside.png' } } }, /绝对路径/],
    [{ '1': { class_type: 'SaveVideo', inputs: {} } }, /SaveImage/],
  ])('rejects unsafe workflow content', (graph, message) => {
    expect(() => validateComfyWorkflowPackage(graph, 'image')).toThrow(message)
  })

  it('rejects oversized and deeply nested workflows', () => {
    const graph = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [String(index + 1), { class_type: 'SaveImage', inputs: {} }]))
    expect(() => validateComfyWorkflowPackage(graph, 'image')).toThrow(/1-256/)
    let nested = imageGraph()['1'].inputs
    for (let index = 0; index < 33; index += 1) nested = { nested }
    expect(() => validateComfyWorkflowPackage({ '1': { class_type: 'SaveImage', inputs: nested } }, 'image')).toThrow(/深度/)
  })
})
