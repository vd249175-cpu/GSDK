import {
  Node,
  ExecutionWorldNode,
  ObservationWorldNode,
  defineBackendPlugin,
} from '@graphframework/sdk/plugin'

/**
 * example.unified-recorder: desktop + browser 双源统一录制会话。
 *
 * 核心能力：
 * 1. 双源流式合流：实时捕获 Windows 桌面输入与浏览器快照，统一推进事件序列；
 * 2. 原生导出双备份：独立生成并保留原生 Playwright 脚本与 Windows PSR ZIP 包；
 * 3. 产物清洗与 Agent 纯文字版本：从 MHT 抽离 Base64 截图落盘到磁盘，
 *    合并双源动作生成高信噪比纯文字版本（agent-transcript.md，附截图文件路径，零 Base64 塞爆）。
 */

export const DESKTOP_CONTROL_ADAPTER_ID = 'unified/desktop-control'
export const BROWSER_CONTROL_ADAPTER_ID = 'unified/browser-control'
export const DESKTOP_OBSERVATION_ADAPTER_ID = 'unified/desktop-observation'
export const DESKTOP_EVENTS_ADAPTER_ID = 'unified/desktop-events'
export const BROWSER_EVENTS_ADAPTER_ID = 'unified/browser-events'

const VALID_SOURCES = ['desktop', 'browser']

const missingAdapter = (id) => ({
  id,
  execute: async () => {
    throw new Error(`EffectAdapter ${id} was not injected by the unified-recorder run host`)
  },
})

const errorMessage = (error) => (error instanceof Error ? error.message : String(error))

const finiteIndex = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
)

