import { describe, expect, it } from 'vitest'
import { orderedGenerationReferenceIds } from './generation-reference-order.mjs'

const nodes = [
  { id: 'image-a', type: 'image', title: '前景图' },
  { id: 'image-b', type: 'image', title: '背景图' },
  { id: 'audio-a', type: 'audio', title: '环境声' },
  { id: 'video-a', type: 'video', title: '动作参考' },
  { id: 'style-a', type: 'style', title: '胶片风格' },
  { id: 'target', type: 'video', title: '目标镜头' },
]

describe('canonical generation reference order', () => {
  it('promotes structural dependencies into first prompt-occurrence order across asset kinds', () => {
    expect(orderedGenerationReferenceIds({
      prompt: '先看 [@背景图]，听 [~环境声]，再参考 [@前景图]、[%动作参考]。',
      nodes,
      targetNodeId: 'target',
      structuralIds: ['image-a', 'video-a', 'audio-a', 'image-b', 'style-a'],
    })).toEqual(['image-b', 'audio-a', 'image-a', 'video-a', 'style-a'])
  })

  it('reorders immediately when prompt occurrence order changes', () => {
    const structuralIds = ['image-a', 'image-b']
    expect(orderedGenerationReferenceIds({
      prompt: '先 image-b，后 image-a。', nodes, targetNodeId: 'target', structuralIds,
    })).toEqual(['image-b', 'image-a'])
    expect(orderedGenerationReferenceIds({
      prompt: '先 image-a，后 image-b。', nodes, targetNodeId: 'target', structuralIds,
    })).toEqual(['image-a', 'image-b'])
  })

  it('preserves YAML list order for image, video and audio references', () => {
    expect(orderedGenerationReferenceIds({
      prompt: '---\nmodel: seedance-video\nreferences: [video-a, audio-a, image-b]\n---\n镜头正文',
      nodes,
      targetNodeId: 'target',
    })).toEqual(['video-a', 'audio-a', 'image-b'])
  })

  it('keeps first-frame and last-frame semantic order regardless of YAML key order', () => {
    expect(orderedGenerationReferenceIds({
      prompt: '---\nmodel: seedance-flf2v\nlastFrame: image-b\nfirstFrame: image-a\n---\n镜头正文',
      nodes,
      targetNodeId: 'target',
    })).toEqual(['image-a', 'image-b'])
  })
})
