import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

export function createUfoComputerBridge({
  pythonExecutable,
  workerScript = resolve(fileURLToPath(new URL('.', import.meta.url)), 'ufo-computer-worker.py'),
  ufoDirectory,
  screenshotsDirectory,
  spawnProcess = spawn,
  requestTimeoutMs = 30_000,
} = {}) {
  if (!pythonExecutable) throw new Error('UFO computer bridge requires pythonExecutable')
  if (!workerScript) throw new Error('UFO computer bridge requires workerScript')
  if (!ufoDirectory) throw new Error('UFO computer bridge requires ufoDirectory')
  if (!screenshotsDirectory) throw new Error('UFO computer bridge requires screenshotsDirectory')

  let child = null
  let lines = null
  let nextId = 1
  let pending = new Map()
  let stderr = ''
  let starting = null
  let queue = Promise.resolve()

  const rejectPending = (error) => {
    for (const entry of pending.values()) entry.reject(error)
    pending = new Map()
  }

  const start = async () => {
    if (child) return
    if (starting) return starting
    starting = (async () => {
      await access(pythonExecutable, fsConstants.X_OK)
      await access(workerScript, fsConstants.R_OK)
      await access(resolve(ufoDirectory, 'ufo', 'automator', 'puppeteer.py'), fsConstants.R_OK)
      await mkdir(screenshotsDirectory, { recursive: true })

      const spawned = spawnProcess(
        pythonExecutable,
        ['-u', workerScript, '--screenshots', screenshotsDirectory],
        {
          cwd: ufoDirectory,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONPATH: [ufoDirectory, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
          },
        },
      )
      child = spawned
      stderr = ''
      const ready = new Promise((resolveReady, rejectReady) => {
        const timeout = setTimeout(() => rejectReady(new Error('UFO computer worker did not become ready')), requestTimeoutMs)
        const fail = (error) => {
          clearTimeout(timeout)
          rejectReady(error)
        }
        spawned.once('error', fail)
        spawned.once('exit', (code) => fail(new Error(`UFO computer worker exited (${code}): ${stderr.trim()}`)))
        lines = createInterface({ input: spawned.stdout })
        lines.once('line', (line) => {
          clearTimeout(timeout)
          try {
            const message = JSON.parse(line)
            if (message.type !== 'ready') throw new Error(message.error ?? 'unexpected UFO worker handshake')
            resolveReady()
          } catch (error) {
            rejectReady(error)
          }
        })
      })
      spawned.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000) })
      spawned.once('exit', (code) => {
        if (child === spawned) child = null
        rejectPending(new Error(`UFO computer worker exited (${code}): ${stderr.trim()}`))
      })
      await ready
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line)
          const entry = pending.get(message.id)
          if (!entry) return
          pending.delete(message.id)
          clearTimeout(entry.timeout)
          if (message.ok) entry.resolve(message.result)
          else entry.reject(new Error(message.error ?? 'UFO computer worker failed'))
        } catch (error) {
          rejectPending(error)
        }
      })
    })()
    try {
      await starting
    } finally {
      starting = null
    }
  }

  const callRaw = async (message) => {
    await start()
    const id = nextId++
    return new Promise((resolveCall, rejectCall) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`UFO computer worker request timed out: ${message.op}`))
      }, requestTimeoutMs)
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timeout })
      child.stdin.write(`${JSON.stringify({ id, ...message })}\n`, (error) => {
        if (!error) return
        clearTimeout(timeout)
        pending.delete(id)
        rejectCall(error)
      })
    })
  }

  const call = (message) => {
    const operation = queue.then(() => callRaw(message))
    queue = operation.catch(() => undefined)
    return operation
  }

  const stop = async () => {
    if (!child) return
    const stopping = child
    child = null
    const closed = new Promise((resolveClose) => stopping.once('close', resolveClose))
    stopping.stdin.end()
    const outcome = await Promise.race([closed.then(() => 'closed'), delay(3_000).then(() => 'timeout')])
    if (outcome === 'timeout') {
      stopping.kill()
      await Promise.race([closed, delay(1_000)])
    }
    lines?.close()
    lines = null
    rejectPending(new Error('UFO computer worker stopped'))
  }

  return {
    executionAdapter: {
      id: 'ufo/computer-execution',
      execute: async (request) => {
        if (!request?.requestId || !request?.action) throw new Error('UFO execution request requires requestId and action')
        return call({ op: 'execute', requestId: request.requestId, action: request.action })
      },
    },
    observationAdapter: {
      id: 'ufo/computer-observation',
      execute: async (request) => {
        if (!request?.requestId) throw new Error('UFO observation request requires requestId')
        return call({ op: 'observe', requestId: request.requestId, observation: request.observation ?? {} })
      },
    },
    stop,
  }
}
