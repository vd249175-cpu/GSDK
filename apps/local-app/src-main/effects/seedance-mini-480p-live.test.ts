import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NodeGenerationAdapter } from './node-generation-adapter'
import { resolveGenerationPrompt, buildGenerationRequest } from '../services/generation-model-store.mjs'
import { compileGenerationSubmitSpecV2 } from '../shared/generation-submit-spec-v2.mjs'

const skillsRoot = fileURLToPath(new URL('../../resources/generation-models', import.meta.url))
const sampleMediaDir = fileURLToPath(new URL('../../resources/sample-media', import.meta.url))

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

// 纯 Node 原生生成高质量 256x256 RGBA PNG 测试图像（零外力依赖）
function createTestPng(width: number, height: number, colorFn: (x: number, y: number) => [number, number, number]): Buffer {
  const bytesPerPixel = 4
  const scanlineLength = 1 + width * bytesPerPixel
  const rawData = Buffer.alloc(scanlineLength * height)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength
    rawData[rowOffset] = 0 // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorFn(x, y)
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel
      rawData[pixelOffset] = r
      rawData[pixelOffset + 1] = g
      rawData[pixelOffset + 2] = b
      rawData[pixelOffset + 3] = 255
    }
  }

  const compressed = deflateSync(rawData)

  function chunk(type: string, data: Buffer): Buffer {
    const len = data.length
    const buf = Buffer.alloc(8 + len + 4)
    buf.writeUInt32BE(len, 0)
    buf.write(type, 4)
    data.copy(buf, 8)

    let c = ~0
    const crcTarget = Buffer.concat([Buffer.from(type), data])
    for (let i = 0; i < crcTarget.length; i++) {
      c ^= crcTarget[i]
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
      }
    }
    buf.writeUInt32BE(~c >>> 0, 8 + len)
    return buf
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8
  ihdrData[9] = 6 // RGBA
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe.skip('Seedance 2.0 Mini 480p 双图参考视频生成与端到端实测 (已完全剔除/禁用真实 API 调用)', () => {
  mkdirSync(sampleMediaDir, { recursive: true })

  const img1Path = join(sampleMediaDir, 'seedance_ref_warm.jpg')
  const img2Path = join(sampleMediaDir, 'seedance_ref_cool.jpg')
  const outVideoPath = join(sampleMediaDir, 'seedance_mini_480p.mp4')

  it('1. 验证生图产物: 高清赛博朝霞暖色图 & 荧光海面冷色图', () => {
    expect(existsSync(img1Path)).toBe(true)
    expect(existsSync(img2Path)).toBe(true)
    const img1Bytes = readFileSync(img1Path).length
    const img2Bytes = readFileSync(img2Path).length
    expect(img1Bytes).toBeGreaterThan(100000)
    expect(img2Bytes).toBeGreaterThan(100000)

    console.log('✅ 两张高清 AI 原生参考图已就绪:')
    console.log('   🖼️ 参考图1 (赛博东京朝霞):', img1Path, `(${img1Bytes.toLocaleString()} bytes)`)
    console.log('   🖼️ 参考图2 (荧光碧蓝海面):', img2Path, `(${img2Bytes.toLocaleString()} bytes)`)
  })

  it('2. 编译 Seedance Mini 480p 多图工作流并验证 DAG 拓扑', async () => {
    const input = {
      nodeType: 'video',
      prompt: `---
model: seedance-mini-video
duration: 4
resolution: "480p"
aspectRatio: "16:9"
generateAudio: true
seed: 42
---
镜头从 node_warm 的暖霞色彩平稳推移过渡到 node_cool 的清澈碧蓝，水波流转。`,
      references: [
        { id: 'node_warm', type: 'image', title: '暖色首帧', ordinal: 1, filePath: img1Path, isReady: true },
        { id: 'node_cool', type: 'image', title: '冷色尾帧', ordinal: 2, filePath: img2Path, isReady: true },
      ],
    }

    const resolved = await resolveGenerationPrompt(skillsRoot, input)
    expect(resolved.model.id).toBe('seedance-video')
    expect(resolved.effectiveConfig.resolution).toBe('480p')
    expect(resolved.effectiveConfig.duration).toBe(4)

    const request = await buildGenerationRequest(skillsRoot, input)
    const compiled = compileGenerationSubmitSpecV2(request, { id: 'test-project', name: 'Mini Test' })

    expect(compiled.provider).toBe('comfy')
    expect(compiled.prompt['360'].inputs.model).toBe('Seedance 2.0 Mini')
    expect(compiled.prompt['360'].inputs['model.resolution']).toBe('480p')
    expect(compiled.prompt['360'].inputs['model.duration']).toBe(4)
    expect(compiled.prompt['360'].inputs['model.reference_images.image_1']).toEqual(['400', 0])
    expect(compiled.prompt['360'].inputs['model.reference_images.image_2']).toEqual(['401', 0])
    expect(compiled.uploads).toHaveLength(2)

    console.log('✅ 480p Seedance Mini 工作流拓扑编译校验 100% 吻合！')
  })

  it.skip('3. 向 Comfy Cloud 真实下发 480p Seedance Mini 作业并流式下载最终视频 (已禁用真实 API 调用)', async () => {
    expect(API_KEY, '未配置 COMFY_API_KEY').toBeTruthy()

    const input = {
      nodeType: 'video',
      prompt: `---
model: seedance-mini-video
duration: 4
resolution: "480p"
aspectRatio: "16:9"
generateAudio: true
seed: 42
---
Smooth cinematic transition from warm red sunrise to cool blue ocean.`,
      references: [
        { id: 'node_warm', type: 'image', title: '暖色首帧', ordinal: 1, filePath: img1Path, isReady: true },
        { id: 'node_cool', type: 'image', title: '冷色尾帧', ordinal: 2, filePath: img2Path, isReady: true },
      ],
    }

    const request = await buildGenerationRequest(skillsRoot, input)
    const compiled = compileGenerationSubmitSpecV2(request, { id: 'test-project', name: 'Mini Test' })

    const adapter = new NodeGenerationAdapter({
      getProjectRoot: () => sampleMediaDir,
      comfyApiKey: API_KEY,
      comfyBaseUrl: 'https://cloud.comfy.org',
    })

    const context = {
      signal: new AbortController().signal,
      clock: { now: () => Date.now(), monotonicNow: () => Date.now() },
    }

    // 1. 提交作业（内部自动上传两张参考图至 Comfy Cloud 并填入 prompt）
    console.log('🚀 正在自动上传两张参考图片并向 Comfy Cloud 提交 480p Seedance Mini 作业...')
    const submitObs = await adapter.execute({
      operation: 'submit',
      spec: compiled,
    }, context)

    if (submitObs.status !== 'submitted') throw new Error(`Submit failed: ${JSON.stringify(submitObs)}`)
    const taskId = submitObs.handle.taskId
    console.log('✅ Seedance Mini 480p 作业提交成功！Prompt ID:', taskId)

    // 2. 轮询作业进度直至云端渲染完成
    const startTime = Date.now()
    let pollObs = await adapter.execute({ operation: 'poll', handle: submitObs.handle }, context)

    while (pollObs.status === 'pending' && Date.now() - startTime < 180000) {
      await new Promise((r) => setTimeout(r, 4000))
      pollObs = await adapter.execute({ operation: 'poll', handle: submitObs.handle }, context)
      const elapsedSec = Math.round((Date.now() - startTime) / 1000)
      console.log(`⏳ Seedance Mini 480p 云端渲染中... [${(pollObs as any).remoteStatus || 'executing'}] 已耗时: ${elapsedSec}s`)
    }

    if (pollObs.status !== 'ready') {
      throw new Error(`轮询未就绪: status=${pollObs.status}, error=${(pollObs as any).error}`)
    }

    console.log('🎉 云端 GPU 渲染完毕！产物详情:', pollObs.artifact)

    // 3. 下载视频至本地磁盘
    const dlObs = await adapter.execute({
      operation: 'download',
      artifact: pollObs.artifact,
      destinationRelativePath: 'seedance_mini_480p.mp4',
    }, context)

    expect(dlObs.status).toBe('downloaded')
    expect(existsSync(outVideoPath)).toBe(true)
    const videoBytes = readFileSync(outVideoPath).length
    expect(videoBytes).toBeGreaterThan(50000)

    console.log(`🎬 真实 480p Seedance Mini 视频已成功流式下载落盘！`)
    console.log(`   📁 路径: ${outVideoPath}`)
    console.log(`   📦 大小: ${videoBytes.toLocaleString()} bytes (~${(videoBytes / 1024 / 1024).toFixed(2)} MB)`)
  }, 240000)
})
