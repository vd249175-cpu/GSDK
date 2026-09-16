import { describe, expect, it } from 'vitest'
import type { ProjectNode } from '@graphvideo/client-sdk'
import {
  assertGenerationExecutionResult, compileManualPrompt, copyableGenerationReferences,
  generationModelReferences, mediaDependencyVersionClipboardItems, resolveGenerationReferences,
} from './generationBundle'

const nodes: Record<string, ProjectNode> = {
  target: { id: 'target', type: 'video', title: '追逐镜头', description: '', prompt: '' },
  imageA: {
    id: 'node_image_a', type: 'image', title: '角色立绘', description: '', prompt: '',
    history: [{
      id: 'image-v1', label: 'image.png', relativePath: 'nodes/image/media/image.png',
      mimeType: 'image/png', createdAt: '', source: 'upload', current: true,
    }],
  },
  imageB: { id: 'node_image_b', type: 'image', title: '场景图', description: '', prompt: '', history: [] },
  audio: { id: 'node_audio', type: 'audio', title: '环境音', description: '', prompt: '', history: [] },
  audioReady: {
    id: 'node_audio_ready', type: 'audio', title: '已完成环境音', description: '', prompt: '',
    history: [{
      id: 'audio-v1', label: 'audio.wav', relativePath: 'nodes/audio/media/audio.wav',
      mimeType: 'audio/wav', createdAt: '', source: 'generated', current: true,
    }],
  },
  videoReady: {
    id: 'node_video_ready', type: 'video', title: '已完成视频', description: '', prompt: '',
    history: [{
      id: 'video-v1', label: 'video.mp4', relativePath: 'nodes/video/media/video.mp4',
      mimeType: 'video/mp4', createdAt: '', source: 'generated', current: true,
    }],
  },
  text: { id: 'node_text', type: 'text', title: '剧本文字', description: '', content: '不可复制为文件。' },
  style: { id: 'node_style', type: 'style', title: '胶片风格', description: '', content: '低饱和青蓝胶片质感。' },
}

describe('generation prompt references', () => {
  const prompt = '参考 node_image_b，然后使用 node_audio；再次参考 node_image_b 和 node_image_a。风格 node_style。'

  it('orders stable-id references by their first prompt occurrence and deduplicates them', () => {
    const references = resolveGenerationReferences(prompt, nodes, 'target')
    expect(references.map((reference) => reference.node.id)).toEqual([
      'node_image_b', 'node_audio', 'node_image_a', 'node_style',
    ])
    expect(references.map((reference) => reference.ordinal)).toEqual([1, 1, 2, 1])
  })

  it('only exposes referenced media with a current version for native dragging', () => {
    const references = resolveGenerationReferences(prompt, nodes, 'target')
    expect(copyableGenerationReferences(references).map((reference) => reference.node.id)).toEqual(['node_image_a'])
  })

  it('correctly matches node ids followed by sentence punctuation like periods and colons', () => {
    const puncPrompt = 'Starting from node_image_a. Synchronized audio node_audio: loud beat.'
    const references = resolveGenerationReferences(puncPrompt, nodes, 'target')
    expect(references.map((reference) => reference.node.id)).toEqual(['node_image_a', 'node_audio'])
  })

  it('includes tree structural children as dependencies', () => {
    const tree = [
      {
        key: 'tree-target',
        kind: 'node' as const,
        title: '追逐镜头',
        depth: 0,
        line: 1,
        relation: 'root' as const,
        nodeId: 'target',
        children: [
          {
            key: 'tree-child-1',
            kind: 'node' as const,
            title: '场景图',
            depth: 1,
            nodeId: 'node_image_b',
            children: [],
          },
        ],
      },
    ]
    const references = resolveGenerationReferences('No explicit mention in prompt text', nodes, 'target', tree)
    expect(references.map((reference) => reference.node.id)).toEqual(['node_image_b'])
  })

  it('correctly resolves natural markdown logic tags like [@角色立绘] and [~环境音]', () => {
    const tagPrompt = '镜头推进 [@角色立绘]，背景响起 [~环境音]，应用 [&胶片风格] 滤镜。'
    const references = resolveGenerationReferences(tagPrompt, nodes, 'target')
    expect(references.map((reference) => reference.node.id)).toEqual([
      'node_image_a', 'node_audio', 'node_style',
    ])
    expect(references.map((reference) => reference.ordinal)).toEqual([1, 1, 1])
  })

  it('correctly resolves YAML header explicit references (e.g. voiceReference, referenceImages)', () => {
    const yamlPrompt = '---\nmodel: seedance-video\nvoiceReference: node_audio\nreferenceImages: [node_image_a, node_image_b]\n---\n镜头向主角推进。'
    const references = resolveGenerationReferences(yamlPrompt, nodes, 'target')
    expect(references.map((reference) => reference.node.id)).toEqual([
      'node_audio', 'node_image_a', 'node_image_b',
    ])
  })

  it('creates file clipboard identities only for current media dependencies', () => {
    expect(mediaDependencyVersionClipboardItems([
      'node_image_a', 'node_image_b', 'node_style', 'node_text', 'node_audio',
      'node_audio_ready', 'node_video_ready', 'node_image_a',
    ], nodes)).toEqual([
      { nodeId: 'node_image_a', versionId: 'image-v1' },
      { nodeId: 'node_audio_ready', versionId: 'audio-v1' },
      { nodeId: 'node_video_ready', versionId: 'video-v1' },
    ])
  })

  it('compiles manual references into text content and media ordinal aliases', () => {
    expect(compileManualPrompt(
      '第一人称近景，[@角色立绘]。剧本：[$剧本文字] 风格：&胶片风格',
      [
        { id: 'node_image_a', type: 'image', title: '角色立绘', ordinal: 1 },
        { id: 'node_text', type: 'text', title: '剧本文字', ordinal: 1, content: '小猫咪乖巧对视。' },
        { id: 'node_style', type: 'style', title: '胶片风格', ordinal: 1, content: '低饱和青蓝胶片质感。' },
      ],
    )).toBe('第一人称近景，Image_1。剧本：小猫咪乖巧对视。 风格：低饱和青蓝胶片质感。')
  })

  it('keeps dependency order while numbering each asset kind independently', () => {
    expect(generationModelReferences([
      'node_image_a', 'node_audio_ready', 'node_image_b', 'node_video_ready',
    ], nodes).map(({ id, ordinal }) => ({ id, ordinal }))).toEqual([
      { id: 'node_image_a', ordinal: 1 },
      { id: 'node_audio_ready', ordinal: 1 },
      { id: 'node_image_b', ordinal: 2 },
      { id: 'node_video_ready', ordinal: 1 },
    ])
  })

  it('refuses to display empty or unpersisted generation responses as success', () => {
    expect(() => assertGenerationExecutionResult({ status: 'completed', items: [] }, ['target']))
      .toThrow(/请求 1 项，完成 0 项/)
    expect(() => assertGenerationExecutionResult({
      status: 'completed', items: [{ nodeId: 'target', status: 'downloaded', versionId: 'v-1' }],
    }, ['target'])).not.toThrow()
  })
})
