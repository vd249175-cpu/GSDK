import {
  Node,
  ExecutionWorldNode,
  ObservationWorldNode,
  defineBackendPlugin,
} from '@graphframework/sdk/plugin'

export const UFO_EXECUTION_ADAPTER_ID = 'ufo/computer-execution'
export const UFO_OBSERVATION_ADAPTER_ID = 'ufo/computer-observation'

const missingAdapter = (id) => ({
  id,
  execute: async () => {
    throw new Error(`EffectAdapter ${id} was not injected by the named run host`)
  },
})

const errorMessage = (error) => error instanceof Error ? error.message : String(error)

export class UfoComputerRequestNode extends Node {
  constructor(
    id = 'example.ufo-computer-control/request',
    targets = {
      session: 'example.ufo-computer-control/session',
      execution: 'example.ufo-computer-control/execution',
      observation: 'example.ufo-computer-control/observation',
    },
  ) {
    super(id, 'UfoComputerRequest', { lastRequestId: null })
    this.sessionId = targets.session
    this.executionId = targets.execution
    this.observationId = targets.observation
  }

  change(info, ctx) {
    if (info.type === 'InspectComputerInfo') {
      ctx.patchState({ lastRequestId: info.requestId })
      ctx.send({ type: 'ComputerRequestStartedInfo', requestId: info.requestId,
        operation: 'inspect' }, this.sessionId)
      ctx.send({ type: 'ObserveComputerInfo', requestId: info.requestId,
        observation: info.observation ?? { mode: 'desktop' } }, this.observationId)
    } else if (info.type === 'ControlComputerInfo') {
      ctx.patchState({ lastRequestId: info.requestId })
      ctx.send({ type: 'ComputerRequestStartedInfo', requestId: info.requestId,
        operation: info.action?.command ?? 'action' }, this.sessionId)
      ctx.send({ type: 'ExecuteComputerActionInfo', requestId: info.requestId,
        action: info.action,
        observation: info.observation ?? { mode: 'selected-window' } }, this.executionId)
    }
  }
}

export class UfoComputerSessionNode extends Node {
  constructor(id = 'example.ufo-computer-control/session') {
    super(id, 'UfoComputerSession', {
      status: 'idle',
      requestId: null,
      operation: null,
      selectedWindow: null,
      windows: [],
      controls: [],
      screenshotPath: null,
      uiTree: null,
      actionResult: null,
      observation: null,
      completedAt: null,
      lastError: null,
    })
  }

  change(info, ctx) {
    if (info.type === 'ComputerRequestStartedInfo') {
      ctx.patchState({
        status: info.operation === 'inspect' ? 'observing' : 'executing',
        requestId: info.requestId,
        operation: info.operation,
        actionResult: null,
        completedAt: null,
        lastError: null,
      })
      return
    }
    if (info.requestId !== ctx.read('requestId')) return
    if (info.type === 'ComputerActionExecutedInfo') {
      ctx.patchState({ status: 'observing', actionResult: info.result ?? null, lastError: null })
      return
    }

    if (info.type === 'ComputerObservedInfo') {
      const observation = info.observation ?? {}
      ctx.patchState({
        status: 'idle',
        selectedWindow: observation.selectedWindow ?? null,
        windows: Array.isArray(observation.windows) ? observation.windows : [],
        controls: Array.isArray(observation.controls) ? observation.controls : [],
        screenshotPath: observation.screenshotPath ?? null,
        uiTree: observation.uiTree ?? null,
        observation,
        completedAt: observation.observedAt ?? null,
        lastError: null,
      })
      return
    }

    if (info.type === 'ComputerControlFailedInfo') {
      ctx.patchState({
        status: 'error',
        completedAt: info.failedAt ?? null,
        lastError: info.message ?? 'UFO computer control failed',
      })
    }
  }
}

