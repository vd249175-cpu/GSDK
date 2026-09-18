import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildModelRequestV2 } from './generation-model-intent-v2.mjs'
import { parseGenerationModelPackage } from './generation-model-package.mjs'
import { compileGenerationSubmitSpecV2 } from './generation-submit-spec-v2.mjs'

const fixture = fileURLToPath(import.meta.url)
const root = fileURLToPath(new URL('../../resources/generation-models/models', import.meta.url))
const project = { id: 'project-1', name: 'Fixture' }

async function modelPackage(id) {
  const execution = await readFile(join(root, id, 'execution.json'), 'utf8')
  const parsedExecution = JSON.parse(execution)
  return parseGenerationModelPackage({
    directoryName: id,
    files: {
      'model.json': await readFile(join(root, id, 'model.json'), 'utf8'),
      'execution.json': execution,
      ...(parsedExecution.kind === 'comfy-template' ? { 'workflow.json': await readFile(join(root, id, 'workflow.json'), 'utf8') } : {}),
    },
  })
}

describe('audio and mock v2 execution families', () => {
  it.each([
    ['audio-sfx', 'audio', 'Cinematic rain.', { provider: 'audio', taskType: 'SFX' }],
    ['chat-image', 'image', 'Draft image.', { provider: 'mock', kind: 'image' }],
    ['chat-video', 'video', 'Draft video.', { provider: 'mock', kind: 'video' }],
    ['qwen-voice-design', 'audio', 'Warm female narrator.', { provider: 'audio', taskType: 'VOICE_DESIGN' }],
  ])('compiles the locked submit contract for %s', async (id, nodeType, body, expected) => {
    const input = { nodeType, prompt: `---\nmodel: ${id}\n---\n${body}`, references: [] }
    const current = compileGenerationSubmitSpecV2(buildModelRequestV2(await modelPackage(id), input), project)
    expect(current).toMatchObject(expected)
  })

  it('matches Higgs speech and validates required voice ownership', async () => {
    const input = {
      nodeType: 'audio',
      prompt: '---\nmodel: higgs-speech\nemotion: angry\n---\n[@Voice]Hello.',
      references: [{ id: 'voice-1', type: 'audio', title: 'Voice', filePath: fixture, isReady: true, metadata: { voice_id: 'voice-1' } }],
    }
    const current = compileGenerationSubmitSpecV2(buildModelRequestV2(await modelPackage('higgs-speech'), input), project)
    expect(current).toMatchObject({
      provider: 'audio', taskType: 'SPEECH',
      payload: { text: '<|emotion:anger|>Hello.', voice_id: 'voice-1', speed: 1, temperature: 0.7, seed: 0 },
    })
  })
})

describe('validated Comfy v2 execution family', () => {
  it.each([
    ['seedance-video', 'video', '344', 'SaveVideo', 3, '---\nmodel: seedance-video\nseedanceModel: Seedance 2.5\n---\nUse ref.', [
      { id: 'image-1', type: 'image', title: 'ref', filePath: fixture, isReady: true },
      { id: 'video-1', type: 'video', title: 'clip', filePath: fixture, isReady: true },
      { id: 'audio-1', type: 'audio', title: 'sound', filePath: fixture, isReady: true },
    ]],
    ['seedance-flf2v', 'video', '2', 'SaveVideo', 2, '---\nmodel: seedance-flf2v\n---\nTransition.', [
      { id: 'first', type: 'image', title: 'first', filePath: fixture, isReady: true },
      { id: 'last', type: 'image', title: 'last', filePath: fixture, isReady: true },
    ]],
    ['nano-banana-image', 'image', '4', 'SaveImage', 1, '---\nmodel: nano-banana-image\nresolution: 2K\n---\nUse ref.', [
      { id: 'image-1', type: 'image', title: 'ref', filePath: fixture, isReady: true },
    ]],
    ['minimax-h3-video', 'video', '92', 'SaveVideo', 2, '---\nmodel: minimax-h3-video\naspectRatio: 9:16\n---\nUse refs.', [
      { id: 'image-1', type: 'image', title: 'ref', filePath: fixture, isReady: true },
      { id: 'audio-1', type: 'audio', title: 'sound', filePath: fixture, isReady: true },
    ]],
  ])('compiles the validated workflow contract for %s', async (id, nodeType, saverId, saverClass, uploadCount, prompt, references) => {
    const input = { nodeType, prompt, references }
    const current = compileGenerationSubmitSpecV2(buildModelRequestV2(await modelPackage(id), input), project)
    expect(current).toMatchObject({ provider: 'comfy', workflowType: id, expectedOutputKind: nodeType })
    expect(current.prompt[saverId].class_type).toBe(saverClass)
    expect(current.uploads).toHaveLength(uploadCount)
    expect(JSON.stringify(current.prompt)).not.toMatch(/api[_-]?key|authorization|cookie|password|secret|token/i)
  })

  it('preserves alias defaults without alias-specific compiler branches', async () => {
    const input = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-mini-video\n---\nA small motion from node_image.',
      references: [{ id: 'node_image', type: 'image', title: 'Frame', filePath: fixture, isReady: true }],
    }
    const current = compileGenerationSubmitSpecV2(buildModelRequestV2(await modelPackage('seedance-video'), input), project)
    expect(current.prompt['360'].inputs.model).toBe('Seedance 2.0 Mini')
  })

  it('rejects Seedance reference execution before submit when no reference asset exists', async () => {
    const snapshot = await modelPackage('seedance-video')
    const input = { nodeType: 'video', prompt: '---\nmodel: seedance-mini-video\n---\nA small motion.', references: [] }
    expect(() => buildModelRequestV2(snapshot, input)).toThrow(/至少需要一个图片参考资产/)
  })
})
