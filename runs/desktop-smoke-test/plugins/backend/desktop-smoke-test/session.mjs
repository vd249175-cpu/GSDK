import { Node } from '@graphframework/sdk/plugin'

const initial = () => ({
  status: 'idle', requestId: null, npmUrl: null, docName: null, docText: '',
  skipDocEdit: false, browserResult: null, docResult: null,
  desktopActionResult: null, observation: null, worldDocument: null,
  completedAt: null, lastError: null,
})

export class DesktopSmokeEntryNode extends Node {
  constructor(id, sessionId, browserId) {
    super(id, 'DesktopSmokeEntry', { lastRequestId: null })
    this.sessionId = sessionId
    this.browserId = browserId
  }

  change(info, ctx) {
    if (info.type !== 'TriggerSmokeTest') return
    const requestId = info.requestId ?? 'smoke-1'
    const request = {
      requestId, npmUrl: info.npmUrl ?? 'https://www.npmjs.com/',
      docName: info.docName ?? '开发步骤.docx',
      docText: typeof info.docText === 'string' ? info.docText : '',
      skipDocEdit: info.skipDocEdit === true,
      desktopWindowTitle: typeof info.desktopWindowTitle === 'string' && info.desktopWindowTitle.trim()
        ? info.desktopWindowTitle.trim() : 'GraphFramework',
    }
    ctx.patchState({ lastRequestId: requestId })
    ctx.send({ type: 'SmokeStartedInfo', ...request }, this.sessionId)
    ctx.send({ type: 'ExecuteBrowserCheckInfo', ...request }, this.browserId)
  }
}

export class DesktopSmokeSessionNode extends Node {
  constructor(id) {
    super(id, 'DesktopSmokeSession', initial())
  }

  change(info, ctx) {
    if (info.type === 'SmokeStartedInfo') {
      const previous = ctx.read('requestId')
      const sameRequest = previous === info.requestId
      ctx.patchState({
        ...(sameRequest ? {} : initial()),
        requestId: info.requestId, npmUrl: info.npmUrl,
        docName: info.docName, docText: info.docText,
        skipDocEdit: info.skipDocEdit,
        status: sameRequest && ctx.read('status') !== 'idle' ? ctx.read('status') : 'checking-browser',
      })
      return
    }
    if (info.requestId !== ctx.read('requestId')) return
    if (info.type === 'BrowserCheckedInfo') {
      ctx.patchState({ browserResult: info.result ?? null,
        status: ctx.read('skipDocEdit') ? 'focusing-desktop' : 'awaiting-confirmation' })
    } else if (info.type === 'DocEditPendingInfo') {
      ctx.patchState({ status: 'awaiting-confirmation' })
    } else if (info.type === 'DesktopFocusedInfo') {
      ctx.patchState({ status: 'observing', desktopActionResult: info.result ?? null })
    } else if (info.type === 'DocEditedInfo') {
      ctx.patchState({ status: 'observing', docResult: info.result ?? null })
    } else if (info.type === 'DesktopObservedInfo') {
      ctx.patchState({ status: 'awaiting-world-save', observation: info.observation ?? null })
    } else if (info.type === 'WorldSaveApprovedInfo') {
      ctx.patchState({ status: 'saving-world' })
    } else if (info.type === 'WorldSaveRejectedInfo') {
      ctx.patchState({ status: 'done', completedAt: ctx.read('observation')?.observedAt ?? null })
    } else if (info.type === 'WorldDocumentSavedInfo') {
      ctx.patchState({ status: 'done', worldDocument: info.result ?? null,
        completedAt: ctx.read('observation')?.observedAt ?? null })
    } else if (info.type === 'SmokeTestFailedInfo') {
      ctx.patchState({ status: 'error', completedAt: null, lastError: info.message ?? 'smoke test failed' })
    }
  }
}
