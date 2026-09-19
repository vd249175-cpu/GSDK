import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startAgentControlServer } from './agent-control.mjs'

const execFileAsync = promisify(execFile)

describe('Agent control transport', () => {
  it('requires the local token and routes inspect, inject and State patch to the trusted host', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'graphframework-agent-control-'))
    const discoveryPath = join(directory, 'control.json')
    const host = {
      agentInspect: vi.fn(() => ({ projection: { revision: 1 } })),
      agentAnalyze: vi.fn(() => ({ id: 'fold-depth:0', nodes: { 'fold:world': {} } })),
      agentInject: vi.fn(async () => ({ feedback: { status: 'enqueued' } })),
      agentInterveneState: vi.fn(async () => ({ version: 2 })),
    }
    const control = await startAgentControlServer(host, { discoveryPath })
    try {
      const { port, token } = JSON.parse(await readFile(discoveryPath, 'utf8'))
      const call = (path, input, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers },
        body: JSON.stringify(input),
      })
      expect((await fetch(`http://127.0.0.1:${port}/inspect`, { method: 'POST' })).status).toBe(403)
      expect((await call('/inspect', {}, { Origin: 'http://example.test' })).status).toBe(403)
      expect((await (await call('/inspect', { after: 3 })).json()).projection.revision).toBe(1)
      expect(host.agentInspect).toHaveBeenCalledWith({ after: 3 })
      const cliPath = fileURLToPath(new URL('../../scripts/agent-control.mjs', import.meta.url))
      const { stdout } = await execFileAsync(process.execPath, [cliPath, 'inspect'], {
        env: { ...process.env, GRAPHFRAMEWORK_AGENT_CONTROL_FILE: discoveryPath },
      })
      expect(JSON.parse(stdout).projection.revision).toBe(1)
      expect((await (await call('/analyze', { op: 'view', foldDepth: 0 })).json()).id).toBe('fold-depth:0')
      expect(host.agentAnalyze).toHaveBeenCalledWith({ op: 'view', foldDepth: 0 })
      const analysisRequestPath = join(directory, 'analysis-request.json')
      await writeFile(analysisRequestPath, JSON.stringify({ op: 'view', foldDepth: 0 }))
      const analyzed = await execFileAsync(process.execPath, [cliPath, 'analyze', analysisRequestPath], {
        env: { ...process.env, GRAPHFRAMEWORK_AGENT_CONTROL_FILE: discoveryPath },
      })
      expect(JSON.parse(analyzed.stdout).nodes['fold:world']).toEqual({})
      expect((await (await call('/inject', {
        targetNodeId: 'owner', info: { type: 'ProbeInfo' }, reason: 'diagnose',
      })).json()).feedback.status).toBe('enqueued')
      expect(host.agentInject).toHaveBeenCalledWith('owner', { type: 'ProbeInfo' }, {
        actor: 'codex/local', reason: 'diagnose',
      })
      expect((await (await call('/state/patch', {
        nodeId: 'owner', patch: { count: 2 }, reason: 'repair',
        expectedGeneration: 0, expectedVersion: 1,
      })).json()).version).toBe(2)
      expect(host.agentInterveneState).toHaveBeenCalledWith('owner', { count: 2 }, {
        actor: 'codex/local', reason: 'repair', expectedGeneration: 0, expectedVersion: 1,
      })
    } finally {
      await control.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
