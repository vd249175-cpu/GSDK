import { describe, expect, it, vi } from 'vitest'
import { defaultValueCodec, type GraphProjection } from '@graphvideo/kernel'
import { graphVideoRuntimeNodeIds } from '../../graph/node-ids'
import {
  KernelApplicationGraphHost,
  type GraphKernelBridge,
} from './graphHost'

function projection(sequence = 0, projectName = '未打开项目'): GraphProjection {
  return {
    revision: sequence,
    scheduler: {
      pendingDeliveries: 0,
      activeChanges: 0,
      scheduledGraphMicrotasks: 0,
    },
    nodes: [{
      nodeId: graphVideoRuntimeNodeIds.projectSession,
      state: defaultValueCodec.encode({
        projectName,
        currentPath: projectName === '未打开项目' ? '.graphvideo/nodes.sqlite' : 'C:/Project',
        loadedBytes: 0,
        lastObservedAt: 0,
      }),
      version: sequence,
      status: 'IDLE',
    }],
  }
}

describe('KernelApplicationGraphHost', () => {
  it('injects each root Info exactly once through Kernel syscalls', async () => {
    let current = projection()
    const request = vi.fn(async (method: string) => {
      if (method === 'graph.projection.read') return { projection: current }
      if (method === 'graph.injectRootInfo') {
        current = projection(1, 'Project A')
        return {
          status: 'accepted', submissionId: 'submission-1', projection: current,
        }
      }
      if (method === 'graph.cancel') return { cancelled: true }
      throw new Error(`unexpected syscall: ${method}`)
    })
    const bridge = {
      request,
      subscribe: vi.fn(() => () => undefined),
    } as unknown as GraphKernelBridge
    const graph = new KernelApplicationGraphHost(bridge, {
      nextSubmissionId: () => 'submission-1',
    })

    await graph.connect()
    await graph.injectRootInfo(graphVideoRuntimeNodeIds.document, {
      type: 'UserMarkdownEditedInfo', markdown: '# project',
    })

    expect(request).toHaveBeenCalledWith('graph.injectRootInfo', {
      submissionId: 'submission-1',
      targetNodeId: graphVideoRuntimeNodeIds.document,
      info: { type: 'UserMarkdownEditedInfo', markdown: '# project' },
    })
    expect(graph.projection.read().project.name).toBe('Project A')
    expect(await graph.cancel('submission-1')).toBe(true)
  })

  it('accepts only monotonic projection events from the mounted graph', async () => {
    let listener: ((value: { projection: GraphProjection }) => void) | null = null
    const bridge = {
      request: vi.fn(async () => ({ projection: projection(2, 'Current') })),
      subscribe: vi.fn((_event, next) => {
        listener = next
        return () => undefined
      }),
    } as unknown as GraphKernelBridge
    const graph = new KernelApplicationGraphHost(bridge)
    const changed = vi.fn()
    graph.projection.subscribe(changed)
    await graph.connect()

    listener?.({ projection: projection(2, 'Duplicate') })
    listener?.({ projection: projection(1, 'Stale') })
    listener?.({ projection: projection(3, 'Newest') })

    expect(graph.projection.read().project.name).toBe('Newest')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('maps an Application AbortSignal to cancellation of the same submission', async () => {
    let rejectInjection: (error: Error) => void = () => undefined
    const request = vi.fn(async (method: string, input: any) => {
      if (method === 'graph.injectRootInfo') {
        return new Promise((_resolve, reject) => { rejectInjection = reject })
      }
      if (method === 'graph.cancel') {
        const error = new Error(`cancelled: ${input.submissionId}`)
        error.name = 'AbortError'
        rejectInjection(error)
        return { cancelled: true }
      }
      throw new Error(`unexpected syscall: ${method}`)
    })
    const graph = new KernelApplicationGraphHost({
      request,
      subscribe: vi.fn(() => () => undefined),
    } as unknown as GraphKernelBridge, {
      nextSubmissionId: () => 'submission/cancelled',
    })
    const controller = new AbortController()

    const execution = graph.injectRootInfo('node-md-source', {
      type: 'UserMarkdownEditedInfo',
      markdown: '# cancelled',
    }, { signal: controller.signal })
    controller.abort()

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledWith('graph.cancel', {
      submissionId: 'submission/cancelled',
    })
  })
})
