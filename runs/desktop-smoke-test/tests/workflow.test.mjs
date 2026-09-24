import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { buildCausalIndex, validateCausalIndex } from '@graphframework/sdk/analysis'
import { createDesktopSmokeTest } from '../plugins/backend/desktop-smoke-test/index.mjs'

const assemble = ({ failDocEdit = false, failDesktopFocus = false } = {}) => {
  const calls = []
  const nodes = createDesktopSmokeTest({
    instanceId: 'smoke',
    dependencies: {
      browserNavigate: {
        id: 'test/browser-navigate',
        execute: async (request) => {
          calls.push({ adapter: 'browserNavigate', request })
          return { opened: true, url: request.url, notificationDismissed: true }
        },
      },
      desktopControl: {
        id: 'test/desktop-control',
        execute: async (request) => {
          calls.push({ adapter: 'desktopControl', request })
          if (request.action?.command === 'focus_window') {
            if (failDesktopFocus) throw new Error('target desktop window is unavailable')
            return { command: 'focus_window', focused: true }
          }
          if (failDocEdit) throw new Error('word save dialog stuck')
          return { docName: request.docName, edited: true, saved: true }
        },
      },
      desktopObservation: {
        id: 'test/desktop-observation',
        execute: async (request) => {
          calls.push({ adapter: 'desktopObservation', request })
          return {
            selectedWindow: { id: 'gf', name: 'GraphFramework' },
            windows: [{ id: 'gf', name: 'GraphFramework' }],
            observedAt: '2026-09-23T07:26:53.000Z',
          }
        },
      },
      worldDocument: { id: 'smoke/world-document', execute: async (request) => {
        calls.push({ adapter: 'worldDocument', request })
        return { saved: true, documentId: request.requestId }
      } },
    },
  })
  return { nodes: Object.values(nodes), calls }
}

