import {
  ExecutionWorldNode,
  Node,
  ObservationWorldNode,
  defineBackendPlugin,
} from '@graphframework/sdk/plugin'

export const BROWSER_NAVIGATE_ADAPTER_ID = 'browser/executor'
export const DESKTOP_CONTROL_ADAPTER_ID = 'smoke/desktop-control'
export const DESKTOP_OBSERVATION_ADAPTER_ID = 'smoke/desktop-observation'
export const WORLD_DOCUMENT_ADAPTER_ID = 'smoke/world-document'

const missingAdapter = (id) => ({
  id,
  execute: async () => {
    throw new Error(`EffectAdapter ${id} was not injected by the named run host`)
  },
})

const errorMessage = (error) => (error instanceof Error ? error.message : String(error))

// 提炼自录制 unified-1790148389684（24s 纯桌面冒烟）：
// Chrome 书签打开 npm 主页并关通知 → 双击打开 开发步骤.docx → 编辑 → 保存 → 回到 GraphFramework。
// 重复点击 about:blank、任务栏来回聚焦属噪声，不进入流程；键盘输入内容录制未捕获，参数化为 docText。
export class DesktopSmokeSessionNode extends Node {
  constructor(
    id = 'test.desktop-smoke-test/session',
    targets = {
      execution: 'test.desktop-smoke-test/execution',
      observation: 'test.desktop-smoke-test/observation',
    },
  ) {
    super(id, 'DesktopSmokeSession', {
      status: 'idle',
      requestId: null,
      npmUrl: null,
      docName: null,
      docText: '',
      skipDocEdit: false,
      browserResult: null,
      docResult: null,
      observation: null,
      completedAt: null,
      lastError: null,
      pendingConfirmation: null,
      worldDocument: null,
    })
    this.executionId = targets.execution
    this.observationId = targets.observation
  }

