import { Node, ExecutionWorldNode, ObservationWorldNode, defineBackendPlugin } from '@graphframework/sdk/plugin'
import { parseAgentSeatCount } from './seat-config.mjs'

const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
const failed = (error) => error instanceof Error ? error.message : String(error)
const absent = (id) => ({ id, execute: async () => { throw new Error(`Missing EffectAdapter ${id}`) } })
const seatFor = (value, count) => [...value].reduce((sum, char) => sum + char.codePointAt(0), 0) % count

export class AgentSessionNode extends Node {
  constructor(id, executionIds, executionSeatCount, promptSections) {
    super(id, 'AgentSession', { threads: {} })
    this.execution0 = executionIds[0]
    this.execution1 = executionIds[1]
    this.execution2 = executionIds[2]
    this.execution3 = executionIds[3]
    this.executionSeatCount = executionSeatCount
    this.promptSections = promptSections
  }

  change(info, ctx) {
    if (info.type === 'AgentInputInfo') {
      if (!validId(info.threadId) || !validId(info.requestId) || typeof info.text !== 'string') return
      if (info.attachments !== undefined && !Array.isArray(info.attachments)) return
      if (info.promptSections !== undefined && (!Array.isArray(info.promptSections)
        || info.promptSections.some((part) => typeof part !== 'string'))) return
      const threads = ctx.read('threads')
      ctx.patchState({ threads: { ...threads, [info.threadId]: {
        requestId: info.requestId, status: 'submitted',
      } } })
      const seat = seatFor(info.threadId, this.executionSeatCount)
      if (seat === 0) ctx.send({ type: 'RunAgentInfo', threadId: info.threadId, requestId: info.requestId,
        text: info.text, attachments: info.attachments ?? [],
        prompts: [...this.promptSections, ...(info.promptSections ?? [])] }, this.execution0)
      else if (seat === 1) ctx.send({ type: 'RunAgentInfo', threadId: info.threadId, requestId: info.requestId,
        text: info.text, attachments: info.attachments ?? [],
        prompts: [...this.promptSections, ...(info.promptSections ?? [])] }, this.execution1)
      else if (seat === 2) ctx.send({ type: 'RunAgentInfo', threadId: info.threadId, requestId: info.requestId,
        text: info.text, attachments: info.attachments ?? [],
        prompts: [...this.promptSections, ...(info.promptSections ?? [])] }, this.execution2)
      else ctx.send({ type: 'RunAgentInfo', threadId: info.threadId, requestId: info.requestId,
        text: info.text, attachments: info.attachments ?? [],
        prompts: [...this.promptSections, ...(info.promptSections ?? [])] }, this.execution3)
      return
    }
  }
}

export class AgentResultNode extends Node {
  constructor(id) {
    super(id, 'AgentResult', { threads: {} })
  }

  change(info, ctx) {
    if (info.type !== 'AgentCompletedInfo' && info.type !== 'AgentFailedInfo') return
    const threads = ctx.read('threads')
    ctx.patchState({ threads: { ...threads, [info.threadId]: {
      requestId: info.requestId, status: info.type === 'AgentCompletedInfo' ? 'done' : 'error',
      answer: info.type === 'AgentCompletedInfo' ? info.answer : null,
      error: info.type === 'AgentFailedInfo' ? info.message : null,
      processId: info.processId ?? null,
    } } })
  }
}

export class AgentExecutionNode extends ExecutionWorldNode {
  constructor(id, resultId, adapter) {
    super(id, 'AgentExecution', { lastThreadId: null, lastRequestId: null, lastError: null })
    this.resultId = resultId
    this.runAgent = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'RunAgentInfo') return
    try {
      const result = await ctx.effectAdapter(this.runAgent, info)
      if (typeof result?.answer !== 'string') throw new Error('Agent did not return an answer')
      ctx.patchState({ lastThreadId: info.threadId, lastRequestId: info.requestId, lastError: null })
      ctx.send({ type: 'AgentCompletedInfo', threadId: info.threadId, requestId: info.requestId,
        answer: result.answer, processId: result.processId ?? null }, this.resultId)
    } catch (error) {
      const message = failed(error)
      ctx.patchState({ lastThreadId: info.threadId, lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'AgentFailedInfo', threadId: info.threadId, requestId: info.requestId, message }, this.resultId)
    }
  }
}

