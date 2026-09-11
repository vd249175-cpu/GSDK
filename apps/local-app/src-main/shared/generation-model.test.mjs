import { describe, expect, it } from 'vitest'
import { validateGenerationModelManifest, validateGenerationParameters } from './generation-model.mjs'

const manifest = {
  schemaVersion: 1,
  id: 'seedance-video',
  name: 'Seedance Video',
  description: '测试模型。',
  mediaType: 'video',
  provider: 'volcengine',
  apiModel: 'seedance-1-5-pro',
  entrypoints: { promptParser: 'prompt-parser.mjs', apiAdapter: 'api-adapter.mjs' },
  capabilities: { modes: ['text', 'image'], references: ['image'], nativeAudio: true },
  parameters: {
    durationSeconds: { type: 'integer', minimum: 2, maximum: 12 },
    aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
  },
  defaults: { durationSeconds: 5, aspectRatio: '16:9' },
}

describe('generation model manifest', () => {
  it('normalizes model capabilities and fixed parameter declarations', () => {
    expect(validateGenerationModelManifest(manifest)).toMatchObject({
      id: 'seedance-video', mediaType: 'video', defaults: manifest.defaults,
    })
  })

  it('rejects undeclared and invalid override parameters', () => {
    const definitions = validateGenerationModelManifest(manifest).parameters
    expect(() => validateGenerationParameters(definitions, { seed: 1 })).toThrow(/不支持参数/)
    expect(() => validateGenerationParameters(definitions, { durationSeconds: 20 })).toThrow(/不能大于/)
  })
})
