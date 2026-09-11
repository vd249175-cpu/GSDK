import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { resolveProjectPath } from './project-paths.mjs'

const operationAdapterId = 'graphvideo/generation-adapter-operation-v1'

export function resolveComfyApiKey(environment = process.env, configPath = null, workspaceRoot = null) {
  const current = String(environment.COMFY_API_KEY || '').trim()
  if (current) return current
  const legacy = String(environment.COMFY_CLOUD_API_KEY || '').trim()
  if (legacy) return legacy
  if (configPath && existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8')
      const match = content.match(/api_key\s*=\s*["']([^"']+)["']/)
      if (match && match[1]?.trim()) {
        return match[1].trim()
      }
    } catch {
      // ignore
    }
  }
  if (workspaceRoot) {
    const envPaths = [join(workspaceRoot, '.env'), join(workspaceRoot, '.env.local')]
    for (const envPath of envPaths) {
      if (existsSync(envPath)) {
        try {
          const content = readFileSync(envPath, 'utf8')
          const match = content.match(/^COMFY_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m)
          if (match && match[1]?.trim()) {
            return match[1].trim()
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return ''
}

export function generationOperationTimeoutMs(operation) {
  // submit includes zero or more SDK asset uploads, and download streams one
  // potentially large media asset. Their http clients already enforce
  // per-request inactivity timeouts; an aggregate Electron timer can discard a
  // valid late job handle or completed download while bytes are still moving.
  return operation === 'poll' ? 90_000 : null
}

function resolvePython(adapterRoot, explicitPath) {
  const candidates = [
    explicitPath,
    process.env.GRAPHVIDEO_GENERATION_ADAPTER_PYTHON,
    resolve(adapterRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    resolve(adapterRoot, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

export class GenerationAdapterWorkerHost {
  constructor({
    workspaceRoot,
    getProjectRoot,
    pythonPath,
    configPath,
    comfyApiKey = '',
    spawnProcess = spawn,
  }) {
    this.adapterRoot = resolve(workspaceRoot, 'generation-adapter')
    this.sourceRoot = resolve(this.adapterRoot, 'src')
    this.getProjectRoot = getProjectRoot
    this.pythonPath = resolvePython(this.adapterRoot, pythonPath)
    this.configPath = configPath || (
      existsSync(resolve(this.adapterRoot, 'config.toml'))
        ? resolve(this.adapterRoot, 'config.toml')
        : resolve(this.adapterRoot, 'config.example.toml')
    )
    this.comfyApiKey = comfyApiKey
    this.spawnProcess = spawnProcess
    this.child = null
    this.startPromise = null
    this.stdoutBuffer = ''
    this.stderrTail = ''
    this.requestSequence = 0
    this.pending = new Map()

    this.operationAdapter = Object.freeze({
      id: operationAdapterId,
      execute: (request, context) => this.executeOperation(request, context),
    })
  }

  async executeOperation(request, context) {
    if (!this.child) throw new Error('生成 adapter 进程尚未启动')
    context?.recordTransport?.({
      portId: 'electron-main/generation-adapter-worker',
      operation: request.operation,
      provider: request.operation === 'submit' ? request.spec.provider : request.artifact?.provider || request.handle?.provider,
    })

    let payload
    if (request.operation === 'submit') {
      const spec = request.spec
      const uploads = spec.provider === 'comfy' && spec.uploads?.length
        ? spec.uploads.map((upload) => {
            const projectRoot = this.getProjectRoot()
            if (!projectRoot) throw new Error('生成引用上传需要已打开项目')
            return { ...upload, sourcePath: resolveProjectPath(projectRoot, upload.sourcePath) }
          })
        : undefined
      payload = {
        provider: spec.provider,
        request: spec.provider === 'comfy'
          ? {
              prompt: spec.prompt,
              expectedOutputKind: spec.expectedOutputKind,
              ...(spec.clientId ? { clientId: spec.clientId } : {}),
              ...(spec.workflowType ? { workflowType: spec.workflowType } : {}),
              ...(uploads ? { uploads } : {}),
            }
          : spec.provider === 'audio' ? {
              taskType: spec.taskType,
              projectId: spec.projectId,
              ...(spec.projectName ? { projectName: spec.projectName } : {}),
              ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
              payload: spec.payload,
            } : { kind: spec.kind },
      }
    } else if (request.operation === 'poll') {
      payload = { provider: request.handle.provider, handle: request.handle }
    } else if (request.operation === 'download') {
      const projectRoot = this.getProjectRoot()
      if (!projectRoot) throw new Error('生成产物下载需要已打开项目')
      const destination = resolveProjectPath(projectRoot, request.destinationRelativePath)
      payload = {
        provider: request.artifact.provider,
        download: { artifact: request.artifact, destination },
      }
    } else {
      throw new Error(`生成 adapter 物理操作不支持: ${request.operation}`)
    }

    const observation = await this.send(request.operation, payload, {
      signal: context?.signal,
      timeoutMs: generationOperationTimeoutMs(request.operation),
    })
    context?.recordRawSummary?.({
      kind: `generation-adapter-${request.operation}`,
      text: `status=${observation.status};provider=${payload.provider}`,
      redacted: true,
    })
    if (request.operation === 'submit') {
      return { operation: 'submit', status: observation.status, handle: observation.handle }
    }
    if (request.operation === 'poll') {
      return { operation: 'poll', ...observation }
    }
    return {
      operation: 'download',
      status: observation.status,
      bytesWritten: observation.bytesWritten,
      destinationRelativePath: request.destinationRelativePath,
      contentType: observation.contentType || '',
    }
  }

  async start() {
    if (this.child) return this.health()
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startProcess()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async startProcess() {
    if (!existsSync(this.sourceRoot)) throw new Error(`生成 adapter 源码目录不存在: ${this.sourceRoot}`)
    if (!existsSync(this.configPath)) throw new Error(`生成 adapter 配置不存在: ${this.configPath}`)

    const existingPythonPath = process.env.PYTHONPATH
    const child = this.spawnProcess(
      this.pythonPath,
      ['-m', 'generation_adapter', 'worker', '--config', this.configPath],
      {
        cwd: this.adapterRoot,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(this.comfyApiKey ? { COMFY_API_KEY: this.comfyApiKey } : {}),
          PYTHONIOENCODING: 'utf-8',
          PYTHONPATH: existingPythonPath
            ? `${this.sourceRoot}${delimiter}${existingPythonPath}`
            : this.sourceRoot,
        },
      },
    )
    this.child = child
    this.stdoutBuffer = ''
    this.stderrTail = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.consumeStdout(chunk))
    child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4000)
    })
    child.once('error', (error) => this.handleExit(error))
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        const detail = this.stderrTail.trim()
        this.handleExit(new Error(
          `生成 adapter 进程退出 (code=${code}, signal=${signal})${detail ? `: ${detail}` : ''}`,
        ))
      }
    })
    return this.health()
  }

  async health(signal) {
    if (!this.child) throw new Error('生成 adapter 进程尚未启动')
    const observation = await this.send('health', {}, { signal, timeoutMs: 10_000 })
    return {
      status: observation.status === 'degraded' ? 'degraded' : 'ready',
      protocolVersion: Number(observation.protocolVersion || 0),
      providers: Array.isArray(observation.providers) ? observation.providers : [],
      ...(observation.providerStatus && typeof observation.providerStatus === 'object'
        ? { providerStatus: observation.providerStatus }
        : {}),
      ...(observation.unavailableProviders && typeof observation.unavailableProviders === 'object'
        ? { unavailableProviders: observation.unavailableProviders }
        : {}),
    }
  }

  async stop() {
    const child = this.child
    if (!child) return
    try {
      await this.send('shutdown', {}, { timeoutMs: 5_000 })
    } catch {}
    if (this.child !== child) return
    await new Promise((resolveStop) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolveStop()
      }
      child.once('exit', finish)
      const timer = setTimeout(() => {
        if (this.child === child) child.kill()
        finish()
      }, 5_000)
      timer.unref?.()
    })
  }

  send(operation, payload, { signal, timeoutMs = 60_000 } = {}) {
    const child = this.child
    if (!child?.stdin?.writable) return Promise.reject(new Error('生成 adapter 进程不可写'))
    const requestId = `adapter-${++this.requestSequence}`
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(requestId)
            rejectRequest(new Error(`生成 adapter ${operation} 超时`))
          }, timeoutMs)
        : null
      timer?.unref?.()
      const onAbort = () => {
        if (timer) clearTimeout(timer)
        this.pending.delete(requestId)
        rejectRequest(signal.reason || new Error(`生成 adapter ${operation} 已取消`))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(requestId, {
        resolve: (value) => {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolveRequest(value)
        },
        reject: (error) => {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          rejectRequest(error)
        },
      })
      child.stdin.write(`${JSON.stringify({ requestId, operation, payload })}\n`, (error) => {
        if (!error) return
        const pending = this.pending.get(requestId)
        this.pending.delete(requestId)
        pending?.reject(error)
      })
    })
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += chunk
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let response
      try {
        response = JSON.parse(line)
      } catch {
        continue
      }
      const pending = this.pending.get(response.requestId)
      if (!pending) continue
      this.pending.delete(response.requestId)
      if (response.ok) pending.resolve(response.observation)
      else pending.reject(new Error(response.error?.message || '生成 adapter 操作失败'))
    }
  }

  handleExit(error) {
    this.child = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export function createGenerationAdapterWorker(options) {
  return new GenerationAdapterWorkerHost(options)
}
