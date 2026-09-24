import { Node, ExecutionWorldNode, ObservationWorldNode, defineBackendPlugin } from '@graphframework/sdk/plugin'

const absent = (id) => ({ id, execute: async () => { throw new Error(`Missing EffectAdapter ${id}`) } })
const errorText = (error) => error instanceof Error ? error.message : String(error)

export class BrowserTaskSessionNode extends Node {
  constructor(id, executionId) {
    super(id, 'BrowserTaskSession', { status: 'idle', requestId: null, task: null })
    this.executionId = executionId
  }

  change(info, ctx) {
    if (info.type === 'RunBrowserTaskInfo') {
      if (typeof info.requestId !== 'string' || typeof info.task !== 'string') return
      ctx.patchState({ status: 'submitted', requestId: info.requestId, task: info.task })
      ctx.send({ type: 'ExecuteBrowserTaskInfo', requestId: info.requestId,
        task: info.task, args: info.args ?? {} }, this.executionId)
    }
  }
}

export class BrowserTaskResultNode extends Node {
  constructor(id) {
    super(id, 'BrowserTaskResult', { status: 'idle', requestId: null,
      result: null, observation: null, lastError: null })
  }

  change(info, ctx) {
    if (info.type === 'BrowserTaskObservedInfo') {
      ctx.patchState({ status: 'done', requestId: info.requestId,
        result: info.result ?? null, observation: info.observation ?? null, lastError: null })
    } else if (info.type === 'BrowserTaskFailedInfo') {
      ctx.patchState({ status: 'error', requestId: info.requestId, lastError: info.message })
    }
  }
}

export class BrowserTaskExecutionNode extends ExecutionWorldNode {
  constructor(id, observationId, resultId, adapter) {
    super(id, 'BrowserTaskExecution', { lastRequestId: null, lastError: null })
    this.observationId = observationId
    this.resultId = resultId
    this.browserExecution = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'ExecuteBrowserTaskInfo') return
    try {
      const result = await ctx.effectAdapter(this.browserExecution, {
        requestId: info.requestId, task: info.task, ...info.args,
      })
      ctx.patchState({ lastRequestId: info.requestId, lastError: null })
      ctx.send({ type: 'BrowserTaskExecutedInfo', requestId: info.requestId, result }, this.observationId)
    } catch (error) {
      const message = errorText(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'BrowserTaskFailedInfo', requestId: info.requestId, message }, this.resultId)
    }
  }
}

export class BrowserTaskObservationNode extends ObservationWorldNode {
  constructor(id, resultId, adapter) {
    super(id, 'BrowserTaskObservation', { lastRequestId: null, lastError: null })
    this.resultId = resultId
    this.browserObservation = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'BrowserTaskExecutedInfo') return
    try {
      const observation = await ctx.effectAdapter(this.browserObservation, { requestId: info.requestId })
      ctx.patchState({ lastRequestId: info.requestId, lastError: null })
      ctx.send({ type: 'BrowserTaskObservedInfo', requestId: info.requestId,
        result: info.result, observation }, this.resultId)
    } catch (error) {
      const message = errorText(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'BrowserTaskFailedInfo', requestId: info.requestId, message }, this.resultId)
    }
  }
}

export function createBrowserExecutorGraph(ctx) {
  const idFor = (local) => ctx?.nodeIdFor?.(local) ?? `${ctx?.instanceId ?? 'browser'}/${local}`
  return [
    new BrowserTaskSessionNode(idFor('session'), idFor('execution')),
    new BrowserTaskExecutionNode(idFor('execution'), idFor('observation'), idFor('result'),
      ctx?.dependencies?.browserExecution ?? absent('browser/execution')),
    new BrowserTaskObservationNode(idFor('observation'), idFor('result'),
      ctx?.dependencies?.browserObservation ?? absent('browser/observation')),
    new BrowserTaskResultNode(idFor('result')),
  ]
}
createBrowserExecutorGraph.describe = () => ({ kind: 'graph', localIds: ['session', 'execution', 'observation', 'result'],
  requiredBindings: [], rendererRoots: [{ localId: 'session', infoType: 'RunBrowserTaskInfo' }] })

export default defineBackendPlugin({ id: 'example.browser-executor', createNodes: createBrowserExecutorGraph,
  rendererRoots: [{ targetNodeId: 'browser/session', infoType: 'RunBrowserTaskInfo',
    validate: (info) => info?.type === 'RunBrowserTaskInfo' && typeof info.requestId === 'string'
      && typeof info.task === 'string' }],
})
