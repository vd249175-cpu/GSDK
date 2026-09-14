import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function agentControlDiscoveryPath() {
  return join(homedir(), '.graphvideo', 'agent-control.json')
}

async function readJsonBody(request) {
  let bytes = 0
  const chunks = []
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new Error('Agent request exceeds 1 MiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export async function startAgentControlServer(host, { discoveryPath = agentControlDiscoveryPath() } = {}) {
  const token = randomBytes(32).toString('hex')
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (request.method !== 'POST' || request.headers.origin || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403)
      response.end(JSON.stringify({ error: 'Agent control access denied' }))
      return
    }
    try {
      const input = await readJsonBody(request)
      let output
      switch (new URL(request.url, 'http://127.0.0.1').pathname) {
        case '/inspect':
          output = host.agentInspect(input)
          break
        case '/analyze':
          output = host.agentAnalyze(input)
          break
        case '/inject':
          output = await host.agentInject(input.targetNodeId, input.info, {
            actor: 'codex/local', reason: input.reason,
          })
          break
        case '/state/patch':
          output = await host.agentInterveneState(input.nodeId, input.patch, {
            actor: 'codex/local', reason: input.reason,
            expectedGeneration: input.expectedGeneration,
            expectedVersion: input.expectedVersion,
          })
          break
        default:
          response.writeHead(404)
          response.end(JSON.stringify({ error: 'Unknown Agent control method' }))
          return
      }
      response.writeHead(200)
      response.end(JSON.stringify(output))
    } catch (error) {
      response.writeHead(400)
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Agent control listener has no TCP address')
  await mkdir(dirname(discoveryPath), { recursive: true })
  try {
    await writeFile(discoveryPath, JSON.stringify({ port: address.port, token, pid: process.pid }), { mode: 0o600 })
  } catch (error) {
    server.close()
    throw error
  }
  return {
    port: address.port,
    async close() {
      rmSync(discoveryPath, { force: true })
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
