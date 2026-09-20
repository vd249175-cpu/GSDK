import {
  Node,
  ExecutionWorldNode,
  ObservationWorldNode,
  defineBackendPlugin,
} from '@graphframework/sdk/plugin'

/**
 * example.browser-recorder：浏览器操作录制会话（Playwright 原生录制）。
 *
 * 职责切分（架构红线）：
 * - RecordingSessionNode（纯领域）：录制会话 State 的唯一 Owner，零 I/O；
 * - BrowserCaptureNode（ExecutionWorldNode）：经注入的 `browser/capture-control`
 *   Adapter 下发 recording-start/stop（宿主侧调 playwright-cli 原生录制，
 *   产物为 Playwright locator 代码），只提交动作并回传提交句柄/动作代码，不监听；
 * - BrowserObserverNode（ObservationWorldNode）：经注入的 `browser/capture-events`
 *   Adapter 做录制中快照轮询（进度可见），经 Info 交回 Owner，零外部写操作。
 *
 * 浏览器本体永远在 Node 之外：
 * playwright-cli 只在 run 宿主（runs/browser-recorder/host.mjs）与显式 manual
 * check 中调用；纯领域 Node 零 I/O；本包不依赖 playwright/playwright-core。
 * 页内 JS 埋点（自动化发货 recorder_script.py 那套）不适用全局录制，已移除。
 * 详见 docs/INTEGRATION.md 与 .agents/skills/gv-browser/SKILL.md。
 */

export const CONTROL_ADAPTER_ID = 'browser/capture-control'
export const EVENTS_ADAPTER_ID = 'browser/capture-events'

const missingAdapter = (id) => ({
  id,
  execute: async () => {
    throw new Error(`EffectAdapter ${id} 未注入：run 须经 backend.host 注入 Playwright/MCP 浏览器侧实现后再启动录制`)
  },
})

export class RecordingSessionNode extends Node {
  constructor(id = 'example.browser-recorder/session', targets = { execution: 'example.browser-recorder/execution' }) {
    super(id, 'BrowserRecordingSession', {
      status: 'idle',
      sessionId: null,
      handle: null,
      lastActions: null,
      eventCount: 0,
      lastEvent: null,
      lastError: null,
    })
    this.executionId = targets.execution
  }

  change(info, ctx) {
    if (info.type === 'StartRecordingInfo') {
      if (ctx.read('status') === 'recording') {
        ctx.write('lastError', 'already recording')
        return
      }
      const sessionId = typeof info.sessionId === 'string' && info.sessionId.length > 0 ? info.sessionId : this.id
      ctx.patchState({ status: 'recording', sessionId, handle: null, lastActions: null, lastError: null, eventCount: 0, lastEvent: null })
      ctx.send({ type: 'StartCaptureInfo', sessionId }, this.executionId)
    } else if (info.type === 'StopRecordingInfo') {
      if (ctx.read('status') !== 'recording') {
        ctx.write('lastError', 'not recording')
        return
      }
      ctx.patchState({ status: 'idle' })
      ctx.send({ type: 'StopCaptureInfo', sessionId: ctx.read('sessionId') }, this.executionId)
    } else if (info.type === 'RecordingStatusInfo') {
      ctx.patchState({ status: info.status, handle: info.handle ?? ctx.read('handle'), lastActions: info.actions ?? ctx.read('lastActions') ?? null, lastError: null })
    } else if (info.type === 'RecordingEventInfo') {
      const current = ctx.read('lastActions') || ''
      const code = info.event?.code || (info.event?.kind === 'action' ? info.event.code : null)
      const nextActions = code ? (current ? `${current}\n${code}` : code) : current
      ctx.patchState({
        eventCount: ctx.read('eventCount') + 1,
        lastEvent: info.event ?? null,
        lastActions: nextActions || null,
      })
    }
  }
}

export class BrowserCaptureNode extends ExecutionWorldNode {
  constructor(
    id = 'example.browser-recorder/execution',
    sessionId = 'example.browser-recorder/session',
    adapter = missingAdapter(CONTROL_ADAPTER_ID),
    observationId = null,
  ) {
    super(id, 'BrowserCapture', { lastOp: null, lastHandle: null, lastError: null })
    this.sessionId = sessionId
    this.captureControl = adapter
    this.observationId = observationId
  }

  async change(info, ctx) {
    if (info.type === 'StartCaptureInfo') {
      try {
        const observation = await ctx.effectAdapter(this.captureControl, { op: 'start', sessionId: info.sessionId })
        ctx.patchState({ lastOp: 'start', lastHandle: observation?.handle ?? null, lastError: null })
        ctx.send(
          { type: 'RecordingStatusInfo', status: 'recording', sessionId: info.sessionId, handle: observation?.handle ?? null },
          this.sessionId,
        )
        if (this.observationId) {
          ctx.send({ type: 'PollRecordingEventsInfo', sessionId: info.sessionId }, this.observationId)
        }
      } catch (err) {
        const message = err?.message ?? String(err)
        ctx.patchState({ lastOp: 'start', lastError: message })
        ctx.send(
          { type: 'RecordingStatusInfo', status: 'idle', sessionId: info.sessionId, error: message },
          this.sessionId,
        )
      }
    } else if (info.type === 'StopCaptureInfo') {
      try {
        const observation = await ctx.effectAdapter(this.captureControl, { op: 'stop', sessionId: info.sessionId })
        ctx.patchState({ lastOp: 'stop', lastError: null })
        ctx.send(
          { type: 'RecordingStatusInfo', status: 'idle', sessionId: info.sessionId, handle: ctx.read('lastHandle'), actions: observation?.actions ?? null },
          this.sessionId,
        )
      } catch (err) {
        const message = err?.message ?? String(err)
        ctx.patchState({ lastOp: 'stop', lastError: message })
        ctx.send(
          { type: 'RecordingStatusInfo', status: 'idle', sessionId: info.sessionId, error: message },
          this.sessionId,
        )
      }
    }
  }
}

