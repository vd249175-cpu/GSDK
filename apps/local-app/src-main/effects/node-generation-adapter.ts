import { createWriteStream, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import type { EffectAdapter, EffectContext } from '@graphvideo/kernel'
import {
  generationAdapterOperationId,
  type GenerationAdapterArtifact,
  type GenerationAdapterHandle,
  type GenerationAdapterOperationObservation,
  type GenerationAdapterOperationRequest,
  type GenerationAdapterSubmitSpec,
  type GenerationProviderId,
} from '../studio/effects/generation-adapter-operation'

export interface NodeGenerationAdapterOptions {
  getProjectRoot?: () => string | null
  comfyApiKey?: string
  comfyBaseUrl?: string
  audioBaseUrl?: string
}

interface MockTaskRecord {
  kind: 'image' | 'video'
}

/**
 * 纯 Node 原生流式生成与下载适配器：
 * 1. 彻底移除 Python 依赖，全栈运行于 Node/TypeScript 运行时；
 * 2. 直连 OS 底层网络 Socket，不经过 Chromium 浏览器沙箱，杜绝同域名 6 并发限制与磁盘缓存排他锁；
 * 3. 采用 Node pipeline 流式写盘，自动释放文件句柄，杜绝文件锁死。
 */
export class NodeGenerationAdapter implements EffectAdapter<
  GenerationAdapterOperationRequest,
  GenerationAdapterOperationObservation
> {
  readonly id = generationAdapterOperationId
  private readonly getProjectRoot: () => string | null
  private readonly comfyApiKey: string
  private readonly comfyBaseUrl: string
  private readonly audioBaseUrl: string
  private readonly mockTasks = new Map<string, MockTaskRecord>()

  constructor(options: NodeGenerationAdapterOptions = {}) {
    this.getProjectRoot = options.getProjectRoot ?? (() => null)
    this.comfyApiKey = (options.comfyApiKey ?? process.env.COMFY_API_KEY ?? process.env.COMFY_CLOUD_API_KEY ?? '').trim()
    this.comfyBaseUrl = (options.comfyBaseUrl ?? process.env.COMFY_BASE_URL ?? 'https://cloud.comfy.org').replace(/\/+$/, '')
    this.audioBaseUrl = (options.audioBaseUrl ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
  }

  private getEffectiveApiKey(): string {
    if (this.comfyApiKey && this.comfyApiKey.trim()) return this.comfyApiKey.trim()
    const envKey = process.env.COMFY_API_KEY || process.env.COMFY_CLOUD_API_KEY
    if (envKey && envKey.trim()) return envKey.trim()
    return ''
  }

  async execute(
    request: GenerationAdapterOperationRequest,
    context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    if (request.operation === 'submit') {
      return this.handleSubmit(request.spec, context)
    } else if (request.operation === 'poll') {
      return this.handlePoll(request.handle, context)
    } else if (request.operation === 'download') {
      return this.handleDownload(request.artifact, request.destinationRelativePath, context)
    }
    throw new Error(`不支持的生成操作: ${(request as any).operation}`)
  }

  private async handleSubmit(
    spec: GenerationAdapterSubmitSpec,
    context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    if (spec.provider === 'mock') {
      const taskId = `mock-${randomUUID()}`
      this.mockTasks.set(taskId, { kind: spec.kind })
      return {
        operation: 'submit',
        status: 'submitted',
        handle: {
          provider: 'mock',
          taskId,
          resultKind: 'memory',
        },
      }
    }

    if (spec.provider === 'comfy') {
      const apiKey = this.getEffectiveApiKey()
      if (!apiKey) {
        throw new Error('未配置 COMFY_API_KEY，无法向 Comfy Cloud 发起真实生成')
      }
      const response = await fetch(`${this.comfyBaseUrl}/api/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: spec.prompt,
          client_id: spec.clientId || `gv-client-${randomUUID()}`,
          extra_data: {
            api_key_comfy_org: apiKey,
            workflow_type: spec.workflowType,
            ...(spec.extraData || {}),
          },
        }),
        signal: context.signal,
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`Comfy Cloud 提交失败: ${response.status} ${errorText}`)
      }
      const data = (await response.json()) as { prompt_id?: string }
      const taskId = data.prompt_id || `comfy-${randomUUID()}`
      return {
        operation: 'submit',
        status: 'submitted',
        handle: {
          provider: 'comfy',
          taskId,
          apiMode: 'cloud',
        },
      }
    }

    if (spec.provider === 'audio') {
      const baseUrl = spec.baseUrl || this.audioBaseUrl
      const response = await fetch(`${baseUrl}/audio/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_type: spec.taskType,
          project_id: spec.projectId,
          payload: spec.payload,
        }),
        signal: context.signal,
      })
      if (!response.ok) {
        const err = await response.text().catch(() => '')
        throw new Error(`Audio Gateway 提交失败: ${response.status} ${err}`)
      }
      const data = (await response.json()) as { task_id?: string }
      return {
        operation: 'submit',
        status: 'submitted',
        handle: {
          provider: 'audio',
          taskId: data.task_id || `audio-${randomUUID()}`,
        },
      }
    }

    throw new Error(`未知生成 Provider: ${(spec as any).provider}`)
  }

  private async handlePoll(
    handle: GenerationAdapterHandle,
    context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    if (handle.provider === 'mock') {
      const record = this.mockTasks.get(handle.taskId)
      if (!record) {
        return {
          operation: 'poll',
          status: 'failed',
          progress: 0,
          error: `Mock 任务未找到: ${handle.taskId}`,
        }
      }
      const ext = record.kind === 'image' ? 'png' : 'mp4'
      return {
        operation: 'poll',
        status: 'ready',
        progress: 100,
        artifact: {
          provider: 'mock',
          taskId: handle.taskId,
          kind: record.kind,
          filename: `${handle.taskId}.${ext}`,
          token: handle.taskId,
        },
      }
    }

    if (handle.provider === 'comfy') {
      const apiKey = this.getEffectiveApiKey()
      const headers = {
        ...(apiKey ? { 'X-API-Key': apiKey, Authorization: `Bearer ${apiKey}` } : {}),
      }
      let outputs: Record<string, any> = {}

      // 1. 优先查询 Comfy Cloud 官方 /api/jobs/{taskId}
      try {
        const jobRes = await fetch(`${this.comfyBaseUrl}/api/jobs/${handle.taskId}`, {
          headers,
          signal: context.signal,
        })
        if (jobRes.ok) {
          const job = (await jobRes.json()) as any
          if (job?.status && ['error', 'non_retryable_error', 'lost', 'cancelled', 'failed'].includes(job.status)) {
            return {
              operation: 'poll',
              status: 'failed',
              progress: 0,
              error: job.execution_error?.exception_message || job.error || `Comfy Cloud 执行失败 (${job.status})`,
            }
          }
          if (job?.outputs && Object.keys(job.outputs).length > 0) {
            outputs = job.outputs
          } else if (job?.output && Object.keys(job.output).length > 0) {
            outputs = job.output
          }
        }
      } catch {
        // 忽略网络瞬态，回退至 history
      }

      // 2. 备选轮询 /api/history/{taskId}
      if (Object.keys(outputs).length === 0) {
        const response = await fetch(`${this.comfyBaseUrl}/api/history/${handle.taskId}`, {
          headers,
          signal: context.signal,
        })
        if (response.ok) {
          const history = (await response.json()) as Record<string, any>
          const promptHistory = history[handle.taskId] || history
          if (promptHistory?.outputs && Object.keys(promptHistory.outputs).length > 0) {
            outputs = promptHistory.outputs
          }
        }
      }

      let foundFile: { filename: string; subfolder?: string; type?: string } | null = null
      for (const nodeOutput of Object.values(outputs)) {
        const files = (nodeOutput as any)?.images || (nodeOutput as any)?.videos || (nodeOutput as any)?.gifs
        if (Array.isArray(files) && files.length > 0) {
          foundFile = files[0]
          break
        }
      }
      if (foundFile) {
        const ext = foundFile.filename.split('.').pop()?.toLowerCase() || 'png'
        const isVideo = ext === 'mp4' || ext === 'webm'
        return {
          operation: 'poll',
          status: 'ready',
          progress: 100,
          artifact: {
            provider: 'comfy',
            taskId: handle.taskId,
            kind: isVideo ? 'video' : 'image',
            filename: foundFile.filename,
            url: `${this.comfyBaseUrl}/api/view?filename=${encodeURIComponent(foundFile.filename)}&subfolder=${encodeURIComponent(foundFile.subfolder || '')}&type=${encodeURIComponent(foundFile.type || 'output')}`,
          },
        }
      }
      return {
        operation: 'poll',
        status: 'pending',
        progress: 50,
        remoteStatus: 'executing',
      }
    }

    return {
      operation: 'poll',
      status: 'failed',
      progress: 0,
      error: `暂不支持 Provider ${handle.provider} 的轮询`,
    }
  }

  private async handleDownload(
    artifact: GenerationAdapterArtifact,
    destinationRelativePath: string,
    context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    const projectRoot = this.getProjectRoot()
    const targetPath = projectRoot
      ? resolveSafeProjectPath(projectRoot, destinationRelativePath)
      : resolve(destinationRelativePath)

    const targetDir = dirname(targetPath)
    mkdirSync(targetDir, { recursive: true })

    const tempPath = `${targetPath}.tmp-${randomUUID()}`

    try {
      if (artifact.provider === 'mock') {
        const content = artifact.kind === 'video'
          ? Buffer.from('FAKE_VIDEO_BINARY_STREAM_OUTPUT')
          : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG magic bytes
        writeFileSync(tempPath, content)
        renameSync(tempPath, targetPath)
        return {
          operation: 'download',
          status: 'downloaded',
          bytesWritten: content.length,
          destinationRelativePath,
          contentType: artifact.kind === 'video' ? 'video/mp4' : 'image/png',
        }
      }

      if (!artifact.url) {
        throw new Error('下载产物缺少 remote URL')
      }

      const apiKey = this.getEffectiveApiKey()
      const response = await fetch(artifact.url, {
        headers: apiKey ? {
          'X-API-Key': apiKey,
          Authorization: `Bearer ${apiKey}`,
        } : {},
        signal: context.signal,
        cache: 'no-store', // 杜绝 Chromium 磁盘缓存锁
      })

      if (!response.ok || !response.body) {
        throw new Error(`下载失败: ${response.status} ${response.statusText}`)
      }

      const fileStream = createWriteStream(tempPath)
      const nodeStream = Readable.fromWeb(response.body as any)

      let bytes = 0
      nodeStream.on('data', (chunk) => {
        bytes += chunk.length
      })

      await pipeline(nodeStream, fileStream)
      renameSync(tempPath, targetPath)

      return {
        operation: 'download',
        status: 'downloaded',
        bytesWritten: bytes,
        destinationRelativePath,
        contentType: response.headers.get('content-type') || 'application/octet-stream',
      }
    } catch (error) {
      try {
        unlinkSync(tempPath)
      } catch {
        // ignore
      }
      throw error
    }
  }
}

function resolveSafeProjectPath(projectRoot: string, candidate: string): string {
  const root = resolve(projectRoot)
  const target = resolve(root, candidate)
  const nested = target.slice(root.length)
  if (!target.startsWith(root) || (nested.length > 0 && !nested.startsWith(sep))) {
    throw new Error('目标路径超出项目安全边界')
  }
  return target
}
