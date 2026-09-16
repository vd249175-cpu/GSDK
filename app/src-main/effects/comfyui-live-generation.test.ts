import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { NodeGenerationAdapter } from './node-generation-adapter'

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

describe.skip('ComfyUI Cloud API 真实图像生成单元测试 (已跳过真实 API 调用)', () => {
  it('使用截取的部分工作流节点 (GeminiNanoBanana2V2 + SaveImage) 完整生成一张真实图片并落盘', async () => {
    expect(API_KEY, '请在 .env 中配置 COMFY_API_KEY 后运行测试').toBeTruthy()
    expect(API_KEY.startsWith('comfyui-')).toBe(true)

    const tempDir = join(tmpdir(), `gv-comfy-test-${Date.now()}`)
    const adapter = new NodeGenerationAdapter({
      getProjectRoot: () => tempDir,
      comfyApiKey: API_KEY,
      comfyBaseUrl: 'https://cloud.comfy.org',
    })

    const abortController = new AbortController()
    const context = {
      signal: abortController.signal,
      clock: { now: () => Date.now(), monotonicNow: () => Date.now() },
    }

    // 1. 截取核心生图与保存节点 (Prompt Graph)
    const prompt = {
      '3': {
        class_type: 'GeminiNanoBanana2V2',
        inputs: {
          prompt: 'A tiny green emerald gem crystal floating on water, soft studio lighting, 3d render',
          model: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
          'model.aspect_ratio': '1:1',
          'model.resolution': '1K',
          'model.thinking_level': 'MINIMAL',
          seed: 4242,
          response_modalities: 'IMAGE',
          system_prompt: 'Render high quality visual output.',
          temperature: 1,
          top_p: 0.95,
        },
      },
      '4': {
        class_type: 'SaveImage',
        inputs: {
          filename_prefix: 'test/gem_unit_test',
          images: ['3', 0],
        },
      },
    }

    // 2. 发起提交
    const submitObs = await adapter.execute({
      operation: 'submit',
      spec: {
        provider: 'comfy',
        prompt,
        workflowType: 'comfy-image',
        expectedOutputKind: 'image',
      },
    }, context)

    expect(submitObs.operation).toBe('submit')
    expect(submitObs.status).toBe('submitted')
    if (submitObs.status !== 'submitted') throw new Error('Expected submitted status')
    expect(submitObs.handle).toBeDefined()
    expect(submitObs.handle.taskId).toBeDefined()
    console.log('✅ Comfy Cloud 作业提交成功，Prompt ID:', submitObs.handle.taskId)

    // 3. 轮询作业状态直至完成
    const startTime = Date.now()
    let pollObs = await adapter.execute({
      operation: 'poll',
      handle: submitObs.handle,
    }, context)

    while (pollObs.status === 'pending' && Date.now() - startTime < 60000) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      pollObs = await adapter.execute({
        operation: 'poll',
        handle: submitObs.handle,
      }, context)
      const remoteStatus = (pollObs as any).remoteStatus || 'executing'
      console.log(`⏳ 轮询中... [${remoteStatus}] 耗时: ${Math.round((Date.now() - startTime) / 1000)}s`)
    }

    expect(pollObs.status).toBe('ready')
    if (pollObs.status !== 'ready') throw new Error('Expected ready status')
    expect(pollObs.artifact).toBeDefined()
    expect(pollObs.artifact.url).toBeDefined()
    console.log('✅ Comfy Cloud 渲染完成，产物信息:', pollObs.artifact)

    // 4. 下载真实渲染图片并流式写入目标路径
    const destination = 'media/gem_crystal.png'
    const downloadObs = await adapter.execute({
      operation: 'download',
      artifact: pollObs.artifact,
      destinationRelativePath: destination,
    }, context)

    expect(downloadObs.operation).toBe('download')
    expect(downloadObs.status).toBe('downloaded')
    if (downloadObs.status !== 'downloaded') throw new Error('Expected downloaded status')
    expect(downloadObs.bytesWritten).toBeGreaterThan(1000)

    const savedFile = join(tempDir, destination)
    expect(existsSync(savedFile)).toBe(true)

    // 校验 PNG 魔数头 (89 50 4E 47 0D 0A 1A 0A)
    const header = readFileSync(savedFile).subarray(0, 8)
    expect(header[0]).toBe(0x89)
    expect(header[1]).toBe(0x50) // P
    expect(header[2]).toBe(0x4e) // N
    expect(header[3]).toBe(0x47) // G
    console.log(`🎉 真实图片已成功落盘！文件大小: ${downloadObs.bytesWritten} bytes，路径: ${savedFile}`)

    // 清理临时测试目录
    rmSync(tempDir, { recursive: true, force: true })
  }, 90000)
})
