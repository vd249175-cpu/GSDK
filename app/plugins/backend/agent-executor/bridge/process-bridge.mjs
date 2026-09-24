import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { defaultValueCodec } from '@graphframework/sdk/protocol'

const hash = (value) => [...value].reduce((sum, char) => sum + char.codePointAt(0), 0)
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function readToolOutcome(projection, nodeId, toolCallId) {
  const encoded = projection?.nodes?.[nodeId]?.state
  if (!encoded) return null
  let state
  try { state = defaultValueCodec.decode(encoded) } catch { state = encoded }
  if (Object.hasOwn(state?.errors ?? {}, toolCallId)) return { error: state.errors[toolCallId] }
  if (Object.hasOwn(state?.results ?? {}, toolCallId)) return { result: state.results[toolCallId] }
  return null
}

export function createPythonAgentBridge({
  pythonExecutable = 'python', workerScript, sqliteDirectory, model = 'gpt-4.1-mini',
  baseUrl = null, toolDefinitions = [], graphId = 'agent', monitorId = 'monitor/session',
  toolSeats = 8, spawnWorker = spawn, toolTimeoutMs = 120_000,
} = {}) {
  if (!workerScript || !sqliteDirectory) throw new Error('workerScript and sqliteDirectory are required')
  mkdirSync(sqliteDirectory, { recursive: true })
  const workers = new Map()
  let hooks = null
  let closed = false
  const sqlitePathFor = (threadId) => {
    if (!validId(threadId)) throw new Error('invalid agent thread id')
    return join(sqliteDirectory, `${createHash('sha256').update(threadId).digest('hex')}.sqlite`)
  }
  const send = (worker, message) => worker.child.stdin.write(`${JSON.stringify(message)}\n`)

  async function invokeGraphTool(call, threadId, requestId, seat = hash(call.id) % toolSeats) {
    if (!hooks) throw new Error('graph hooks are not available')
    const nodeId = `${graphId}/tool-${seat}`
    const observationId = `${graphId}/tool-observation-${seat}`
    await hooks.inject(nodeId, { type: 'AgentGraphToolInfo', threadId, requestId,
      toolCallId: call.id, toolName: call.name, args: call.args })
    const deadline = Date.now() + toolTimeoutMs
    for (;;) {
      const outcome = readToolOutcome(await hooks.projection(), observationId, call.id)
      if (outcome) {
        if (outcome.error) throw new Error(outcome.error)
        return outcome.result
      }
      if (Date.now() >= deadline) throw new Error(`graph tool ${call.name} timed out`)
      await delay(25)
    }
  }

  function startWorker(threadId) {
    if (closed) throw new Error('agent bridge is closed')
    const child = spawnWorker(pythonExecutable, [workerScript], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: process.env,
    })
    let readyResolve
    let readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    const worker = { child, ready, readyResolve, readyReject, pending: new Map(), busy: false,
      requestId: null, monitorWrites: new Set(), processId: null }
    workers.set(threadId, worker)
    let failed = false
    const rejectAll = (error) => {
      if (failed) return
      failed = true
      clearTimeout(startupTimer)
      worker.readyReject(error)
      for (const entry of worker.pending.values()) entry.reject(error)
      worker.pending.clear()
      workers.delete(threadId)
      if (child.exitCode === null) child.kill()
    }
    const startupTimer = setTimeout(() => rejectAll(new Error('agent worker did not become ready')), 30_000)
    startupTimer.unref?.()
    child.on('error', (error) => rejectAll(error))
    child.on('exit', (code) => rejectAll(new Error(`agent worker exited (${code})`)))
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message
      try { message = JSON.parse(line) } catch { rejectAll(new Error('invalid agent worker response')); return }
      if (message.type === 'ready') {
        clearTimeout(startupTimer)
        worker.processId = message.processId
        worker.readyResolve(worker)
      } else if (message.type === 'monitor') {
        const write = Promise.resolve().then(() => {
          if (!hooks) throw new Error('graph hooks are not available')
          return hooks.inject(monitorId, { type: 'AgentMonitorInfo', ...message.event })
        })
        worker.monitorWrites.add(write)
        void write.finally(() => worker.monitorWrites.delete(write)).catch(() => undefined)
      } else if (message.type === 'tool_call') {
        void invokeGraphTool(message, threadId, worker.requestId)
          .then((result) => send(worker, { type: 'tool_result', id: message.id, result }))
          .catch((error) => send(worker, { type: 'tool_result', id: message.id, error: error.message }))
      } else if (message.type === 'result' || message.type === 'error') {
        if (message.id == null) { rejectAll(new Error(message.message)); return }
        const entry = worker.pending.get(message.id)
        if (!entry) return
        worker.pending.delete(message.id)
        void Promise.all([...worker.monitorWrites]).then(() => {
          if (message.type === 'error') entry.reject(new Error(message.message))
          else entry.resolve({ answer: message.answer, processId: worker.processId })
        }, entry.reject).finally(() => { worker.busy = false; worker.requestId = null })
      }
    })
    send(worker, { type: 'init', threadId, sqlitePath: sqlitePathFor(threadId),
      tools: toolDefinitions, model, baseUrl })
    return worker
  }

  const runAgent = { id: 'agent/run', async execute(request) {
    if (!validId(request?.threadId) || !validId(request?.requestId)) throw new Error('invalid agent request')
    if (!hooks) throw new Error('graph hooks are not available')
    const worker = workers.get(request.threadId) ?? startWorker(request.threadId)
    await worker.ready
    if (worker.busy) throw new Error(`agent thread ${request.threadId} is already running`)
    worker.busy = true
    worker.requestId = request.requestId
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      worker.pending.set(id, { resolve, reject })
      send(worker, { type: 'invoke', id, requestId: request.requestId,
        text: request.text, attachments: request.attachments, prompts: request.prompts })
    })
  } }

  return { runAgent, sqlitePathFor, invokeGraphTool,
    setGraphHooks(value) { hooks = value },
    async dispose() {
      closed = true
      const children = [...workers.values()].map((worker) => worker.child)
      for (const child of children) child.stdin.end()
      await Promise.all(children.map((child) => new Promise((resolve) => {
        if (child.exitCode !== null) { resolve(); return }
        const timer = setTimeout(() => { child.kill(); resolve() }, 3000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })))
      workers.clear()
    },
  }
}