  change(info, ctx) {
    if (info.type === 'TriggerSmokeTest') {
      ctx.patchState({
        status: 'checking-browser',
        requestId: info.requestId ?? 'smoke-1',
        npmUrl: info.npmUrl ?? 'https://www.npmjs.com/',
        docName: info.docName ?? '开发步骤.docx',
        docText: typeof info.docText === 'string' ? info.docText : '',
        skipDocEdit: info.skipDocEdit === true,
        browserResult: null,
        docResult: null,
        observation: null,
        completedAt: null,
        lastError: null,
        pendingConfirmation: null,
        worldDocument: null,
      })
      ctx.send(
        { type: 'ExecuteBrowserCheckInfo', requestId: info.requestId ?? 'smoke-1', url: info.npmUrl ?? 'https://www.npmjs.com/' },
        this.executionId,
      )
      return
    }

    if (info.type === 'BrowserCheckedInfo') {
      if (info.requestId !== ctx.read('requestId') || ctx.read('status') !== 'checking-browser') return
      const requestId = info.requestId ?? ctx.read('requestId') ?? 'smoke-1'
      const docName = ctx.read('docName') ?? '开发步骤.docx'
      const text = ctx.read('docText') ?? ''
      if (ctx.read('skipDocEdit')) {
        ctx.patchState({ status: 'observing', browserResult: info.result ?? null })
        ctx.send({ type: 'ObserveDesktopInfo', requestId, mode: 'desktop' }, this.observationId)
        return
      }
      ctx.patchState({
        status: 'awaiting-confirmation',
        browserResult: info.result ?? null,
        pendingConfirmation: {
          step: 'edit-doc',
          requestId,
          docName,
          text,
          prompt: `浏览器已就绪，确认后将编辑并保存文档 ${docName}`,
        },
      })
      return
    }

    if (info.type === 'DocEditedInfo') {
      if (info.requestId !== ctx.read('requestId') || ctx.read('status') !== 'editing-doc') return
      ctx.patchState({ status: 'observing', docResult: info.result ?? null })
      ctx.send(
        { type: 'ObserveDesktopInfo', requestId: info.requestId, mode: 'selected-window' },
        this.observationId,
      )
      return
    }
    if (info.type === 'ConfirmStepInfo') {
      const pending = ctx.read('pendingConfirmation')
      if (!pending || info.requestId !== pending.requestId || info.step !== pending.step) return
      if (info.decision === 'approve') {
        const text = typeof info.text === 'string' ? info.text : (pending.text ?? '')
        ctx.patchState({ status: 'editing-doc', docText: text, pendingConfirmation: null })
        ctx.send(
          { type: 'ExecuteDocEditInfo', requestId: pending.requestId, docName: pending.docName, text },
          this.executionId,
        )
        return
      }
      if (info.decision === 'reject') {
        ctx.patchState({
          status: 'error',
          pendingConfirmation: null,
          completedAt: null,
          lastError: info.message ?? `关键步骤 ${pending.step} 已被拒绝`,
        })
      }
      return
    }

    if (info.type === 'DesktopObservedInfo') {
      if (info.requestId !== ctx.read('requestId') || ctx.read('status') !== 'observing') return
      ctx.patchState({
        status: 'awaiting-world-save',
        observation: info.observation ?? null,
        pendingConfirmation: {
          step: 'save-world', requestId: info.requestId,
          prompt: '本次浏览器与电脑操作测试已完成。是否保存 world 文档？',
          browserResult: ctx.read('browserResult'), docResult: ctx.read('docResult'),
          observation: info.observation ?? null,
        },
        lastError: null,
      })
      return
    }

    if (info.type === 'WorldSaveDecisionInfo') {
      if (info.requestId !== ctx.read('requestId') || ctx.read('status') !== 'awaiting-world-save'
        || !['approve', 'reject'].includes(info.decision)) return
      if (info.decision === 'reject') {
        ctx.patchState({ status: 'done', pendingConfirmation: null,
          completedAt: ctx.read('observation')?.observedAt ?? null })
        return
      }
      ctx.patchState({ status: 'saving-world', pendingConfirmation: null })
      ctx.send({ type: 'SaveWorldDocumentInfo', requestId: info.requestId,
        text: typeof info.text === 'string' ? info.text : '',
        browserResult: ctx.read('browserResult'), docResult: ctx.read('docResult'),
        observation: ctx.read('observation') }, this.executionId)
      return
    }

    if (info.type === 'WorldDocumentSavedInfo') {
      if (info.requestId !== ctx.read('requestId') || ctx.read('status') !== 'saving-world') return
      ctx.patchState({ status: 'done', worldDocument: info.result ?? null,
        completedAt: ctx.read('observation')?.observedAt ?? null })
      return
    }

    if (info.type === 'SmokeTestFailedInfo') {
      if (info.requestId !== ctx.read('requestId')) return
      ctx.patchState({ status: 'error', completedAt: null, lastError: info.message ?? 'smoke test failed' })
    }
  }
}

export class DesktopSmokeExecutionNode extends ExecutionWorldNode {
  constructor(
    id = 'test.desktop-smoke-test/execution',
    sessionId = 'test.desktop-smoke-test/session',
    adapters = {},
  ) {
    super(id, 'DesktopSmokeExecution', { lastRequestId: null, lastCommand: null, lastResult: null, lastError: null })
    this.sessionId = sessionId
    this.browserNavigate = adapters.browserNavigate ?? missingAdapter(BROWSER_NAVIGATE_ADAPTER_ID)
    this.desktopControl = adapters.desktopControl ?? missingAdapter(DESKTOP_CONTROL_ADAPTER_ID)
    this.worldDocument = adapters.worldDocument ?? missingAdapter(WORLD_DOCUMENT_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type === 'ExecuteBrowserCheckInfo') {
      const result = await this.run(ctx, info, this.browserNavigate, { task: 'check-home', url: info.url }, 'open-npm-home')
      if (result !== undefined) ctx.send({ type: 'BrowserCheckedInfo', requestId: info.requestId, result }, this.sessionId)
      return
    }
    if (info.type === 'ExecuteDocEditInfo') {
      const result = await this.run(
        ctx,
        info,
        this.desktopControl,
        { docName: info.docName, text: info.text },
        'edit-doc',
      )
      if (result !== undefined) ctx.send({ type: 'DocEditedInfo', requestId: info.requestId, result }, this.sessionId)
      return
    }
    if (info.type === 'SaveWorldDocumentInfo') {
      const result = await this.run(ctx, info, this.worldDocument, {
        text: info.text, browserResult: info.browserResult, docResult: info.docResult,
        observation: info.observation,
      }, 'save-world')
      if (result !== undefined) ctx.send({ type: 'WorldDocumentSavedInfo', requestId: info.requestId, result }, this.sessionId)
    }
  }

