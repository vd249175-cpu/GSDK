import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const command = process.argv[2]
const route = { inspect: '/inspect', analyze: '/analyze', inject: '/inject', patch: '/state/patch' }[command]
if (!route) {
  console.error('Usage: node scripts/agent-control.mjs inspect|analyze|inject|patch [request.json]')
  process.exitCode = 2
} else {
  try {
    const discoveryPath = process.env.GRAPHVIDEO_AGENT_CONTROL_FILE
      ?? join(homedir(), '.graphvideo', 'agent-control.json')
    const discovery = JSON.parse(await readFile(discoveryPath, 'utf8'))
    const input = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : {}
    const response = await fetch(`http://127.0.0.1:${discovery.port}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${discovery.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const result = await response.json()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!response.ok) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
