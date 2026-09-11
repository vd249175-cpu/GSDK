import { describe, expect, it } from 'vitest'
import { KernelRuntime, Node, type DomainChangeContext, type Info } from '@graphvideo/kernel'
import { flattenProjectTree, type ProjectTreeItem } from '../../core/project/treeEditor'
import { applicationStateFromGraphProjection } from './application-state-projection'

function deepOutline(depth: number): ProjectTreeItem[] {
  let children: ProjectTreeItem[] = []
  for (let level = depth - 1; level >= 0; level -= 1) {
    children = [{
      key: `level-${level}`,
      kind: 'structure',
      title: `层级 ${level}`,
      depth: level,
      line: level + 1,
      relation: level === 0 ? 'root' : 'structure',
      children,
    }]
  }
  return children
}

class ProjectionFixtureNode<S extends Record<string, unknown>> extends Node<S> {
  constructor(id: string, state: S) {
    super(id, 'Projection fixture', state)
  }

  override change(_info: Info, _ctx: DomainChangeContext<S>) {}
}

describe('Application state projection', () => {
  it('preserves a deep outline instead of crashing render with undefined.flatMap', () => {
    const runtime = new KernelRuntime()
    runtime.mount(new ProjectionFixtureNode('node-outliner', { tree: deepOutline(12) }))

    const state = applicationStateFromGraphProjection(runtime.readProjection())

    expect(flattenProjectTree(state.project.tree)).toHaveLength(12)
  })

  it.each(['downloading', 'persisting'])('projects the active %s phase into the shared runtime task read model', (phase) => {
    const runtime = new KernelRuntime()
    runtime.mount(new ProjectionFixtureNode('node-generation-task', {
      tasks: new Map([['task-video', {
        taskId: 'task-video',
        batchId: 'batch-video',
        targetNodeId: 'video-1',
        versionId: 'version-2',
        destinationRelativePath: 'nodes/video-1/media/version-2.mp4',
        phase,
        progress: 80,
        error: '',
        startedAt: 10,
      }]]),
    }))

    const state = applicationStateFromGraphProjection(runtime.readProjection())

    expect(state.runtime.taskGraphs['batch-video']).toMatchObject({
      status: 'running',
      progress: 80,
      tasks: {
        'task-video': {
          targetNodeId: 'video-1',
          versionId: 'version-2',
          phase,
          status: 'running',
        },
      },
    })
  })

  it('projects canceled GenerationTask records as a terminal graph status', () => {
    const runtime = new KernelRuntime()
    runtime.mount(new ProjectionFixtureNode('node-generation-task', {
      tasks: new Map([['task-video', {
        taskId: 'task-video',
        batchId: 'batch-video',
        targetNodeId: 'video-1',
        versionId: 'version-2',
        destinationRelativePath: 'nodes/video-1/media/version-2.mp4',
        phase: 'canceled',
        progress: 10,
        error: '用户已取消生成',
        startedAt: 10,
      }]]),
    }))

    const graph = applicationStateFromGraphProjection(runtime.readProjection())

    expect(graph.runtime.taskGraphs['batch-video']).toMatchObject({
      status: 'canceled',
      tasks: { 'task-video': { status: 'canceled', phase: 'canceled' } },
    })
  })
})
