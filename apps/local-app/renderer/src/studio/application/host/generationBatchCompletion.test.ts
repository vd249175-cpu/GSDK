import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../core/state/initialState'
import { completedGenerationBatchFromState } from './generationBatchCompletion'

function state(phase: 'downloaded' | 'failed' | 'canceled' = 'downloaded') {
  const value = createInitialState()
  value.runtime.taskGraphs['batch-1'] = {
    id: 'batch-1',
    intentType: 'generation.batch',
    projectId: null,
    mode: 'foreground',
    status: phase === 'failed' ? 'failed' : phase === 'canceled' ? 'canceled' : 'succeeded',
    progress: phase === 'downloaded' ? 100 : 0,
    error: phase === 'failed' ? 'worker unavailable' : phase === 'canceled' ? '用户已取消生成' : null,
    createdAt: 1,
    startedAt: 1,
    finishedAt: null,
    tasks: {
      'task-1': {
        id: 'task-1',
        targetNodeId: 'video-1',
        versionId: 'version-1',
        destinationRelativePath: 'nodes/video-1/media/version-1.mp4',
        phase,
        status: phase === 'failed' ? 'failed' : phase === 'canceled' ? 'canceled' : 'succeeded',
        attempt: 1,
        maxAttempts: 1,
        progress: phase === 'downloaded' ? 100 : 0,
        message: phase,
        error: phase === 'failed' ? 'worker unavailable' : phase === 'canceled' ? '用户已取消生成' : null,
        startedAt: 1,
        finishedAt: null,
      },
    },
  }
  value.project.nodes['video-1'] = {
    id: 'video-1',
    type: 'video',
    title: 'Video',
    description: '',
    history: [{
      id: 'version-1',
      label: 'version-1.mp4',
      relativePath: 'nodes/video-1/media/version-1.mp4',
      mimeType: 'video/mp4',
      createdAt: '2026-08-30T00:00:00.000Z',
      source: 'generated',
      current: true,
    }],
  }
  return value
}

describe('generation batch completion from ApplicationState', () => {
  it('does not report success while the downloaded version is still being persisted', () => {
    const pending = state()
    pending.runtime.taskGraphs['batch-1'].tasks['task-1'].phase = 'persisting'
    expect(() => completedGenerationBatchFromState({
      batchId: 'batch-1', requests: [{ nodeId: 'video-1' }], state: pending,
    })).toThrow()
  })
  it('accepts only downloaded tasks whose version is the unique current project asset', () => {
    expect(completedGenerationBatchFromState({
      batchId: 'batch-1',
      requests: [{ nodeId: 'video-1' }],
      state: state(),
    })).toEqual({
      status: 'completed',
      batchId: 'batch-1',
      items: [{ nodeId: 'video-1', taskId: 'task-1', versionId: 'version-1', status: 'downloaded' }],
    })
  })

  it('surfaces the projected Owner failure without reading private Node State', () => {
    expect(() => completedGenerationBatchFromState({
      batchId: 'batch-1',
      requests: [{ nodeId: 'video-1' }],
      state: state('failed'),
    })).toThrow(/worker unavailable/)
  })

  it('surfaces a projected cancellation as a terminal non-success result', () => {
    expect(() => completedGenerationBatchFromState({
      batchId: 'batch-1',
      requests: [{ nodeId: 'video-1' }],
      state: state('canceled'),
    })).toThrow(/用户已取消生成/)
  })
})
