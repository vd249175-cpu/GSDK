import { ExecutionWorldNode, ObservationWorldNode } from '@graphframework/sdk/plugin'

export const BROWSER_NAVIGATE_ADAPTER_ID = 'browser/executor'
export const DESKTOP_CONTROL_ADAPTER_ID = 'smoke/desktop-control'
export const DESKTOP_OBSERVATION_ADAPTER_ID = 'smoke/desktop-observation'

export const missingAdapter = (id) => ({ id, execute: async () => {
  throw new Error(`EffectAdapter ${id} was not injected by the named run host`)
} })
const messageFor = (error) => error instanceof Error ? error.message : String(error)

export class BrowserCheckExecutionNode extends ExecutionWorldNode {
  constructor(id, sessionId, desktopId, docGateId, adapter) {
    super(id, 'BrowserCheckExecution', { lastRequestId: null, lastResult: null, lastError: null })
    this.sessionId = sessionId
    this.desktopId = desktopId
    this.docGateId = docGateId
    this.browserNavigate = adapter ?? missingAdapter(BROWSER_NAVIGATE_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type !== 'ExecuteBrowserCheckInfo') return
    try {
      const result = await ctx.effectAdapter(this.browserNavigate,
        { task: 'check-home', requestId: info.requestId, url: info.npmUrl })
      ctx.patchState({ lastRequestId: info.requestId, lastResult: result ?? null, lastError: null })
      ctx.send({ type: 'BrowserCheckedInfo', requestId: info.requestId, result: result ?? null }, this.sessionId)
      if (info.skipDocEdit) {
        ctx.send({ type: 'ExecuteDesktopFocusInfo', requestId: info.requestId,
          browserResult: result ?? null, titleContains: info.desktopWindowTitle }, this.desktopId)
      } else {
        ctx.send({ type: 'PrepareDocEditInfo', requestId: info.requestId,
          browserResult: result ?? null, docName: info.docName, text: info.docText }, this.docGateId)
      }
    } catch (error) {
      const message = messageFor(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'browser', message }, this.sessionId)
    }
  }
}

export class DesktopFocusExecutionNode extends ExecutionWorldNode {
  constructor(id, sessionId, observationId, adapter) {
    super(id, 'DesktopFocusExecution', { lastRequestId: null, lastResult: null, lastError: null })
    this.sessionId = sessionId
    this.observationId = observationId
    this.desktopControl = adapter ?? missingAdapter(DESKTOP_CONTROL_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type !== 'ExecuteDesktopFocusInfo') return
    try {
      const result = await ctx.effectAdapter(this.desktopControl, { requestId: info.requestId,
        action: { command: 'focus_window', window: { titleContains: info.titleContains } } })
      ctx.patchState({ lastRequestId: info.requestId, lastResult: result ?? null, lastError: null })
      ctx.send({ type: 'DesktopFocusedInfo', requestId: info.requestId, result: result ?? null }, this.sessionId)
      ctx.send({ type: 'ObserveDesktopInfo', requestId: info.requestId, mode: 'desktop',
        browserResult: info.browserResult, desktopActionResult: result ?? null, docResult: null }, this.observationId)
    } catch (error) {
      const message = messageFor(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'desktop-action', message }, this.sessionId)
    }
  }
}

export class DocEditExecutionNode extends ExecutionWorldNode {
  constructor(id, sessionId, observationId, adapter) {
    super(id, 'DocEditExecution', { lastRequestId: null, lastResult: null, lastError: null })
    this.sessionId = sessionId
    this.observationId = observationId
    this.desktopControl = adapter ?? missingAdapter(DESKTOP_CONTROL_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type !== 'ExecuteDocEditInfo') return
    try {
      const result = await ctx.effectAdapter(this.desktopControl,
        { requestId: info.requestId, docName: info.docName, text: info.text })
      ctx.patchState({ lastRequestId: info.requestId, lastResult: result ?? null, lastError: null })
      ctx.send({ type: 'DocEditedInfo', requestId: info.requestId, result: result ?? null }, this.sessionId)
      ctx.send({ type: 'ObserveDesktopInfo', requestId: info.requestId, mode: 'selected-window',
        browserResult: info.browserResult, docResult: result ?? null, desktopActionResult: null }, this.observationId)
    } catch (error) {
      const message = messageFor(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'doc-edit', message }, this.sessionId)
    }
  }
}

export class DesktopSmokeObservationNode extends ObservationWorldNode {
  constructor(id, sessionId, reviewId, adapter) {
    super(id, 'DesktopSmokeObservation', { lastRequestId: null, lastWindowCount: 0, lastError: null })
    this.sessionId = sessionId
    this.reviewId = reviewId
    this.desktopObservation = adapter ?? missingAdapter(DESKTOP_OBSERVATION_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type !== 'ObserveDesktopInfo') return
    try {
      const observation = await ctx.effectAdapter(this.desktopObservation, {
        requestId: info.requestId, mode: info.mode,
      })
      ctx.patchState({ lastRequestId: info.requestId,
        lastWindowCount: Array.isArray(observation?.windows) ? observation.windows.length : 0,
        lastError: null })
      ctx.send({ type: 'DesktopObservedInfo', requestId: info.requestId,
        observation: observation ?? {} }, this.sessionId)
      ctx.send({ type: 'PrepareWorldReviewInfo', requestId: info.requestId,
        browserResult: info.browserResult, docResult: info.docResult,
        desktopActionResult: info.desktopActionResult, observation: observation ?? {} }, this.reviewId)
    } catch (error) {
      const message = messageFor(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'observe', message }, this.sessionId)
    }
  }
}
