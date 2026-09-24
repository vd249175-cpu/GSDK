import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultValueCodec } from '@graphframework/sdk/protocol'
import { callRunControl } from '../../packages/tooling/run/index.mjs'

const runtime = resolve(import.meta.dirname, '.generated/runtime')

export function readPendingFromProjection(projection) {
  for (const [nodeId, entry] of Object.entries(projection.nodes ?? {})) {
    const state = defaultValueCodec.decode(entry.state)
    if (state?.pendingConfirmation) return { nodeId, ...state.pendingConfirmation }
  }
  return null
}

export function validateDecision(pending, response) {
  if (!pending) throw new Error('图当前没有待处理断点')
  if (pending.step !== 'edit-doc') throw new Error('save-world 断点只由 Agent 图工具处理')
  if (response?.cancelled) return null
  if (response?.requestId !== pending.requestId || response?.step !== pending.step || response?.nodeId !== pending.nodeId) {
    throw new Error('弹窗结果已过期或不属于当前断点')
  }
  if (response.decision !== 'approve' && response.decision !== 'reject') throw new Error('决定必须为 approve 或 reject')
  return response.decision === 'approve'
    ? { type: 'ConfirmStepInfo', requestId: pending.requestId, step: pending.step, decision: 'approve', text: String(response.text ?? pending.text ?? '') }
    : { type: 'ConfirmStepInfo', requestId: pending.requestId, step: pending.step, decision: 'reject', message: String(response.message ?? '用户拒绝关键步骤') }
}

export async function waitForBreakpoint(readProjection, { timeoutMs = 30000, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const projection = await readProjection()
    const pending = readPendingFromProjection(projection)
    if (pending) return pending
    const session = projection.nodes?.['smoke/session']
    const state = session ? defaultValueCodec.decode(session.state) : null
    if (state?.status === 'error') throw new Error(state.lastError ?? '图在到达断点前失败')
    if (state?.status === 'done') throw new Error('图已完成，没有待处理断点')
    if (Date.now() >= deadline) throw new Error('等待断点超时')
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

export async function main(args) {
  const [command, responsePath] = args
  if (command === 'pending') {
    const projection = await callRunControl(runtime, 'projection')
    console.log(JSON.stringify(readPendingFromProjection(projection), null, 2))
    return
  }
  if (command === 'wait') {
    const timeoutMs = Number(responsePath ?? 30000)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('等待时间必须为 1–600000 毫秒')
    const pending = await waitForBreakpoint(() => callRunControl(runtime, 'projection'), { timeoutMs })
    console.log(JSON.stringify(pending, null, 2))
    return
  }
  if (command === 'confirm') {
    if (!responsePath) throw new Error('confirm 需要弹窗结果 JSON 文件路径')
    const response = JSON.parse(readFileSync(resolve(responsePath), 'utf8').replace(/^\uFEFF/, ''))
    const projection = await callRunControl(runtime, 'projection')
    const pending = readPendingFromProjection(projection)
    const info = validateDecision(pending, response)
    if (!info) { console.log(JSON.stringify({ status: 'cancelled' })); return }
    const result = await callRunControl(runtime, 'inject-renderer', { targetNodeId: pending.nodeId, info })
    console.log(JSON.stringify({ status: result.status, submissionId: result.submissionId }, null, 2))
    return
  }
  throw new Error('用法: node agent-control.mjs pending | wait [timeoutMs] | confirm <response.json>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