const firstLine = (code) => String(code).split('\n').map((line) => line.trim()).find(Boolean) ?? ''

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** 个人系统明文输入提取 */
export const plaintextOf = (code) => {
  if (typeof code !== 'string') return null
  const match = code.match(/(?:fill|type)\(\s*(['"])((?:\\\1|(?!\1).)*)\1/si)
  return match ? match[2] : null
}

const browserActionOf = (code, kind) => {
  if (!code) return kind && kind !== 'action' ? kind : 'snapshot'
  if (/fill|type\(/i.test(code)) return 'fill'
  if (/goto|navigate/i.test(code)) return 'goto'
  if (/click/i.test(code)) return 'click'
  if (/press/i.test(code)) return 'press'
  if (/selectOption/i.test(code)) return 'select'
  if (/check|uncheck/i.test(code)) return 'check'
  return kind && kind !== 'action' ? kind : 'browser-action'
}

/** 桌面原始事件 → 标准化 step */
export function normalizeDesktopEvent(raw, index) {
  if (raw && (raw.source === 'desktop' || raw.source === 'browser') && typeof raw.action === 'string') {
    return { ...raw, index: finiteIndex(raw.index, index) }
  }
  return {
    index: finiteIndex(raw?.index, index),
    time: raw?.time ?? null,
    source: 'desktop',
    application: raw?.application ?? null,
    windowTitle: raw?.windowTitle ?? null,
    action: raw?.action ?? 'Desktop Action',
    description: raw?.description ?? raw?.action ?? 'Recorded desktop interaction',
    locator: null,
    code: null,
    text: null,
    screenshotFile: raw?.screenshotFile ?? null,
  }
}

/** 浏览器原始事件 → 标准化 step */
export function normalizeBrowserEvent(raw, index) {
  if (raw && (raw.source === 'desktop' || raw.source === 'browser') && typeof raw.action === 'string') {
    return { ...raw, index: finiteIndex(raw.index, index) }
  }
  const code = typeof raw === 'string' ? raw : (raw?.code ?? null)
  const snapshot = typeof raw === 'object' ? (raw?.snapshot ?? null) : null
  const url = typeof raw === 'object' ? (raw?.url ?? null) : null
  const kind = typeof raw === 'object' ? (raw?.kind ?? null) : null
  const codeUrl = typeof code === 'string' ? (code.match(/(https?:\/\/[^'"\s)]+)/)?.[1] ?? null) : null
  const action = browserActionOf(code, kind)
  const where = url ?? codeUrl ?? (typeof raw === 'object' ? (raw?.application ?? null) : null)
  const detail = code
    ? firstLine(code).slice(0, 120)
    : (typeof snapshot === 'string' ? `snapshot ${snapshot.length} chars` : action)
  return {
    index: finiteIndex(typeof raw === 'object' ? raw?.index : null, index),
    time: (typeof raw === 'object' && raw?.time) ?? null,
    source: 'browser',
    application: hostOf(where ?? '') ?? where,
    windowTitle: url,
    action,
    description: `Browser ${action}${where ? ` ${where}` : ''} :: ${detail}`,
    locator: (typeof raw === 'object' && raw?.locator) ?? null,
    code,
    text: plaintextOf(code),
    screenshotFile: null,
  }
}

export const normalizeEvent = (raw, index, source = 'desktop') => (
  source === 'browser' ? normalizeBrowserEvent(raw, index) : normalizeDesktopEvent(raw, index)
)

export const renumberEvents = (events) => events.map((event, position) => ({ ...event, index: position + 1 }))

export function buildTranscript(events) {
  return events.map((event) => {
    const number = String(event.index ?? 0).padStart(2, '0')
    return `${number} [${event.source}|${event.application ?? '-'}] ${event.action} — ${event.description}`
  }).join('\n')
}

export function buildReplayScript(events) {
  return events.map((event) => {
    if (event.source === 'browser' && event.code) return event.code
    return `// DESKTOP ${event.index}: [${event.application ?? '-'}] ${event.action} — ${event.description}`
  }).join('\n')
}

export class UnifiedSessionNode extends Node {
  constructor(
    id = 'example.unified-recorder/session',
    targets = {
      execution: 'example.unified-recorder/execution',
      observation: 'example.unified-recorder/observation',
    },
  ) {
    super(id, 'UnifiedRecordingSession', {
      status: 'idle',
      sessionId: null,
      sources: [...VALID_SOURCES],
      handles: { desktop: null, browser: null },
      eventCount: 0,
      events: [],
      applications: [],
      artifactPath: null,
      sessionDir: null,
      agentTranscriptPath: null,
      agentTranscriptContent: null,
      screenshotsDirectory: null,
      nativeExports: { browser: null, desktop: null },
      browserActions: null,
      startedAt: null,
      completedAt: null,
      lastEvent: null,
      lastError: null,
      progressLog: [],
    })
    this.executionId = targets.execution
    this.observationId = targets.observation
  }

  change(info, ctx) {
    if (info.type === 'StartRecordingInfo') {
      if (ctx.read('status') !== 'idle' && ctx.read('status') !== 'error') {
        ctx.write('lastError', 'a recording is already active')
        return
      }
      const sessionId = typeof info.sessionId === 'string' && info.sessionId.trim().length > 0
        ? info.sessionId.trim()
        : this.id
      const sources = Array.isArray(info.sources) && info.sources.length > 0
        ? [...new Set(info.sources.filter((source) => VALID_SOURCES.includes(source)))]
        : [...VALID_SOURCES]
      ctx.patchState({
        status: 'starting',
        sessionId,
        sources,
        handles: { desktop: null, browser: null },
        eventCount: 0,
        events: [],
        applications: [],
        artifactPath: null,
        sessionDir: null,
        agentTranscriptPath: null,
        agentTranscriptContent: null,
        screenshotsDirectory: null,
        nativeExports: { browser: null, desktop: null },
        browserActions: null,
        startedAt: null,
        completedAt: null,
        lastEvent: null,
        lastError: null,
        progressLog: [{ at: new Date().toISOString(), stage: 'start-requested', sessionId }],
      })
      ctx.send({ type: 'StartCaptureInfo', sessionId, sources }, this.executionId)
    } else if (info.type === 'StopRecordingInfo') {
      if (ctx.read('status') !== 'recording') {
        ctx.write('lastError', 'no active recording to stop')
        return
      }
      ctx.patchState({ status: 'stopping', lastError: null })
      ctx.send(
        { type: 'StopCaptureInfo', sessionId: ctx.read('sessionId'), sources: ctx.read('sources') },
        this.executionId,
      )
    } else if (info.type === 'RecordingStartedInfo') {
      ctx.patchState({
        status: 'recording',
        handles: {
          desktop: info.desktopHandle ?? null,
          browser: info.browserHandle ?? null,
        },
        artifactPath: info.artifactPath ?? null,
        sessionDir: info.sessionDir ?? null,
        startedAt: info.startedAt ?? null,
        lastError: info.error ?? null,
      })
    } else if (info.type === 'RecordingStoppedInfo') {
      const browserActions = info.browserActions ?? ctx.read('browserActions')
      const sessionDir = info.sessionDir ?? ctx.read('sessionDir')
      const artifactPath = info.artifactPath ?? ctx.read('artifactPath')
      const liveEvents = (Array.isArray(info.liveEvents) && info.liveEvents.length > 0)
        ? info.liveEvents
        : (ctx.read('events') ?? [])
      ctx.patchState({
        status: 'processing',
        browserActions,
        artifactPath,
        sessionDir,
        lastError: info.error ?? null,
        progressLog: [...(ctx.read('progressLog') ?? []), { at: new Date().toISOString(), stage: 'merging', sessionId: info.sessionId }],
      })
      // 触发 ObservationWorldNode 进行后处理、截图解压与 Agent Transcript 写入
      ctx.send(
        {
          type: 'ObserveRecordingInfo',
          sessionId: info.sessionId,
          sessionDir,
          artifactPath,
          browserActions,
          liveEvents,
          startedAt: ctx.read('startedAt'),
          completedAt: info.completedAt ?? new Date().toISOString(),
        },
        this.observationId,
      )
    } else if (info.type === 'RecordingObservedInfo') {
      const incomingEvents = Array.isArray(info.events) ? info.events : []
      const hasBrowser = incomingEvents.some((e) => e.source === 'browser')
      let mergedEvents = hasBrowser
        ? incomingEvents
        : renumberEvents([
            ...ctx.read('events').filter((e) => e.source === 'browser'),
            ...incomingEvents.map((e, pos) => normalizeDesktopEvent(e, pos + 1)),
          ])
      if (mergedEvents.length === 0 && ctx.read('events').length > 0) {
        mergedEvents = ctx.read('events')
      }
      const existingApps = ctx.read('applications') ?? []
      const incomingApps = Array.isArray(info.applications) ? info.applications : []
      const eventApps = mergedEvents.map((e) => e.application).filter(Boolean)
      const applications = [...new Set([...existingApps, ...incomingApps, ...eventApps])]

      ctx.patchState({
        status: 'idle',
        eventCount: mergedEvents.length,
        events: mergedEvents,
        applications,
        artifactPath: info.sessionDirectory ?? info.artifactPath ?? ctx.read('artifactPath'),
        sessionDir: info.sessionDirectory ?? ctx.read('sessionDir'),
        agentTranscriptPath: info.agentTranscriptPath ?? null,
        agentTranscriptContent: info.agentTranscriptContent ?? null,
        screenshotsDirectory: info.screenshotsDirectory ?? null,
        nativeExports: info.nativeExports ?? ctx.read('nativeExports'),
        completedAt: info.completedAt ?? new Date().toISOString(),
        lastEvent: mergedEvents.at(-1) ?? null,
        lastError: null,
      })
    } else if (info.type === 'RecordingProgressInfo') {
      if (typeof info.sessionId === 'string' && (ctx.read('sessionId') ?? info.sessionId) !== info.sessionId) return
      const entry = { at: new Date().toISOString(), stage: info.stage ?? 'merging', ...(info.count != null ? { count: info.count } : {}) }
      ctx.patchState({ progressLog: [...(ctx.read('progressLog') ?? []), entry].slice(-50) })
    } else if (info.type === 'RecordingEventInfo') {
      const event = info.event ?? null
      if (!event) return
      const normalized = normalizeEvent(event, ctx.read('events').length + 1, info.source ?? event.source ?? 'desktop')
      normalized.index = ctx.read('events').length + 1
      const events = [...ctx.read('events'), normalized]
      const applications = normalized.application && !ctx.read('applications').includes(normalized.application)
        ? [...ctx.read('applications'), normalized.application]
        : ctx.read('applications')
      ctx.patchState({
        eventCount: events.length,
        events,
        applications,
        lastEvent: normalized,
        lastError: null,
      })
    } else if (info.type === 'RecordingFailedInfo') {
      ctx.patchState({ status: 'error', lastError: info.message ?? 'recording failed' })
    }
  }
}
const pickSources = (info) => (
  Array.isArray(info?.sources) && info.sources.length > 0
    ? [...new Set(info.sources.filter((source) => VALID_SOURCES.includes(source)))]
    : [...VALID_SOURCES]
)

export class UnifiedCaptureNode extends ExecutionWorldNode {
  constructor(
    id = 'example.unified-recorder/execution',
    sessionId = 'example.unified-recorder/session',
    adapters = {},
  ) {
    super(id, 'UnifiedRecordingCapture', {
      lastOp: null,
      lastDesktopHandle: null,
      lastBrowserHandle: null,
      lastArtifactPath: null,
      lastSessionDir: null,
      lastError: null,
    })
    this.sessionId = sessionId
    this.desktopControl = adapters.desktopControl ?? missingAdapter(DESKTOP_CONTROL_ADAPTER_ID)
    this.browserControl = adapters.browserControl ?? missingAdapter(BROWSER_CONTROL_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type === 'StartCaptureInfo') {
      const sources = pickSources(info)
      const tasks = {}
      if (sources.includes('desktop')) tasks.desktop = ctx.effectAdapter(this.desktopControl, { op: 'start', sessionId: info.sessionId })
      if (sources.includes('browser')) tasks.browser = ctx.effectAdapter(this.browserControl, { op: 'start', sessionId: info.sessionId })
      const keys = Object.keys(tasks)
      const settled = await Promise.allSettled(keys.map((key) => tasks[key]))
      const values = Object.fromEntries(settled.map((result, position) => [keys[position], result]))
      const failures = Object.entries(values)
        .filter(([, result]) => result.status === 'rejected')
        .map(([key, result]) => `${key}: ${errorMessage(result.reason)}`)
      if (failures.length === keys.length && keys.length > 0) {
        const message = failures.join('; ')
        ctx.patchState({ lastOp: 'start', lastError: message })
        ctx.send({ type: 'RecordingFailedInfo', phase: 'start', message }, this.sessionId)
        return
      }
      const desktop = values.desktop?.status === 'fulfilled' ? values.desktop.value : null
      const browser = values.browser?.status === 'fulfilled' ? values.browser.value : null
      ctx.patchState({
        lastOp: 'start',
        lastDesktopHandle: desktop?.handle ?? null,
        lastBrowserHandle: browser?.handle ?? null,
        lastArtifactPath: desktop?.artifactPath ?? null,
        lastSessionDir: desktop?.sessionDir ?? null,
        lastError: failures.length > 0 ? failures.join('; ') : null,
      })
      ctx.send(
        {
          type: 'RecordingStartedInfo',
          sessionId: info.sessionId,
          desktopHandle: desktop?.handle ?? null,
          browserHandle: browser?.handle ?? null,
          artifactPath: desktop?.artifactPath ?? null,
          sessionDir: desktop?.sessionDir ?? null,
          startedAt: desktop?.startedAt ?? new Date().toISOString(),
          ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
        },
        this.sessionId,
      )
    } else if (info.type === 'StopCaptureInfo') {
      const sources = pickSources(info)
      const tasks = {}
      if (sources.includes('desktop')) tasks.desktop = ctx.effectAdapter(this.desktopControl, { op: 'stop', sessionId: info.sessionId })
      if (sources.includes('browser')) tasks.browser = ctx.effectAdapter(this.browserControl, { op: 'stop', sessionId: info.sessionId })
      const keys = Object.keys(tasks)
      const settled = await Promise.allSettled(keys.map((key) => tasks[key]))
      const values = Object.fromEntries(settled.map((result, position) => [keys[position], result]))
      const failures = Object.entries(values)
        .filter(([, result]) => result.status === 'rejected')
        .map(([key, result]) => `${key}: ${errorMessage(result.reason)}`)
      const desktop = values.desktop?.status === 'fulfilled' ? values.desktop.value : null
      const browser = values.browser?.status === 'fulfilled' ? values.browser.value : null
      const browserActions = typeof browser?.actions === 'string' ? browser.actions : null
      const artifactPath = desktop?.artifactPath ?? ctx.read('lastArtifactPath')
      const sessionDir = desktop?.sessionDir ?? ctx.read('lastSessionDir')
      ctx.patchState({
        lastOp: 'stop',
        lastArtifactPath: artifactPath,
        lastSessionDir: sessionDir,
        lastError: failures.length > 0 ? failures.join('; ') : null,
      })
      ctx.send(
        {
          type: 'RecordingStoppedInfo',
          sessionId: info.sessionId,
          artifactPath,
          sessionDir,
          browserActions,
          liveEvents: desktop?.liveEvents ?? [],
          completedAt: new Date().toISOString(),
          ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
        },
        this.sessionId,
      )
    }
  }
}

export class UnifiedObserverNode extends ObservationWorldNode {
  constructor(
    id = 'example.unified-recorder/observation',
    sessionId = 'example.unified-recorder/session',
    adapters = {},
  ) {
    super(id, 'UnifiedRecordingObserver', { lastCount: 0, lastArtifactPath: null, lastError: null })
    this.sessionId = sessionId
    this.desktopObservation = adapters.desktopObservation ?? missingAdapter(DESKTOP_OBSERVATION_ADAPTER_ID)
    this.desktopEvents = adapters.desktopEvents ?? missingAdapter(DESKTOP_EVENTS_ADAPTER_ID)
    this.browserEvents = adapters.browserEvents ?? missingAdapter(BROWSER_EVENTS_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type === 'PollUnifiedEventsInfo') {
      const sources = pickSources(info)
      const polls = []
      if (sources.includes('desktop')) {
        polls.push(
          ctx.effectAdapter(this.desktopEvents, { op: 'poll', sessionId: info.sessionId }).then(
            (observation) => ({ source: 'desktop', observation }),
            (error) => ({ source: 'desktop', error }),
          ),
        )
      }
      if (sources.includes('browser')) {
        polls.push(
          ctx.effectAdapter(this.browserEvents, { op: 'poll', sessionId: info.sessionId, cursor: info.cursor ?? null }).then(
            (observation) => ({ source: 'browser', observation }),
            (error) => ({ source: 'browser', error }),
          ),
        )
      }
      const batches = await Promise.all(polls)
      let delivered = 0
      const errors = []
      for (const batch of batches) {
        if (batch.error) {
          errors.push(`${batch.source}: ${errorMessage(batch.error)}`)
          continue
        }
        const events = Array.isArray(batch.observation?.events) ? batch.observation.events : []
        for (const event of events) {
          ctx.send({ type: 'RecordingEventInfo', sessionId: info.sessionId, source: batch.source, event }, this.sessionId)
          delivered += 1
        }
      }
      ctx.patchState({
        lastCount: ctx.read('lastCount') + delivered,
        lastError: errors.length > 0 ? errors.join('; ') : null,
      })
      return
    }

    if (info.type !== 'ObserveRecordingInfo') return

    try {
      const emitProgress = (stage, extra = {}) => {
        ctx.send(
          { type: 'RecordingProgressInfo', sessionId: info.sessionId, stage, ...extra },
          this.sessionId,
        )
      }
      emitProgress('merge-started')
      const observation = await ctx.effectAdapter(this.desktopObservation, {
        op: 'observe',
        sessionId: info.sessionId,
        sessionDir: info.sessionDir,
        artifactPath: info.artifactPath,
        browserActions: info.browserActions,
        liveEvents: info.liveEvents,
        startedAt: info.startedAt,
        completedAt: info.completedAt,
        onProgress: (report) => {
          emitProgress(report?.stage ?? 'merging', { count: report?.count ?? null })
        },
      })
      const events = Array.isArray(observation?.events) ? observation.events : []
      ctx.patchState({
        lastCount: ctx.read('lastCount') + events.length,
        lastArtifactPath: info.artifactPath ?? info.sessionDir,
        lastError: null,
      })
      ctx.send(
        {
          type: 'RecordingObservedInfo',
          sessionId: info.sessionId,
          artifactPath: observation?.artifactPath ?? info.artifactPath,
          sessionDirectory: observation?.sessionDirectory ?? info.sessionDir,
          events,
          applications: Array.isArray(observation?.applications) ? observation.applications : [],
          agentTranscriptPath: observation?.agentTranscriptPath ?? null,
          agentTranscriptContent: observation?.agentTranscriptContent ?? null,
          screenshotsDirectory: observation?.screenshotsDirectory ?? null,
          nativeExports: observation?.nativeExports ?? { browser: null, desktop: null },
          completedAt: observation?.completedAt ?? new Date().toISOString(),
        },
        this.sessionId,
      )
    } catch (error) {
      const message = errorMessage(error)
      ctx.patchState({ lastError: message })
      ctx.send({ type: 'RecordingFailedInfo', phase: 'observe', message }, this.sessionId)
    }
  }
}

export function createUnifiedRecorder(ctx) {
  const idFor = (local) => {
    if (ctx && typeof ctx.nodeIdFor === 'function') return ctx.nodeIdFor(local)
    if (ctx && typeof ctx.instanceId === 'string' && ctx.instanceId) return `${ctx.instanceId}/${local}`
    return `example.unified-recorder/${local}`
  }
  const dependencies = ctx?.dependencies ?? {}
  const session = new UnifiedSessionNode(idFor('session'), {
    execution: idFor('execution'),
    observation: idFor('observation'),
  })
  const execution = new UnifiedCaptureNode(idFor('execution'), idFor('session'), {
    desktopControl: dependencies.desktopControl,
    browserControl: dependencies.browserControl,
  })
  const observation = new UnifiedObserverNode(idFor('observation'), idFor('session'), {
    desktopObservation: dependencies.desktopObservation,
    desktopEvents: dependencies.desktopEvents,
    browserEvents: dependencies.browserEvents,
  })
  return { session, execution, observation }
}

export const createUnifiedRecorderGraph = (ctx) => Object.values(createUnifiedRecorder(ctx))
createUnifiedRecorderGraph.describe = () => ({
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
  && (info.sources === undefined || (Array.isArray(info.sources) && info.sources.every((source) => VALID_SOURCES.includes(source))))
const isStopRecordingInfo = (info) => info?.type === 'StopRecordingInfo'

export default defineBackendPlugin({
  id: 'example.unified-recorder',
  createNodes: (context) => Object.values(createUnifiedRecorder(context)),
  rendererRoots: [
    {
      targetNodeId: 'example.unified-recorder/session',
      infoType: 'StartRecordingInfo',
      validate: isStartRecordingInfo,
    },
    {
      targetNodeId: 'example.unified-recorder/session',
      infoType: 'StopRecordingInfo',
      validate: isStopRecordingInfo,
    },
  ],
})