export class AgentGraphToolNode extends ExecutionWorldNode {
  constructor(id, observationId, adapter) {
    super(id, 'AgentGraphTool', { handles: {}, lastError: null })
    this.observationId = observationId
    this.graphToolExecution = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'AgentGraphToolInfo' || !validId(info.threadId)
      || !validId(info.requestId) || !validId(info.toolCallId)) return
    try {
      const result = await ctx.effectAdapter(this.graphToolExecution, {
        threadId: info.threadId, requestId: info.requestId,
        toolCallId: info.toolCallId, toolName: info.toolName, args: info.args,
      })
      if (typeof result?.handle !== 'string') throw new Error('graph tool did not return a handle')
      ctx.patchState({ handles: { ...ctx.read('handles'), [info.toolCallId]: result.handle }, lastError: null })
      ctx.send({ type: 'ObserveAgentGraphToolInfo', threadId: info.threadId,
        requestId: info.requestId, toolCallId: info.toolCallId, toolName: info.toolName,
        handle: result.handle }, this.observationId)
    } catch (error) {
      const message = failed(error)
      ctx.patchState({ lastError: message })
      ctx.send({ type: 'AgentGraphToolFailedInfo', toolCallId: info.toolCallId, message }, this.observationId)
    }
  }
}

export class AgentGraphToolObservationNode extends ObservationWorldNode {
  constructor(id, adapter) {
    super(id, 'AgentGraphToolObservation', { results: {}, errors: {} })
    this.graphToolObservation = adapter
  }

  async change(info, ctx) {
    if (info.type === 'AgentGraphToolFailedInfo') {
      ctx.patchState({ errors: { ...ctx.read('errors'), [info.toolCallId]: info.message } })
      return
    }
    if (info.type !== 'ObserveAgentGraphToolInfo') return
    try {
      const result = await ctx.effectAdapter(this.graphToolObservation, {
        threadId: info.threadId, requestId: info.requestId,
        toolCallId: info.toolCallId, toolName: info.toolName, handle: info.handle,
      })
      ctx.patchState({ results: { ...ctx.read('results'), [info.toolCallId]: result ?? null } })
    } catch (error) {
      ctx.patchState({ errors: { ...ctx.read('errors'), [info.toolCallId]: failed(error) } })
    }
  }
}

export function createAgentExecutorGraph(ctx) {
  const idFor = (local) => ctx?.nodeIdFor?.(local) ?? `${ctx?.instanceId ?? 'agent'}/${local}`
  const executionSeats = parseAgentSeatCount(ctx?.params?.executionSeats, 'executionSeats', 4, 4)
  const toolSeats = parseAgentSeatCount(ctx?.params?.toolSeats, 'toolSeats', 32, 8)
  const dependencies = ctx?.dependencies ?? {}
  const sessionId = idFor('session')
  const resultId = idFor('result')
  const executionIds = Array.from({ length: 4 }, (_, seat) => idFor(`execution-${seat}`))
  return [
    new AgentSessionNode(sessionId, executionIds, executionSeats, ctx?.params?.promptSections ?? []),
    new AgentResultNode(resultId),
    ...executionIds.map((id) => new AgentExecutionNode(id, resultId, dependencies.runAgent ?? absent('agent/run'))),
    ...Array.from({ length: toolSeats }, (_, seat) => [
      new AgentGraphToolNode(idFor(`tool-${seat}`), idFor(`tool-observation-${seat}`),
        dependencies.graphToolExecution ?? absent('agent/graph-tool-execution')),
      new AgentGraphToolObservationNode(idFor(`tool-observation-${seat}`),
        dependencies.graphToolObservation ?? absent('agent/graph-tool-observation')),
    ]).flat(),
  ]
}

createAgentExecutorGraph.describe = () => ({ kind: 'graph', requiredBindings: [],
  rendererRoots: [{ localId: 'session', infoType: 'AgentInputInfo' }],
})

export default defineBackendPlugin({ id: 'example.agent-executor', createNodes: createAgentExecutorGraph,
  rendererRoots: [{ targetNodeId: 'agent/session', infoType: 'AgentInputInfo',
    validate: (info) => info?.type === 'AgentInputInfo' && validId(info.threadId) && validId(info.requestId) }],
})
