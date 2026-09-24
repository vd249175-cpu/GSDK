import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultValueCodec } from '@graphframework/sdk/protocol'
import { callRunControl } from '../../packages/tooling/run/index.mjs'

const runtime = resolve(import.meta.dirname, '.generated/runtime')

export function readAgentStatusFromProjection(projection) {
  const decode = (id) => {
    const entry = projection.nodes?.[id]
    return entry ? defaultValueCodec.decode(entry.state) : null
  }
  return { submitted: decode('agent/session')?.threads ?? {},
    results: decode('agent/result')?.threads ?? {},
    latestMonitor: decode('monitor/session')?.latestByThread ?? {} }
}

export async function main(args) {
  const [command, ...rest] = args
  if (command === 'status') {
    console.log(JSON.stringify(readAgentStatusFromProjection(await callRunControl(runtime, 'projection')), null, 2))
    return
  }
  if (command === 'ask') {
    const [threadId, requestId, ...words] = rest
    if (!threadId || !requestId || words.length === 0) {
      throw new Error('用法: node agent-control.mjs ask <threadId> <requestId> <text>')
    }
    const result = await callRunControl(runtime, 'inject-renderer', { targetNodeId: 'agent/session',
      info: { type: 'AgentInputInfo', threadId, requestId, text: words.join(' ') } })
    console.log(JSON.stringify({ status: result.status, submissionId: result.submissionId }, null, 2))
    return
  }
  throw new Error('用法: node agent-control.mjs status | ask <threadId> <requestId> <text>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
