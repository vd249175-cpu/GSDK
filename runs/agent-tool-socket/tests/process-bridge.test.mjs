import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createPythonAgentBridge, readToolOutcome } from '../../../app/plugins/backend/agent-executor/bridge/process-bridge.mjs'
import { createGraphToolPorts } from '../../../app/plugins/backend/agent-executor/bridge/graph-tool.mjs'

describe('agent process bridge', () => {
  it('rejects a tool without an observation port', () => {
    expect(() => createGraphToolPorts([{ name: 'broken', description: 'broken tool',
      parameters: { type: 'object', properties: {} }, execute: async () => ({ handle: 'h' }) }]))
      .toThrow('execute and observe')
  })

  it('allocates one worker process per thread and reuses it for the next turn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gf-agent-'))
    let spawned = 0
    const children = []
    const spawnWorker = () => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.exitCode = null
      const processId = ++spawned
      child.stdin = new Writable({ write(chunk, _encoding, callback) {
        for (const line of chunk.toString().trim().split('\n')) {
          const message = JSON.parse(line)
          if (message.type === 'init') child.stdout.write(`${JSON.stringify({ type: 'ready', processId })}\n`)
          if (message.type === 'invoke') {
            child.stdout.write(`${JSON.stringify({ type: 'monitor', event: {
              threadId: message.requestId, requestId: message.requestId, phase: 'started',
            } })}\n`)
            child.stdout.write(`${JSON.stringify({ type: 'result', id: message.id, answer: 'ok' })}\n`)
          }
        }
        callback()
      } })
      child.stdin.on('finish', () => { child.exitCode = 0; child.emit('exit', 0) })
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0) }
      children.push(child)
      return child
    }
    const injected = []
    const bridge = createPythonAgentBridge({ sqliteDirectory: root, workerScript: 'unused.py',
      spawnWorker, toolDefinitions: [] })
    bridge.setGraphHooks({ inject: async (nodeId, info) => injected.push({ nodeId, info }),
      projection: async () => ({ nodes: {} }) })
    try {
      const invoke = (threadId, requestId) => bridge.runAgent.execute({ threadId, requestId,
        text: 'hi', prompts: [] })
      const [first, second] = await Promise.all([invoke('one', 'r-1'), invoke('two', 'r-2')])
      expect(first.processId).not.toBe(second.processId)
      expect((await invoke('one', 'r-3')).processId).toBe(first.processId)
      expect(spawned).toBe(2)
      expect(injected.filter(({ nodeId }) => nodeId === 'monitor/session')).toHaveLength(3)
    } finally {
      await bridge.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses stable separate SQLite paths and routes graph tool outcomes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gf-agent-'))
    const calls = []
    const bridge = createPythonAgentBridge({ sqliteDirectory: root, workerScript: 'unused.py', toolDefinitions: [],
      spawnWorker: () => { throw new Error('not needed') } })
    try {
      expect(bridge.sqlitePathFor('one')).not.toBe(bridge.sqlitePathFor('two'))
      expect(bridge.sqlitePathFor('one')).toBe(bridge.sqlitePathFor('one'))
      bridge.setGraphHooks({
        inject: async (nodeId, info) => { calls.push({ nodeId, info }) },
        projection: async () => ({ nodes: {
          'agent/tool-observation-0': { state: { results: { 'call-a': { ok: true } }, errors: {} } },
        } }),
      })
      const result = await bridge.invokeGraphTool({ id: 'call-a', name: 'probe', args: {} }, 'one', 'request-1', 0)
      expect(result).toEqual({ ok: true })
      expect(calls).toEqual([{ nodeId: 'agent/tool-0', info: {
        type: 'AgentGraphToolInfo', threadId: 'one', requestId: 'request-1',
        toolCallId: 'call-a', toolName: 'probe', args: {},
      } }])
      expect(readToolOutcome({ nodes: { 'agent/tool-0': { state: { results: {}, errors: { x: 'bad' } } } } }, 'agent/tool-0', 'x'))
        .toEqual({ error: 'bad' })
    } finally {
      await bridge.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
