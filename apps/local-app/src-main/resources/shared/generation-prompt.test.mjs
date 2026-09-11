import { describe, expect, it } from 'vitest'
import {
  parseGenerationPrompt, setGenerationPromptModel, stripGenerationPromptFrontMatter,
} from './generation-prompt.mjs'

describe('generation prompt YAML front matter', () => {
  it('uses YAML as generation configuration while keeping the body separate', () => {
    const source = '---\nmodel: seedance-video\ndurationSeconds: 8\ngenerateAudio: true\n---\n\n镜头推进。'
    expect(parseGenerationPrompt(source)).toEqual({
      body: '镜头推进。',
      config: { model: 'seedance-video', durationSeconds: 8, generateAudio: true },
      hasFrontMatter: true,
      modelId: 'seedance-video',
    })
    expect(stripGenerationPromptFrontMatter(source)).toBe('镜头推进。')
  })

  it('adds or updates a model declaration without changing the prompt body', () => {
    const source = setGenerationPromptModel('保持原正文。', 'chat-image')
    expect(parseGenerationPrompt(source).modelId).toBe('chat-image')
    expect(stripGenerationPromptFrontMatter(source)).toBe('保持原正文。')
    expect(setGenerationPromptModel(source, 'comfyui-image')).toContain('model: comfyui-image')
  })

  it('rejects malformed front matter and unsafe model ids', () => {
    expect(() => parseGenerationPrompt('---\nmodel: video')).toThrow(/结束分隔符/)
    expect(() => parseGenerationPrompt('---\nmodel: ../video\n---\nbody')).toThrow(/model/)
  })
})
