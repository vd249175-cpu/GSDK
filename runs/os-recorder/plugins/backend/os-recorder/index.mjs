import {
  Node,
  ExecutionWorldNode,
  ObservationWorldNode,
  defineBackendPlugin,
} from '@graphframework/sdk/plugin'

/**
 * example.os-recorder: UFO-compatible whole-desktop demonstration recorder.
 *
 * RecordingSessionNode owns the durable business facts. Physical start/stop and
 * archive observation are deliberately split across two WorldNodes. The run
 * host injects adapters backed by the Windows Steps Recorder workflow supported
 * by Microsoft UFO's record_processor.
 */

const CONTROL_ADAPTER_ID = 'ufo/psr-capture-control'
const OBSERVATION_ADAPTER_ID = 'ufo/psr-capture-observation'
const EVENTS_ADAPTER_ID = 'ufo/desktop-capture-events'

const missingAdapter = (id) => ({
  id,
  execute: async () => {
    throw new Error(`EffectAdapter ${id} was not injected by the os-recorder run host`)
  },
})

const errorMessage = (error) => error instanceof Error ? error.message : String(error)

export class RecordingSessionNode extends Node {
  constructor(
    id = 'example.os-recorder/session',
    targets = {
      execution: 'example.os-recorder/execution',
      observation: 'example.os-recorder/observation',
    },
  ) {
    super(id, 'RecordingSession', {
      status: 'idle',
      sessionId: null,
      handle: null,
      eventCount: 0,
      events: [],
      applications: [],
      artifactPath: null,
      recorder: 'Microsoft UFO / Windows Steps Recorder',
      startedAt: null,
      completedAt: null,
      lastEvent: null,
      lastError: null,
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
      ctx.patchState({
        status: 'starting',
        sessionId,
        handle: null,
        eventCount: 0,
        events: [],
        applications: [],
        artifactPath: null,
        startedAt: null,
        completedAt: null,
        lastEvent: null,
        lastError: null,
      })
      ctx.send({ type: 'StartCaptureInfo', sessionId }, this.executionId)
    } else if (info.type === 'StopRecordingInfo') {
      if (ctx.read('status') !== 'recording') {
        ctx.write('lastError', 'no active recording to stop')
        return
      }
      ctx.patchState({ status: 'stopping', lastError: null })
      ctx.send({ type: 'StopCaptureInfo', sessionId: ctx.read('sessionId') }, this.executionId)
    } else if (info.type === 'RecordingStartedInfo') {
      ctx.patchState({
        status: 'recording',
        handle: info.handle ?? null,
        artifactPath: info.artifactPath ?? null,
        startedAt: info.startedAt ?? null,
        lastError: null,
      })
    } else if (info.type === 'RecordingStoppedInfo') {
      ctx.patchState({ status: 'processing', artifactPath: info.artifactPath ?? ctx.read('artifactPath'), lastError: null })
      ctx.send(
        {
          type: 'ObserveRecordingInfo',
          sessionId: info.sessionId,
          artifactPath: info.artifactPath,
        },
        this.observationId,
      )
    } else if (info.type === 'RecordingObservedInfo') {
      const events = Array.isArray(info.events) ? info.events : []
      ctx.patchState({
        status: 'idle',
        eventCount: events.length,
        events,
        applications: Array.isArray(info.applications) ? info.applications : [],
        artifactPath: info.artifactPath ?? ctx.read('artifactPath'),
        completedAt: info.completedAt ?? null,
        lastEvent: events.at(-1) ?? null,
        lastError: null,
      })
    } else if (info.type === 'RecordingEventInfo') {
      const event = info.event ?? null
      if (!event) return
      const events = [...ctx.read('events'), event]
      const applications = event.application && !ctx.read('applications').includes(event.application)
        ? [...ctx.read('applications'), event.application]
        : ctx.read('applications')
      ctx.patchState({
        eventCount: events.length,
        events,
        applications,
        lastEvent: event,
        lastError: null,
      })
    } else if (info.type === 'RecordingFailedInfo') {
      ctx.patchState({ status: 'error', lastError: info.message ?? 'recording failed' })
    }
  }
}

export class RecordingCaptureNode extends ExecutionWorldNode {
  constructor(
    id = 'example.os-recorder/execution',
    sessionId = 'example.os-recorder/session',
    adapter = missingAdapter(CONTROL_ADAPTER_ID),
  ) {
    super(id, 'RecordingCapture', { lastOp: null, lastHandle: null, lastArtifactPath: null, lastError: null })
    this.sessionId = sessionId
    this.captureControl = adapter
  }