describe('desktop-smoke-test workflow', () => {
  it('keeps the browser, computer and review Info routes statically resolved', () => {
    const { nodes } = assemble()
    const index = buildCausalIndex({ nodeObjects: nodes })
    expect(index.unresolvedInfoTypes).toEqual([])
    expect(index.unresolvedSendTargets).toEqual([])
    expect(validateCausalIndex(index).issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('browser and computer action plus observation reach world review without a document edit', async () => {
    const { nodes, calls } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'smoke/session', info: {
      type: 'TriggerSmokeTest', requestId: 'inspect-only', skipDocEdit: true,
    } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('smoke/session')).toMatchObject({
      status: 'awaiting-world-save', pendingConfirmation: { step: 'save-world',
        desktopActionResult: { command: 'focus_window', focused: true } },
    })
    expect(calls.map((call) => call.adapter)).toEqual(['browserNavigate', 'desktopControl', 'desktopObservation'])
    expect(calls[1].request.action).toEqual({ command: 'focus_window', window: { titleContains: 'GraphFramework' } })
    runtime.dispose()
  })

  it('stops before agent review when the computer action fails', async () => {
    const { nodes, calls } = assemble({ failDesktopFocus: true })
    const runtime = createTestRuntime({ nodes })
    try {
      runtime.inject({ targetNodeId: 'smoke/session', info: {
        type: 'TriggerSmokeTest', requestId: 'focus-failure', skipDocEdit: true,
      } })
      await runtime.waitForQuiescence()
      expect(runtime.getState('smoke/session')).toMatchObject({
        status: 'error', lastError: 'target desktop window is unavailable',
      })
      expect(calls.map((call) => call.adapter)).toEqual(['browserNavigate', 'desktopControl'])
    } finally { runtime.dispose() }
  })

  it('TriggerSmokeTest 在浏览器检查后停住等待确认，批准后才跑通并结算 done', async () => {
    const { nodes, calls } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({
      targetNodeId: 'smoke/session',
      info: {
        type: 'TriggerSmokeTest',
        requestId: 'smoke-1',
        npmUrl: 'https://www.npmjs.com/',
        docName: '开发步骤.docx',
        docText: '冒烟验证',
      },
    })
    await runtime.waitForQuiescence()

    const awaiting = runtime.getState('smoke/session')
    expect(awaiting.status).toBe('awaiting-confirmation')
    expect(awaiting.pendingConfirmation).toMatchObject({ step: 'edit-doc', requestId: 'smoke-1', docName: '开发步骤.docx' })
    expect(calls.some((call) => call.adapter === 'desktopControl')).toBe(false)

    runtime.inject({
      targetNodeId: 'smoke/session',
      info: { type: 'ConfirmStepInfo', requestId: 'smoke-1', step: 'edit-doc', decision: 'approve', text: '用户改后文本' },
    })
    await runtime.waitForQuiescence()

    const pendingWorld = runtime.getState('smoke/session')
    expect(pendingWorld.status).toBe('awaiting-world-save')
    expect(pendingWorld.pendingConfirmation).toMatchObject({ step: 'save-world', requestId: 'smoke-1' })
    runtime.inject({ targetNodeId: 'smoke/session', info: {
      type: 'WorldSaveDecisionInfo', requestId: 'smoke-1', decision: 'approve',
      text: '保留测试记录',
    } })
    await runtime.waitForQuiescence()
    const session = runtime.getState('smoke/session')
    expect(session.status).toBe('done')
    expect(session.pendingConfirmation).toBeNull()
    expect(session.browserResult).toMatchObject({ opened: true, notificationDismissed: true })
    expect(session.docResult).toMatchObject({ docName: '开发步骤.docx', saved: true })
    expect(session.observation.selectedWindow).toMatchObject({ name: 'GraphFramework' })
    expect(session.worldDocument).toMatchObject({ saved: true, documentId: 'smoke-1' })
    expect(session.lastError).toBeNull()

    const browserCall = calls.find((call) => call.adapter === 'browserNavigate')
    expect(browserCall.request).toMatchObject({ requestId: 'smoke-1', task: 'check-home', url: 'https://www.npmjs.com/' })
    const docCall = calls.find((call) => call.adapter === 'desktopControl')
    expect(docCall.request).toMatchObject({ requestId: 'smoke-1', docName: '开发步骤.docx', text: '用户改后文本' })
    expect(calls.find((call) => call.adapter === 'worldDocument').request).toMatchObject({
      requestId: 'smoke-1', browserResult: { opened: true }, docResult: { saved: true },
    })
    runtime.dispose()
  })

  it('decline at world save ends without writing a world document', async () => {
    const { nodes, calls } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'smoke/session', info: { type: 'TriggerSmokeTest', requestId: 'decline' } })
    await runtime.waitForQuiescence()
    runtime.inject({ targetNodeId: 'smoke/session', info: {
      type: 'ConfirmStepInfo', requestId: 'decline', step: 'edit-doc', decision: 'approve',
    } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('smoke/session').status).toBe('awaiting-world-save')
    runtime.inject({ targetNodeId: 'smoke/session', info: {
      type: 'WorldSaveDecisionInfo', requestId: 'decline', decision: 'reject',
    } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('smoke/session')).toMatchObject({ status: 'done', worldDocument: null })
    expect(calls.some((call) => call.adapter === 'worldDocument')).toBe(false)
    runtime.dispose()
  })

  it('surfaces agent review failure instead of leaving the save breakpoint pending', async () => {
    const { nodes, calls } = assemble()
    const runtime = createTestRuntime({ nodes })
    try {
      runtime.inject({ targetNodeId: 'smoke/session', info: {
        type: 'TriggerSmokeTest', requestId: 'agent-failure', skipDocEdit: true,
      } })
      await runtime.waitForQuiescence()
      runtime.inject({ targetNodeId: 'smoke/session', info: {
        type: 'AgentReviewFailedInfo', requestId: 'agent-failure', message: 'model API key is required',
      } })
      await runtime.waitForQuiescence()
      expect(runtime.getState('smoke/session')).toMatchObject({
        status: 'error', pendingConfirmation: null, lastError: 'model API key is required',
      })
      expect(calls.some((call) => call.adapter === 'worldDocument')).toBe(false)
    } finally { runtime.dispose() }
  })

  it('拒绝关键步骤时会话进入 error 并记录原因', async () => {
    const { nodes } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({
      targetNodeId: 'smoke/session',
      info: { type: 'TriggerSmokeTest', requestId: 'smoke-reject', docText: 'x' },
    })
    await runtime.waitForQuiescence()
    expect(runtime.getState('smoke/session').status).toBe('awaiting-confirmation')

    runtime.inject({
      targetNodeId: 'smoke/session',
      info: { type: 'ConfirmStepInfo', requestId: 'smoke-reject', step: 'edit-doc', decision: 'reject' },
    })
    await runtime.waitForQuiescence()

    const session = runtime.getState('smoke/session')
    expect(session.status).toBe('error')
    expect(session.pendingConfirmation).toBeNull()
    expect(session.lastError).toContain('edit-doc')
    runtime.dispose()
  })

  it('忽略旧请求的确认与迟到结果', async () => {
    const { nodes, calls } = assemble()
    const runtime = createTestRuntime({ nodes })
    runtime.inject({ targetNodeId: 'smoke/session', info: { type: 'TriggerSmokeTest', requestId: 'current' } })
    await runtime.waitForQuiescence()
    runtime.inject({ targetNodeId: 'smoke/session', info: { type: 'ConfirmStepInfo', requestId: 'old', step: 'edit-doc', decision: 'approve' } })
    runtime.inject({ targetNodeId: 'smoke/session', info: { type: 'BrowserCheckedInfo', requestId: 'old', result: {} } })
    await runtime.waitForQuiescence()
    expect(runtime.getState('smoke/session').status).toBe('awaiting-confirmation')
    expect(calls.some((call) => call.adapter === 'desktopControl')).toBe(false)
    runtime.dispose()
  })

  it('文档编辑失败时会话进入 error 并记录原因', async () => {
    const { nodes } = assemble({ failDocEdit: true })
    const runtime = createTestRuntime({ nodes })
    runtime.inject({
      targetNodeId: 'smoke/session',
      info: { type: 'TriggerSmokeTest', requestId: 'smoke-err', docText: 'x' },
    })
    await runtime.waitForQuiescence()
    expect(runtime.getState('smoke/session').status).toBe('awaiting-confirmation')

    runtime.inject({
      targetNodeId: 'smoke/session',
      info: { type: 'ConfirmStepInfo', requestId: 'smoke-err', step: 'edit-doc', decision: 'approve' },
    })
    await runtime.waitForQuiescence()

    const session = runtime.getState('smoke/session')
    expect(session.status).toBe('error')
    expect(session.lastError).toContain('word save dialog stuck')
    runtime.dispose()
  })
})