export class BrowserObserverNode extends ObservationWorldNode {
  constructor(
    id = 'example.browser-recorder/observation',
    sessionId = 'example.browser-recorder/session',
    adapter = missingAdapter(EVENTS_ADAPTER_ID),
  ) {
    super(id, 'BrowserObserver', { lastCount: 0, lastError: null })
    this.sessionId = sessionId
    this.captureEvents = adapter
  }

  async change(info, ctx) {
    if (info.type === 'PollRecordingEventsInfo') {
      try {
        const observation = await ctx.effectAdapter(this.captureEvents, {
          op: 'poll',
          sessionId: info.sessionId,
          cursor: info.cursor ?? null,
        })
        const events = Array.isArray(observation?.events) ? observation.events : []
        for (const event of events) {
          ctx.send({ type: 'RecordingEventInfo', sessionId: info.sessionId, event }, this.sessionId)
        }
        ctx.patchState({ lastCount: ctx.read('lastCount') + events.length, lastError: null })
        if (observation?.shouldContinue) {
          ctx.send({ type: 'PollRecordingEventsInfo', sessionId: info.sessionId, cursor: observation?.cursor ?? null }, this.id)
        }
      } catch (err) {
        ctx.patchState({ lastError: err?.message ?? String(err) })
      }
    }
  }
}

export function createBrowserRecorder(ctx) {
  const idFor = (local) => {
    if (ctx && typeof ctx.nodeIdFor === 'function') return ctx.nodeIdFor(local)
    if (ctx && typeof ctx.instanceId === 'string' && ctx.instanceId) return `${ctx.instanceId}/${local}`
    return `example.browser-recorder/${local}`
  }
  const dependencies = ctx?.dependencies ?? {}
  const session = new RecordingSessionNode(idFor('session'), { execution: idFor('execution') })
  const execution = new BrowserCaptureNode(
    idFor('execution'),
    idFor('session'),
    dependencies.captureControl ?? missingAdapter(CONTROL_ADAPTER_ID),
    idFor('observation'),
  )
  const observation = new BrowserObserverNode(
    idFor('observation'),
    idFor('session'),
    dependencies.captureEvents ?? missingAdapter(EVENTS_ADAPTER_ID),
  )
  return { session, execution, observation }
}

export const createBrowserRecorderGraph = (ctx) => Object.values(createBrowserRecorder(ctx))
createBrowserRecorderGraph.describe = () => ({
  kind: 'graph',
  localIds: ['session', 'execution', 'observation'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'session', infoType: 'StartRecordingInfo' },
    { localId: 'session', infoType: 'StopRecordingInfo' },
  ],
})

export function createBrowserCaptureControlAdapter({ runCli, session = 'rec' } = {}) {
  if (typeof runCli !== 'function') throw new Error('createBrowserCaptureControlAdapter 需要 runCli(args) 函数')
  return {
    id: CONTROL_ADAPTER_ID,
    cliSession: session,
    execute: async (request) => {
      if (request?.op === 'start') {
        await runCli(['-s=' + session, 'recording-start'])
        return { handle: `playwright-cli:${session}:${request.sessionId}` }
      }
      if (request?.op === 'stop') {
        const output = await runCli(['-s=' + session, 'recording-stop'])
        return { stopped: true, actions: output }
      }
      throw new Error(`未知 capture-control 请求：${JSON.stringify(request?.op)}`)
    },
  }
}

export function createBrowserCaptureEventsAdapter({ runCli, session = 'rec' } = {}) {
  if (typeof runCli !== 'function') throw new Error('createBrowserCaptureEventsAdapter 需要 poll 的 runCli(args) 函数')
  return {
    id: EVENTS_ADAPTER_ID,
    cliSession: session,
    execute: async (request) => {
      const output = await runCli(['-s=' + session, 'snapshot'])
      return { events: [{ kind: 'snapshot', sessionId: request?.sessionId ?? null, snapshot: output }], cursor: request?.cursor ?? null }
    },
  }
}

export { createCdpRecorder } from './cdp-recorder.mjs'

const isStartRecordingInfo = (info) => info?.type === 'StartRecordingInfo'
  && (info.sessionId === undefined || typeof info.sessionId === 'string')
const isStopRecordingInfo = (info) => info?.type === 'StopRecordingInfo'

export default defineBackendPlugin({
  id: 'example.browser-recorder',
  createNodes: (context) => Object.values(createBrowserRecorder(context)),
  // 仅公开用户意图：开始/停止录制。内部 Info（StartCaptureInfo、
  // StopCaptureInfo、RecordingStatusInfo、RecordingEventInfo、
  // PollRecordingEventsInfo）不在白名单，宿主不得直接注入。
  rendererRoots: [
    {
      targetNodeId: 'example.browser-recorder/session',
      infoType: 'StartRecordingInfo',
      validate: isStartRecordingInfo,
    },
    {
      targetNodeId: 'example.browser-recorder/session',
      infoType: 'StopRecordingInfo',
      validate: isStopRecordingInfo,
    },
  ],
})
