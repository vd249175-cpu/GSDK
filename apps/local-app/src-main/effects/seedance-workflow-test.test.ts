import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  resolveGenerationPrompt,
  buildGenerationRequest,
} from '../services/generation-model-store.mjs'
import { compileGenerationSubmitSpecV2 } from '../shared/generation-submit-spec-v2.mjs'
import { NodeGenerationAdapter } from './node-generation-adapter'

const skillsRoot = fileURLToPath(new URL('../../resources/generation-models', import.meta.url))
const project = { id: 'proj-1', name: 'Test Project' }

function resolveApiKey(): string {
  if (process.env.COMFY_API_KEY) return process.env.COMFY_API_KEY
  for (const envPath of [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'apps/local-app/.env'),
    join(__dirname, '../../.env'),
  ]) {
    if (existsSync(envPath)) {
      const match = readFileSync(envPath, 'utf8').match(/^COMFY_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m)
      if (match?.[1]) return match[1].trim()
    }
  }
  return ''
}

const API_KEY = resolveApiKey()

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

  it('4. Comfy Cloud 真实文件上传通道测试: /api/upload/image 验证', async () => {
    expect(API_KEY, '未配置 COMFY_API_KEY，跳过云端通信').toBeTruthy()

    // 尝试向 Comfy Cloud 上传测试图片与测试音频
    const baseUrl = 'https://cloud.comfy.org'

    // 4.1 测试图片上传
    const imgFormData = new FormData()
    imgFormData.append('image', new Blob([new Uint8Array(samplePng)], { type: 'image/png' }), 'unit_test_probe.png')
    imgFormData.append('overwrite', 'true')

    const imgUploadRes = await fetch(`${baseUrl}/api/upload/image`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        Authorization: `Bearer ${API_KEY}`,
      },
      body: imgFormData,
    })

    console.log('Comfy Cloud 图片上传状态码:', imgUploadRes.status)
    const imgUploadText = await imgUploadRes.text()
    console.log('Comfy Cloud 图片上传返回内容:', imgUploadText)
    expect([200, 201]).toContain(imgUploadRes.status)

    // 4.2 测试音频上传
    const wavBuffer = createSampleWav(1)
    const audioFormData = new FormData()
    audioFormData.append('image', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'unit_test_probe.wav')
    audioFormData.append('overwrite', 'true')

    const audioUploadRes = await fetch(`${baseUrl}/api/upload/image`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        Authorization: `Bearer ${API_KEY}`,
      },
      body: audioFormData,
    })

    console.log('Comfy Cloud 音频上传状态码:', audioUploadRes.status)
    const audioUploadText = await audioUploadRes.text()
    console.log('Comfy Cloud 音频上传返回内容:', audioUploadText)
    expect([200, 201]).toContain(audioUploadRes.status)
  })

  it('5. NodeGenerationAdapter 真实端到端自动上传与作业提交', async () => {
    expect(API_KEY, '未配置 COMFY_API_KEY，跳过云端通信').toBeTruthy()

    const adapter = new NodeGenerationAdapter({
      getProjectRoot: () => tempDir,
      comfyApiKey: API_KEY,
      comfyBaseUrl: 'https://cloud.comfy.org',
    })

    const context = {
      signal: new AbortController().signal,
      clock: { now: () => Date.now(), monotonicNow: () => Date.now() },
    }

    // 构造带 LoadImage 待上传槽位的工作流
    const promptWithUpload = {
      '10': {
        class_type: 'LoadImage',
        inputs: { image: '' },
      },
      '4': {
        class_type: 'SaveImage',
        inputs: {
          filename_prefix: 'test/upload_probe',
          images: ['10', 0],
        },
      },
    }

    const obs = await adapter.execute({
      operation: 'submit',
      spec: {
        provider: 'comfy',
        prompt: promptWithUpload,
        uploads: [
          { sourcePath: img1Path, nodeId: '10', inputName: 'image' },
        ],
        workflowType: 'comfy-image',
        expectedOutputKind: 'image',
      },
    }, context)

    expect(obs.operation).toBe('submit')
    expect(obs.status).toBe('submitted')
    if (obs.status !== 'submitted') throw new Error('Expected submitted')
    expect(obs.handle.taskId).toBeDefined()
    console.log('✅ 经过自动上传并成功提交 Comfy Cloud 作业，Prompt ID:', obs.handle.taskId)

    // 清理测试临时目录
    rmSync(tempDir, { recursive: true, force: true })
  })
})

