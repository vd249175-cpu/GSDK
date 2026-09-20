import {
  Node,
  ExecutionWorldNode,
  ObservationWorldNode,
  defineBackendPlugin,
} from '@graphframework/sdk/plugin'

/**
 * example.os-recorder：OS 级操作录制会话。
 *
 * 职责切分（架构红线）：
 * - RecordingSessionNode（纯领域）：录制会话 State 的唯一 Owner，零 I/O；
 * - RecordingCaptureNode（ExecutionWorldNode）：经注入的 `ufo/capture-control`
 *   Adapter 下发 start/stop，只提交动作并回传提交句柄，不监听；
 * - RecordingObserverNode（ObservationWorldNode）：经注入的 `ufo/capture-events`
 *   Adapter 轮询物理事件，经 Info 交回 Owner，零外部写操作。
 *
 * UFO 本体（Python、Windows-only、重型 ML 依赖）永远在进程外：
 * Adapter 实现由 run 宿主（backend.host）提供，与 UFO 侧车进程对话，
 * 本插件只定义 DTO 契约与缺省抛错桩。详见 docs/INTEGRATION.md。
 */

const CONTROL_ADAPTER_ID = 'ufo/capture-control'
const EVENTS_ADAPTER_ID = 'ufo/capture-events'

const missingAdapter = (id) => ({
  id,
  execute: async () => {
    throw new Error(`EffectAdapter ${id} 未注入：run 须经 backend.host 注入 UFO 侧车实现后再启动录制`)
  },
})

export class RecordingSessionNode extends Node {
  constructor(id = 'example.os-recorder/session', targets = { execution: 'example.os-recorder/execution' }) {
    super(id, 'RecordingSession', {
      status: 'idle',
      sessionId: null,
      handle: null,
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
      ctx.patchState({ status: 'recording', sessionId, handle: null, lastError: null })
      ctx.send({ type: 'StartCaptureInfo', sessionId }, this.executionId)
    } else if (info.type === 'StopRecordingInfo') {
      if (ctx.read('status') !== 'recording') {
        ctx.write('lastError', 'not recording')
        return
      }
      ctx.patchState({ status: 'idle' })
      ctx.send({ type: 'StopCaptureInfo', sessionId: ctx.read('sessionId') }, this.executionId)
    } else if (info.type === 'RecordingStatusInfo') {
      ctx.patchState({ status: info.status, handle: info.handle ?? ctx.read('handle'), lastError: null })
    } else if (info.type === 'RecordingEventInfo') {
      ctx.patchState({ eventCount: ctx.read('eventCount') + 1, lastEvent: info.event ?? null })
    }
  }
}

export class RecordingCaptureNode extends ExecutionWorldNode {
  constructor(
    id = 'example.os-recorder/execution',
    sessionId = 'example.os-recorder/session',
    adapter = missingAdapter(CONTROL_ADAPTER_ID),
  ) {
    super(id, 'RecordingCapture', { lastOp: null, lastHandle: null, lastError: null })
    this.sessionId = sessionId
    this.captureControl = adapter
  }

  async change(info, ctx) {
    if (info.type === 'StartCaptureInfo') {
      const observation = await ctx.effectAdapter(this.captureControl, { op: 'start', sessionId: info.sessionId })
      ctx.patchState({ lastOp: 'start', lastHandle: observation?.handle ?? null, lastError: null })
      ctx.send(
        { type: 'RecordingStatusInfo', status: 'recording', sessionId: info.sessionId, handle: observation?.handle ?? null },
        this.sessionId,
      )
    } else if (info.type === 'StopCaptureInfo') {
      await ctx.effectAdapter(this.captureControl, { op: 'stop', sessionId: info.sessionId })
      ctx.patchState({ lastOp: 'stop', lastError: null })
      ctx.send(
        { type: 'RecordingStatusInfo', status: 'idle', sessionId: info.sessionId, handle: ctx.read('lastHandle') },
        this.sessionId,
      )
    }
  }
}

export class RecordingObserverNode extends ObservationWorldNode {
  constructor(
    id = 'example.os-recorder/observation',
    sessionId = 'example.os-recorder/session',
    adapter = missingAdapter(EVENTS_ADAPTER_ID),
  ) {
    super(id, 'RecordingObserver', { lastCount: 0, lastError: null })
    this.sessionId = sessionId
    this.captureEvents = adapter
  }

