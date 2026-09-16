import { describe, expect, it } from 'vitest'
import { parseGenerationModelPackage } from './generation-model-package.mjs'

function packageFiles(overrides = {}) {
  return {
    'model.json': JSON.stringify({
      schemaVersion: 2,
      id: 'custom-video',
      name: 'Custom Video',
      description: 'Fixture model.',
      mediaType: 'video',
      provider: 'comfy',
      parameters: { duration: { type: 'integer', minimum: 1, maximum: 10 } },
      defaults: { duration: 5 },
      budget: { kind: 'fixed', credits: 1 },
    }),
    'execution.json': JSON.stringify({
      schemaVersion: 2,
      kind: 'comfy-template',
      workflow: 'workflow.json',
      outputKind: 'video',
      bindings: [],
      referenceSlots: [],
    }),
    'workflow.json': JSON.stringify({ 1: { class_type: 'SaveVideo', inputs: {} } }),
    ...overrides,
  }
}

describe('generation model package v2 parser', () => {
  it('returns a structured-cloneable normalized snapshot', () => {
    const snapshot = parseGenerationModelPackage({ directoryName: 'custom-video', files: packageFiles() })
    expect(structuredClone(snapshot)).toEqual(snapshot)
    expect(snapshot.model.defaults).toEqual({ duration: 5 })
    expect(snapshot.execution.kind).toBe('comfy-template')
  })

  it('rejects v1, unknown files, directory mismatches and invalid defaults', () => {
    const v1 = packageFiles({
      'model.json': JSON.stringify({ schemaVersion: 1, id: 'custom-video' }),
    })
    expect(() => parseGenerationModelPackage({ directoryName: 'custom-video', files: v1 })).toThrow(/schemaVersion 必须是 2/)
    expect(() => parseGenerationModelPackage({ directoryName: 'other', files: packageFiles() })).toThrow(/目录名必须与 model.id 相同/)
    expect(() => parseGenerationModelPackage({ directoryName: 'custom-video', files: packageFiles({ 'model.py': 'unsafe' }) })).toThrow(/不允许的文件/)
    const badDefault = packageFiles({
      'model.json': JSON.stringify({
        schemaVersion: 2, id: 'custom-video', name: 'A', description: 'B', mediaType: 'video', provider: 'comfy',
        parameters: { duration: { type: 'integer' } }, defaults: { duration: 'five' },
      }),
    })
    expect(() => parseGenerationModelPackage({ directoryName: 'custom-video', files: badDefault })).toThrow(/默认值必须是 integer/)
  })

  it('rejects unsupported execution shapes and oversized files', () => {
    expect(() => parseGenerationModelPackage({
      directoryName: 'custom-video',
      files: packageFiles({ 'execution.json': JSON.stringify({ schemaVersion: 2, kind: 'script', entry: 'model.py' }) }),
    })).toThrow(/不受支持/)
    expect(() => parseGenerationModelPackage({
      directoryName: 'custom-video',
      files: packageFiles({ 'workflow.json': JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }) }),
    })).toThrow(/不能超过1 MiB/)
  })

  it('rejects unsafe Comfy workflow content while loading the package', () => {
    expect(() => parseGenerationModelPackage({
      directoryName: 'custom-video',
      files: packageFiles({
        'workflow.json': JSON.stringify({ '1': { class_type: 'SaveVideo', inputs: { api_key: 'do-not-load' } } }),
      }),
    })).toThrow(/敏感字段/)
  })
})
