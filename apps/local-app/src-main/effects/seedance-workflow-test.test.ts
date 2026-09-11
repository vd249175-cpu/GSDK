import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  resolveGenerationPrompt,
  buildGenerationRequest,
} from '../services/generation-model-store.mjs'
import { compileGenerationSubmitSpecV2 } from '../shared/generation-submit-spec-v2.mjs'

const skillsRoot = fileURLToPath(new URL('../../resources/generation-models', import.meta.url))
const project = { id: 'proj-1', name: 'Test Project' }

// 生成 1 秒 16kHz 单声道 440Hz 标准 PCM WAV 音频
function createSampleWav(durationSeconds = 1): Buffer {
  const sampleRate = 16000
  const numChannels = 1
  const bitsPerSample = 16
  const numSamples = sampleRate * durationSeconds
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28)
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0x7fff
    buffer.writeInt16LE(Math.round(sample), 44 + i * 2)
  }
  return buffer
}

// 最小 1x1 RGBA PNG
const samplePng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

describe('Seedance 多图与音频工作流解析测试', () => {
  const tempDir = join(tmpdir(), `gv-seedance-test-${Date.now()}`)
  const img1Path = join(tempDir, 'ref_image_1.png')
  const img2Path = join(tempDir, 'ref_image_2.png')
  const audioPath = join(tempDir, 'ref_bgm.wav')

  mkdirSync(tempDir, { recursive: true })
  writeFileSync(img1Path, samplePng)
  writeFileSync(img2Path, samplePng)
  writeFileSync(audioPath, createSampleWav(2))

  it('1. Seedance 2.0 Mini 多图解析 (2 张参考图): 正确生成并挂载 Image_1 与 Image_2 节点槽位', async () => {
    const input = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-mini-video\nduration: 5\nresolution: "720p"\n---\n镜头融合 node_img1 与 node_img2。',
      references: [
        { id: 'node_img1', type: 'image', title: '参考图1', ordinal: 1, filePath: img1Path, isReady: true },
        { id: 'node_img2', type: 'image', title: '参考图2', ordinal: 2, filePath: img2Path, isReady: true },
      ],
    }

    const resolved = await resolveGenerationPrompt(skillsRoot, input)
    expect(resolved.model.id).toBe('seedance-video')
    expect(resolved.prompt).toContain('Image_1')
    expect(resolved.prompt).toContain('Image_2')
    expect(resolved.aliases['node_img1']).toBe('Image_1')
    expect(resolved.aliases['node_img2']).toBe('Image_2')

    const request = await buildGenerationRequest(skillsRoot, input)
    expect(request.kind).toBe('comfy-workflow')
    expect(request.workflowType).toBe('seedance-video')
    expect(request.inputs.seedance_model).toBe('Seedance 2.0 Mini')

    // 编译成最终提交至 Comfy 的 Prompt DAG
    const compiled = compileGenerationSubmitSpecV2(request, project)
    expect(compiled.provider).toBe('comfy')
    expect(compiled.prompt['360'].inputs.model).toBe('Seedance 2.0 Mini')
    expect(compiled.uploads).toHaveLength(2)
    expect(compiled.uploads[0]).toMatchObject({ nodeId: '400', inputName: 'image' })
    expect(compiled.uploads[1]).toMatchObject({ nodeId: '401', inputName: 'image' })
    expect(compiled.prompt['400'].class_type).toBe('LoadImage')
    expect(compiled.prompt['401'].class_type).toBe('LoadImage')
    expect(compiled.prompt['360'].inputs['model.reference_images.image_1']).toEqual(['400', 0])
    expect(compiled.prompt['360'].inputs['model.reference_images.image_2']).toEqual(['401', 0])
  })

  it('2. Seedance 多模态解析 (多图 + 音频): 正确解析 Audio_1 并挂载 LoadAudio 槽位', async () => {
    const input = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\nduration: 5\nresolution: "720p"\n---\n随着音乐 node_audio 推进画面 node_img1 与 node_img2。',
      references: [
        { id: 'node_img1', type: 'image', title: '首图', ordinal: 1, filePath: img1Path, isReady: true },
        { id: 'node_img2', type: 'image', title: '尾图', ordinal: 2, filePath: img2Path, isReady: true },
        { id: 'node_audio', type: 'audio', title: '配乐', ordinal: 1, filePath: audioPath, isReady: true, duration: 2 },
      ],
    }

    const resolved = await resolveGenerationPrompt(skillsRoot, input)
    expect(resolved.prompt).toContain('Image_1')
    expect(resolved.prompt).toContain('Image_2')
    expect(resolved.prompt).toContain('Audio_1')
    expect(resolved.aliases['node_audio']).toBe('Audio_1')

    const request = await buildGenerationRequest(skillsRoot, input)
    expect(request.kind).toBe('comfy-workflow')

    // 编译成最终提交至 Comfy 的 Prompt DAG
    const compiled = compileGenerationSubmitSpecV2(request, project)
    expect(compiled.provider).toBe('comfy')
    expect(compiled.uploads).toHaveLength(3)

    // 校验音频槽位挂载
    const audioUpload = compiled.uploads.find((u: any) => u.nodeId === '600')
    expect(audioUpload).toBeDefined()
    expect(audioUpload?.inputName).toBe('audio')
    expect(compiled.prompt['600'].class_type).toBe('LoadAudio')
    expect(compiled.prompt['360'].inputs['model.reference_audios.audio_1']).toEqual(['600', 0])
  })

  it('3. Seedance Mini 约束校验: Mini 模型声明为纯视觉轻量模型，附加音频时触发边界保护', async () => {
    const inputWithAudio = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-mini-video\n---\n镜头推移 node_audio。',
      references: [
        { id: 'node_img1', type: 'image', title: '首图', ordinal: 1, filePath: img1Path, isReady: true },
        { id: 'node_audio', type: 'audio', title: '配乐', ordinal: 1, filePath: audioPath, isReady: true },
      ],
    }

    await expect(buildGenerationRequest(skillsRoot, inputWithAudio)).rejects.toThrow(/最多支持 0 个 audio 引用/)
  })
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })
})