  async change(info, ctx) {
    if (info.type === 'PollRecordingEventsInfo') {
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
    }
  }
}

export function createOsRecorder(ctx) {
  const idFor = (local) => {
    if (ctx && typeof ctx.nodeIdFor === 'function') return ctx.nodeIdFor(local)
    if (ctx && typeof ctx.instanceId === 'string' && ctx.instanceId) return `${ctx.instanceId}/${local}`
    return `example.os-recorder/${local}`
  }
  const dependencies = ctx?.dependencies ?? {}
  const session = new RecordingSessionNode(idFor('session'), { execution: idFor('execution') })
  const execution = new RecordingCaptureNode(
    idFor('execution'),
    idFor('session'),
    dependencies.captureControl ?? missingAdapter(CONTROL_ADAPTER_ID),
  )
  const observation = new RecordingObserverNode(
    idFor('observation'),
    idFor('session'),
    dependencies.captureEvents ?? missingAdapter(EVENTS_ADAPTER_ID),
  )
  return { session, execution, observation }
}


export function createOsCaptureControlAdapter({ request } = {}) {
  if (typeof request !== 'function') throw new Error('createOsCaptureControlAdapter 需要 request(path, { method, body }) 函数')
  return {
    id: CONTROL_ADAPTER_ID,
    execute: async (req) => {
      if (req?.op === 'start') {
        const observation = await request('/capture/start', { method: 'POST', body: { sessionId: req.sessionId } })
        return { handle: observation?.handle ?? `ufo:${req.sessionId}` }
      }
      if (req?.op === 'stop') {
        const observation = await request('/capture/stop', { method: 'POST', body: { sessionId: req.sessionId } })
        return { stopped: true, actions: Array.isArray(observation?.events) ? observation.events : [] }
      }
      throw new Error(`未知 capture-control 请求：${JSON.stringify(req?.op)}`)
    },
  }
}

export function createOsCaptureEventsAdapter({ request } = {}) {
  if (typeof request !== 'function') throw new Error('createOsCaptureEventsAdapter 需要 request(path, { method, body }) 函数')
  return {
    id: EVENTS_ADAPTER_ID,
    execute: async (req) => {
      const query = new URLSearchParams({ sessionId: req?.sessionId ?? '', cursor: req?.cursor ?? '' }).toString()
      const observation = await request(`/capture/events?${query}`)
      return {
        events: Array.isArray(observation?.events) ? observation.events : [],
        cursor: observation?.cursor ?? req?.cursor ?? null,
      }
    },
  }
}
export const createOsRecorderGraph = (ctx) => Object.values(createOsRecorder(ctx))
createOsRecorderGraph.describe = () => ({
  kind: 'graph',
  localIds: ['session', 'execution', 'observation'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'session', infoType: 'StartRecordingInfo' },
    { localId: 'session', infoType: 'StopRecordingInfo' },
  ],
})
const isStartRecordingInfo = (info) => info?.type === 'StartRecordingInfo'
  && (info.sessionId === undefined || typeof info.sessionId === 'string')
const isStopRecordingInfo = (info) => info?.type === 'StopRecordingInfo'

export default defineBackendPlugin({
  id: 'example.os-recorder',
  createNodes: (context) => Object.values(createOsRecorder(context)),
  // 仅公开用户意图：开始/停止录制。内部 Info（StartCaptureInfo、
  // StopCaptureInfo、RecordingStatusInfo、RecordingEventInfo、
  // PollRecordingEventsInfo）不在白名单，宿主不得直接注入。
  rendererRoots: [
    {
      targetNodeId: 'example.os-recorder/session',
      infoType: 'StartRecordingInfo',
      validate: isStartRecordingInfo,
    },
    {
      targetNodeId: 'example.os-recorder/session',
      infoType: 'StopRecordingInfo',
      validate: isStopRecordingInfo,
    },
  ],
})