  async change(info, ctx) {
    if (info.type === 'StartCaptureInfo') {
      try {
        const observation = await ctx.effectAdapter(this.captureControl, { op: 'start', sessionId: info.sessionId })
        ctx.patchState({
          lastOp: 'start',
          lastHandle: observation?.handle ?? null,
          lastArtifactPath: observation?.artifactPath ?? null,
          lastError: null,
        })
        ctx.send(
          {
            type: 'RecordingStartedInfo',
            sessionId: info.sessionId,
            handle: observation?.handle ?? null,
            artifactPath: observation?.artifactPath ?? null,
            startedAt: observation?.startedAt ?? null,
          },
          this.sessionId,
        )
      } catch (error) {
        const message = errorMessage(error)
        ctx.patchState({ lastOp: 'start', lastError: message })
        ctx.send({ type: 'RecordingFailedInfo', phase: 'start', message }, this.sessionId)
      }
    } else if (info.type === 'StopCaptureInfo') {
      try {
        const observation = await ctx.effectAdapter(this.captureControl, { op: 'stop', sessionId: info.sessionId })
        ctx.patchState({
          lastOp: 'stop',
          lastArtifactPath: observation?.artifactPath ?? ctx.read('lastArtifactPath'),
          lastError: null,
        })
        ctx.send(
          {
            type: 'RecordingStoppedInfo',
            sessionId: info.sessionId,
            artifactPath: observation?.artifactPath ?? ctx.read('lastArtifactPath'),
          },
          this.sessionId,
        )
      } catch (error) {
        const message = errorMessage(error)
        ctx.patchState({ lastOp: 'stop', lastError: message })
        ctx.send({ type: 'RecordingFailedInfo', phase: 'stop', message }, this.sessionId)
      }
    }
  }
}

export class RecordingObserverNode extends ObservationWorldNode {
  constructor(
    id = 'example.os-recorder/observation',
    sessionId = 'example.os-recorder/session',
    adapter = missingAdapter(OBSERVATION_ADAPTER_ID),
    eventsAdapter = missingAdapter(EVENTS_ADAPTER_ID),
  ) {
    super(id, 'RecordingObserver', { lastCount: 0, lastArtifactPath: null, lastError: null })
    this.sessionId = sessionId
    this.captureObservation = adapter
    this.captureEvents = eventsAdapter
  }

  async change(info, ctx) {
    if (info.type === 'PollRecordingEventsInfo') {
      try {
        const observation = await ctx.effectAdapter(this.captureEvents, {
          op: 'poll',
          sessionId: info.sessionId,
        })
        const events = Array.isArray(observation?.events) ? observation.events : []
        for (const event of events) {
          ctx.send({ type: 'RecordingEventInfo', sessionId: info.sessionId, event }, this.sessionId)
        }
        if (events.length > 0 || ctx.read('lastError')) {
          ctx.patchState({ lastCount: ctx.read('lastCount') + events.length, lastError: null })
        }
      } catch (error) {
        ctx.patchState({ lastError: errorMessage(error) })
      }
      return
    }
    if (info.type !== 'ObserveRecordingInfo') return
    try {
      const observation = await ctx.effectAdapter(this.captureObservation, {
        op: 'observe',
        sessionId: info.sessionId,
        artifactPath: info.artifactPath,
      })
      const events = Array.isArray(observation?.events) ? observation.events : []
      ctx.patchState({ lastCount: events.length, lastArtifactPath: info.artifactPath, lastError: null })
      ctx.send(
        {
          type: 'RecordingObservedInfo',
          sessionId: info.sessionId,
          artifactPath: info.artifactPath,
          events,
          applications: Array.isArray(observation?.applications) ? observation.applications : [],
          completedAt: observation?.completedAt ?? null,
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

export function createOsRecorder(ctx) {
  const idFor = (local) => {
    if (ctx && typeof ctx.nodeIdFor === 'function') return ctx.nodeIdFor(local)
    if (ctx && typeof ctx.instanceId === 'string' && ctx.instanceId) return `${ctx.instanceId}/${local}`
    return `example.os-recorder/${local}`
  }
  const dependencies = ctx?.dependencies ?? {}
  const session = new RecordingSessionNode(idFor('session'), {
    execution: idFor('execution'),
    observation: idFor('observation'),
  })
  const execution = new RecordingCaptureNode(
    idFor('execution'),
    idFor('session'),
    dependencies.captureControl ?? missingAdapter(CONTROL_ADAPTER_ID),
  )
  const observation = new RecordingObserverNode(
    idFor('observation'),
    idFor('session'),
    dependencies.captureObservation ?? missingAdapter(OBSERVATION_ADAPTER_ID),
    dependencies.captureEvents ?? missingAdapter(EVENTS_ADAPTER_ID),
  )
  return { session, execution, observation }
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
