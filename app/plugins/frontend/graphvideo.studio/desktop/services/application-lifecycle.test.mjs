import { describe, expect, it } from 'vitest'
import studioPlugin from '../../../../backend/graphvideo.studio/index.ts'
import { locateNativeBinding } from '@graphvideo/sdk/node'
import { createEmptyNativeGraphHost } from '@graphvideo/desktop/graph-host'
import { createStudioApplicationLifecycle } from './application-lifecycle.mjs'

async function fixture({ failSave = false, hangSave = false, timeoutMs = 100, generationAdapterOperation } = {}) {
  const calls = []
  let releaseSave
  const saveGate = new Promise((resolve) => { releaseSave = resolve })
  const host = createEmptyNativeGraphHost({ plugins: [studioPlugin], dependencies: {
    generationAdapterOperation,
    electronWindowAdapter: { id: 'test/window', async execute(request) {
      calls.push(request.type)
      return { type: request.type === 'OPEN' ? 'OPENED' : 'CLOSED', isWindowOpen: request.type === 'OPEN' }
    } },
    projectStructurePersistAdapter: { id: 'test/save', async execute(request) {
      calls.push('save')
      if (hangSave) await saveGate
      if (failSave) throw new Error('disk full')
      return { nodes: request.nodes, retainedNodes: request.retainedNodes, savedAt: 1, contentRef: 'project' }
    } },
  } })
  await host.mountPlugins()
  const lifecycle = createStudioApplicationLifecycle({ host, hasProject: () => true,
    closeIngress: () => { calls.push('gate') },
    waitForAcceptedWork: async () => { calls.push('accepted') },
    stopSources: async () => { calls.push('sources') },
    closeServices: async () => { calls.push('services') },
    timeoutMs,
  })
  await lifecycle.start()
  return { host, calls, lifecycle, releaseSave }
}

describe.skipIf(!locateNativeBinding())('Studio host lifecycle', () => {
  it('shares concurrent exit requests and evicts only after business completion', async () => {
    const { host, calls, lifecycle } = await fixture()
    const first = lifecycle.shutdown()
    expect(lifecycle.shutdown()).toBe(first)
    await first
    expect(calls).toEqual(['OPEN', 'gate', 'accepted', 'save', 'CLOSE', 'sources', 'services'])
    expect(host.space.admittedEntities()).toEqual([])
    expect(lifecycle.stopped).toBe(true)
    expect(() => host.space.injectRoot('host-el', { type: 'Late' })).toThrow(/closed/)
  })

  it('leaves nodes mounted and the window open when saving fails', async () => {
    const { host, calls, lifecycle } = await fixture({ failSave: true })
    try {
      await expect(lifecycle.shutdown()).rejects.toThrow('disk full')
      expect(calls).toEqual(['OPEN', 'gate', 'accepted', 'save'])
      expect(host.space.admittedEntities()).toContain('host-el')
      expect(lifecycle.stopped).toBe(false)
      expect(host.readNodeState('node-application-lifecycle')).toMatchObject({ phase: 'ShutdownFailed' })
    } finally { await host.dispose() }
  })

  it('reports timeout without claiming a hung save has stopped', async () => {
    const { host, calls, lifecycle, releaseSave } = await fixture({ hangSave: true })
    await expect(lifecycle.shutdown()).rejects.toThrow(/Timed out/)
    expect(calls).toEqual(['OPEN', 'gate', 'accepted', 'save'])
    expect(host.space.admittedEntities()).toContain('sink-sqlite-writer')
    expect(lifecycle.stopped).toBe(false)
    releaseSave()
    await host.space.pump()
    expect(calls).not.toContain('CLOSE')
    expect(host.readNodeState('node-application-lifecycle')).toMatchObject({ phase: 'ShutdownFailed' })
    await host.dispose()
  })

  it('shuts an empty boot down without injecting into missing nodes', async () => {
    const host = createEmptyNativeGraphHost()
    const lifecycle = createStudioApplicationLifecycle({ host })
    await lifecycle.shutdown()
    expect(lifecycle.stopped).toBe(true)
    await expect(lifecycle.start()).rejects.toThrow(/closing/)
  })

  it('quiesces an automatic polling chain before waiting for its accepted submission', async () => {
    let polled
    const firstPoll = new Promise((resolve) => { polled = resolve })
    const operations = []
    const { host, lifecycle } = await fixture({ timeoutMs: 2000, generationAdapterOperation: {
      id: 'test/generation', async execute(request) {
        operations.push(request.operation)
        if (request.operation === 'submit') return { operation: 'submit', status: 'submitted', handle: { provider: 'comfy', taskId: 'remote' } }
        polled()
        return { operation: 'poll', status: 'pending', progress: 30, remoteStatus: 'running' }
      },
    } })
    const root = host.space.injectRoot('node-generation-task', { type: 'GenerationBatchPlannedInfo', batchId: 'batch', tasks: [{
      taskId: 'task', targetNodeId: 'video', destinationRelativePath: 'nodes/video/media/v1.mp4',
      versionId: 'v1', mediaType: 'video', estimatedCredits: 20, autoPoll: true,
      submit: { provider: 'comfy', prompt: { '1': { class_type: 'SaveVideo' } }, expectedOutputKind: 'video' },
    }] })
    const running = host.space.waitForSubmission(root)
    await firstPoll
    await lifecycle.shutdown()
    await running
    expect(operations).toEqual(['submit', 'poll'])
    expect(lifecycle.stopped).toBe(true)
  })
})
