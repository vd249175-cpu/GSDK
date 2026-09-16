import { describe, expect, it } from 'vitest'
import type { GenerationModelManifest } from '@graphvideo/client-sdk'
import { resolveGenerationModelStatus } from './generationModelStatus'

const videoModel = {
  id: 'video-model', name: 'Video Model', description: 'Video generation', mediaType: 'video',
} as GenerationModelManifest

describe('Properties generation model status', () => {
  it('reports provider, YAML, catalog and media type states', () => {
    const prompt = '---\nmodel: video-model\n---\nCreate a shot'
    expect(resolveGenerationModelStatus('video', prompt, [], false, false)?.label)
      .toBe('模型能力不可用')
    expect(resolveGenerationModelStatus('video', 'Create a shot', [], true, true)?.label)
      .toBe('尚未选择模型')
    expect(resolveGenerationModelStatus('video', prompt, [], true, false)?.kind)
      .toBe('pending')
    expect(resolveGenerationModelStatus('video', prompt, [], true, true)?.label)
      .toBe('video-model 未安装')
    expect(resolveGenerationModelStatus('image', prompt, [videoModel], true, true)?.label)
      .toContain('类型不匹配')
    expect(resolveGenerationModelStatus('video', prompt, [videoModel], true, true))
      .toMatchObject({ kind: 'ready', label: 'Video Model' })
  })

  it('does not create model status for text nodes', () => {
    expect(resolveGenerationModelStatus('text', '', [], false, false)).toBeNull()
  })
})
