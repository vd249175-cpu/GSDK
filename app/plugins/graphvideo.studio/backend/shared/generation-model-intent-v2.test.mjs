import { describe, expect, it } from 'vitest'
import { buildModelRequestV2, compileModelIntentV2 } from './generation-model-intent-v2.mjs'
import { parseGenerationModelPackage } from './generation-model-package.mjs'

function snapshot() {
  return parseGenerationModelPackage({
    directoryName: 'fixture-video',
    files: {
      'model.json': JSON.stringify({
        schemaVersion: 2,
        id: 'fixture-video',
        name: 'Fixture Video',
        description: 'Fixture.',
        mediaType: 'video',
        provider: 'comfy',
        parameters: {
          duration: { type: 'integer', minimum: 1, maximum: 20, outputName: 'duration_seconds' },
          quality: { type: 'string', enum: ['standard', 'high'] },
        },
        defaults: { duration: 5, quality: 'standard' },
        prompt: { aliases: { image: 'Picture_{ordinal}' } },
        dependencies: { requireReady: true, counts: { image: { maximum: 2 } } },
        budget: { kind: 'linear', parameter: 'duration', rate: 2 },
        variants: [{ when: { parameter: 'quality', equals: 'high' }, budget: { kind: 'fixed', credits: 30 } }],
      }),
      'execution.json': JSON.stringify({ schemaVersion: 2, kind: 'comfy-template', workflow: 'workflow.json', outputKind: 'video' }),
      'workflow.json': JSON.stringify({ 1: { class_type: 'SaveVideo', inputs: {} } }),
    },
  })
}

describe('v2 generation model intent compiler', () => {
  it('compiles defaults, output names, aliases and budget without model-id branches', () => {
    const result = compileModelIntentV2(snapshot(), {
      nodeType: 'video',
      prompt: '---\nmodel: fixture-video\nduration: 8\n---\nUse node_image.',
      references: [{ id: 'node_image', type: 'image', title: 'Frame', isReady: true, filePath: '/fixture.png' }],
    })
    expect(result.prompt).toBe('Use Picture_1.')
    expect(result.effectiveConfig).toEqual({ duration_seconds: 8, quality: 'standard' })
    expect(result.estimatedCredits).toBe(16)
  })

  it('applies exact-value variants and bounded dependency rules', () => {
    const model = snapshot()
    expect(compileModelIntentV2(model, {
      nodeType: 'video', prompt: '---\nmodel: fixture-video\nquality: high\n---\nA', references: [],
    }).estimatedCredits).toBe(30)
    expect(() => buildModelRequestV2(model, {
      nodeType: 'video', prompt: '---\nmodel: fixture-video\n---\nA',
      references: [1, 2, 3].map((id) => ({ id: `image-${id}`, type: 'image', isReady: true, filePath: `/image-${id}.png` })),
    })).toThrow(/最多支持 2 个 image/)
  })
})