  async run(ctx, info, adapter, payload, command) {
    try {
      const result = await ctx.effectAdapter(adapter, { requestId: info.requestId, ...payload })
      ctx.patchState({ lastRequestId: info.requestId, lastCommand: command, lastResult: result ?? null, lastError: null })
      return result ?? null
    } catch (error) {
      const message = errorMessage(error)
      ctx.patchState({ lastRequestId: info.requestId, lastCommand: command, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'execute', message }, this.sessionId)
      return undefined
    }
  }
}

export class DesktopSmokeObservationNode extends ObservationWorldNode {
  constructor(
    id = 'test.desktop-smoke-test/observation',
    sessionId = 'test.desktop-smoke-test/session',
    adapter = missingAdapter(DESKTOP_OBSERVATION_ADAPTER_ID),
  ) {
    super(id, 'DesktopSmokeObservation', { lastRequestId: null, lastWindowCount: 0, lastError: null })
    this.sessionId = sessionId
    this.desktopObservation = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'ObserveDesktopInfo') return
    try {
      const observation = await ctx.effectAdapter(this.desktopObservation, {
        requestId: info.requestId,
        mode: info.mode ?? 'selected-window',
      })
      ctx.patchState({
        lastRequestId: info.requestId,
        lastWindowCount: Array.isArray(observation?.windows) ? observation.windows.length : 0,
        lastError: null,
      })
      ctx.send({ type: 'DesktopObservedInfo', requestId: info.requestId, observation: observation ?? {} }, this.sessionId)
    } catch (error) {
      const message = errorMessage(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'observe', message }, this.sessionId)
    }
  }
}

export function createDesktopSmokeTest(ctx) {
  const idFor = (local) => {
    if (ctx && typeof ctx.nodeIdFor === 'function') return ctx.nodeIdFor(local)
    if (ctx && typeof ctx.instanceId === 'string' && ctx.instanceId) return `${ctx.instanceId}/${local}`
    return `test.desktop-smoke-test/${local}`
  }
  const dependencies = ctx?.dependencies ?? {}
  const sessionId = idFor('session')
  const targets = { execution: idFor('execution'), observation: idFor('observation') }
  return {
    session: new DesktopSmokeSessionNode(sessionId, targets),
    execution: new DesktopSmokeExecutionNode(targets.execution, sessionId, {
      browserNavigate: dependencies.browserNavigate,
      desktopControl: dependencies.desktopControl,
      worldDocument: dependencies.worldDocument,
    }),
    observation: new DesktopSmokeObservationNode(
      targets.observation,
      sessionId,
      dependencies.desktopObservation,
    ),
  }
}

export const createDesktopSmokeTestGraph = (ctx) => Object.values(createDesktopSmokeTest(ctx))
createDesktopSmokeTestGraph.describe = () => ({
  kind: 'graph',
  localIds: ['session', 'execution', 'observation'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'session', infoType: 'TriggerSmokeTest' },
    { localId: 'session', infoType: 'ConfirmStepInfo' },
  ],
})

export default defineBackendPlugin({
  id: 'test.desktop-smoke-test',
  createNodes: (context) => Object.values(createDesktopSmokeTest(context)),
  rendererRoots: [
    {
      targetNodeId: 'test.desktop-smoke-test/session',
      infoType: 'TriggerSmokeTest',
      validate: (info) => info?.type === 'TriggerSmokeTest',
    },
    {
      targetNodeId: 'test.desktop-smoke-test/session',
      infoType: 'ConfirmStepInfo',
      validate: (info) => info?.type === 'ConfirmStepInfo' && (info.decision === 'approve' || info.decision === 'reject'),
    },
  ],
})