export class UfoComputerExecutionNode extends ExecutionWorldNode {
  constructor(
    id = 'example.ufo-computer-control/execution',
    sessionId = 'example.ufo-computer-control/session',
    observationId = 'example.ufo-computer-control/observation',
    adapter = missingAdapter(UFO_EXECUTION_ADAPTER_ID),
  ) {
    super(id, 'UfoComputerExecution', {
      lastRequestId: null,
      lastCommand: null,
      lastResult: null,
      lastError: null,
    })
    this.sessionId = sessionId
    this.observationId = observationId
    this.computerExecution = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'ExecuteComputerActionInfo') return
    try {
      const result = await ctx.effectAdapter(this.computerExecution, {
        requestId: info.requestId,
        action: info.action,
      })
      ctx.patchState({
        lastRequestId: info.requestId,
        lastCommand: info.action?.command ?? null,
        lastResult: result ?? null,
        lastError: null,
      })
      ctx.send(
        {
          type: 'ComputerActionExecutedInfo',
          requestId: info.requestId,
          result: result ?? null,
          observation: info.observation,
        },
        this.sessionId,
      )
      ctx.send({ type: 'ObserveComputerInfo', requestId: info.requestId,
        observation: info.observation ?? { mode: 'selected-window' } }, this.observationId)
    } catch (error) {
      const message = errorMessage(error)
      ctx.patchState({
        lastRequestId: info.requestId,
        lastCommand: info.action?.command ?? null,
        lastError: message,
      })
      ctx.send({ type: 'ComputerControlFailedInfo', requestId: info.requestId, phase: 'execute', message }, this.sessionId)
    }
  }
}

export class UfoComputerObservationNode extends ObservationWorldNode {
  constructor(
    id = 'example.ufo-computer-control/observation',
    sessionId = 'example.ufo-computer-control/session',
    adapter = missingAdapter(UFO_OBSERVATION_ADAPTER_ID),
  ) {
    super(id, 'UfoComputerObservation', {
      lastRequestId: null,
      lastScreenshotPath: null,
      lastWindowCount: 0,
      lastControlCount: 0,
      lastError: null,
    })
    this.sessionId = sessionId
    this.computerObservation = adapter
  }

  async change(info, ctx) {
    if (info.type !== 'ObserveComputerInfo') return
    try {
      const observation = await ctx.effectAdapter(this.computerObservation, {
        requestId: info.requestId,
        observation: info.observation,
      })
      ctx.patchState({
        lastRequestId: info.requestId,
        lastScreenshotPath: observation?.screenshotPath ?? null,
        lastWindowCount: Array.isArray(observation?.windows) ? observation.windows.length : 0,
        lastControlCount: Array.isArray(observation?.controls) ? observation.controls.length : 0,
        lastError: null,
      })
      ctx.send(
        {
          type: 'ComputerObservedInfo',
          requestId: info.requestId,
          observation: observation ?? {},
        },
        this.sessionId,
      )
    } catch (error) {
      const message = errorMessage(error)
      ctx.patchState({ lastRequestId: info.requestId, lastError: message })
      ctx.send({ type: 'ComputerControlFailedInfo', requestId: info.requestId, phase: 'observe', message }, this.sessionId)
    }
  }
}

export function createUfoComputerControl(ctx) {
  const idFor = (local) => {
    if (ctx && typeof ctx.nodeIdFor === 'function') return ctx.nodeIdFor(local)
    if (ctx && typeof ctx.instanceId === 'string' && ctx.instanceId) return `${ctx.instanceId}/${local}`
    return `example.ufo-computer-control/${local}`
  }
  const dependencies = ctx?.dependencies ?? {}
  return {
    request: new UfoComputerRequestNode(idFor('request'), {
      session: idFor('session'),
      execution: idFor('execution'),
      observation: idFor('observation'),
    }),
    session: new UfoComputerSessionNode(idFor('session')),
    execution: new UfoComputerExecutionNode(
      idFor('execution'),
      idFor('session'),
      idFor('observation'),
      dependencies.ufoComputerExecution ?? missingAdapter(UFO_EXECUTION_ADAPTER_ID),
    ),
    observation: new UfoComputerObservationNode(
      idFor('observation'),
      idFor('session'),
      dependencies.ufoComputerObservation ?? missingAdapter(UFO_OBSERVATION_ADAPTER_ID),
    ),
  }
}

export const createUfoComputerControlGraph = (ctx) => Object.values(createUfoComputerControl(ctx))
createUfoComputerControlGraph.describe = () => ({
  kind: 'graph',
  localIds: ['request', 'session', 'execution', 'observation'],
  requiredBindings: [],
  rendererRoots: [],
})

export { createUfoComputerBridge } from './bridge/ufo-computer-bridge.mjs'

export default defineBackendPlugin({
  id: 'example.ufo-computer-control',
  createNodes: (context) => Object.values(createUfoComputerControl(context)),
  rendererRoots: [],
})
