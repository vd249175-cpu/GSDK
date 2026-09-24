import { ExecutionWorldNode, Node } from '@graphframework/sdk/plugin'
import { missingAdapter } from './stages.mjs'

export const WORLD_DOCUMENT_ADAPTER_ID = 'smoke/world-document'
const messageFor = (error) => error instanceof Error ? error.message : String(error)

export class DocEditGateNode extends Node {
  constructor(id, sessionId, docExecutionId) {
    super(id, 'DocEditGate', { pendingConfirmation: null })
    this.sessionId = sessionId
    this.docExecutionId = docExecutionId
  }

  change(info, ctx) {
    if (info.type === 'PrepareDocEditInfo') {
      ctx.patchState({ pendingConfirmation: {
        step: 'edit-doc', requestId: info.requestId,
        docName: info.docName, text: info.text,
        browserResult: info.browserResult,
        prompt: `浏览器已就绪，确认后将编辑并保存文档 ${info.docName}`,
      } })
      ctx.send({ type: 'DocEditPendingInfo', requestId: info.requestId }, this.sessionId)
      return
    }
    if (info.type !== 'ConfirmStepInfo') return
    const pending = ctx.read('pendingConfirmation')
    if (!pending || info.requestId !== pending.requestId || info.step !== 'edit-doc'
      || !['approve', 'reject'].includes(info.decision)) return
    ctx.patchState({ pendingConfirmation: null })
    if (info.decision === 'approve') {
      ctx.send({ type: 'ExecuteDocEditInfo', requestId: pending.requestId,
        docName: pending.docName,
        text: typeof info.text === 'string' ? info.text : pending.text,
        browserResult: pending.browserResult }, this.docExecutionId)
    } else if (info.decision === 'reject') {
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: pending.requestId,
        phase: 'doc-edit-confirmation',
        message: info.message ?? '关键步骤 edit-doc 已被拒绝' }, this.sessionId)
    }
  }
}

export class WorldSaveReviewNode extends Node {
  constructor(id, sessionId, worldExecutionId) {
    super(id, 'WorldSaveReview', { pendingConfirmation: null })
    this.sessionId = sessionId
    this.worldExecutionId = worldExecutionId
  }

  change(info, ctx) {
    if (info.type === 'PrepareWorldReviewInfo') {
      ctx.patchState({ pendingConfirmation: {
        step: 'save-world', requestId: info.requestId,
        prompt: '本次浏览器与电脑操作测试已完成。是否保存 world 文档？',
        browserResult: info.browserResult, docResult: info.docResult,
        desktopActionResult: info.desktopActionResult,
        observation: info.observation,
      } })
      return
    }
    const pending = ctx.read('pendingConfirmation')
    if (!pending || info.requestId !== pending.requestId) return
    if (info.type === 'AgentReviewFailedInfo') {
      ctx.patchState({ pendingConfirmation: null })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId,
        phase: 'agent-review', message: info.message ?? 'agent review failed' }, this.sessionId)
      return
    }
    if (info.type !== 'WorldSaveDecisionInfo' || !['approve', 'reject'].includes(info.decision)) return
    ctx.patchState({ pendingConfirmation: null })
    if (info.decision === 'reject') {
      ctx.send({ type: 'WorldSaveRejectedInfo', requestId: info.requestId }, this.sessionId)
      return
    }
    ctx.send({ type: 'WorldSaveApprovedInfo', requestId: info.requestId }, this.sessionId)
    ctx.send({ type: 'SaveWorldDocumentInfo', requestId: info.requestId,
      text: typeof info.text === 'string' ? info.text : '',
      browserResult: pending.browserResult, docResult: pending.docResult,
      desktopActionResult: pending.desktopActionResult,
      observation: pending.observation }, this.worldExecutionId)
  }
}

export class WorldDocumentExecutionNode extends ExecutionWorldNode {
  constructor(id, sessionId, adapter) {
    super(id, 'WorldDocumentExecution', { lastRequestId: null, lastResult: null, lastError: null })
    this.sessionId = sessionId
    this.worldDocument = adapter ?? missingAdapter(WORLD_DOCUMENT_ADAPTER_ID)
  }

  async change(info, ctx) {
    if (info.type !== 'SaveWorldDocumentInfo') return
    try {
      const result = await ctx.effectAdapter(this.worldDocument, {
        requestId: info.requestId, text: info.text,
        browserResult: info.browserResult, docResult: info.docResult,
        desktopActionResult: info.desktopActionResult,
        observation: info.observation,
      })
      ctx.patchState({ lastRequestId: info.requestId, lastResult: result ?? null, lastError: null })
      ctx.send({ type: 'WorldDocumentSavedInfo', requestId: info.requestId, result: result ?? null }, this.sessionId)
    } catch (error) {
      const message = messageFor(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'SmokeTestFailedInfo', requestId: info.requestId, phase: 'save-world', message }, this.sessionId)
    }
  }
}
