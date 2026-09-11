import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchpadItem } from '@graphvideo/domain'
import type { RuntimeTaskGraphState } from '../../../../renderer/src/studio/core/state/types'
import { useLaunchpadPipeline } from './useLaunchpadPipeline'

const fixture = vi.hoisted(() => ({
  item: {
    id: 'video', type: 'video', title: 'Video', prompt: 'prompt', hasHeader: true,
    modelId: 'fixture', dispatchMode: 'model', headerParams: {}, layer: 0,
    dependencies: [], missingDependencies: [], areDependenciesReady: true,
    isReady: true, estimatedCredits: 20, status: 'ready', updatedAt: 0,
  } as LaunchpadItem,
  project: { localPath: null, tree: [], nodes: {} },
  taskGraphs: {} as Record<string, RuntimeTaskGraphState>,
  generate: vi.fn(), generateBatch: vi.fn(),
}))

vi.mock('@graphvideo/client-sdk', () => ({
  useAppState: (select: (state: unknown) => unknown) => select({
    project: fixture.project,
    runtime: { taskGraphs: fixture.taskGraphs, generation: { spentCredits: 0, maxBudget: 100 } },
  }),
  useApplicationClient: () => ({ generationModels: { generate: fixture.generate, generateBatch: fixture.generateBatch } }),
  useShellClient: () => ({}),
}))
vi.mock('@graphvideo/domain', () => ({
  LaunchpadScheduler: { buildLaunchpadItems: () => [fixture.item] },
}))

let pipeline: ReturnType<typeof useLaunchpadPipeline>
function Harness() { pipeline = useLaunchpadPipeline(); return null }
const complete = { status: 'completed', items: [{ nodeId: 'video', versionId: 'v1', status: 'downloaded' }] }

describe('launchpad submission guards', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    fixture.generate.mockReset()
    fixture.generateBatch.mockReset()
    fixture.taskGraphs = {}
    fixture.item.status = 'ready'
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
  })

  it('blocks a second click synchronously and exposes a cancellable single launch', async () => {
    let finish!: (value: unknown) => void
    fixture.generate.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    let running!: Promise<boolean>
    await act(async () => {
      running = pipeline.executeSingleItem(fixture.item)
      expect(await pipeline.executeSingleItem(fixture.item)).toBe(false)
    })
    expect(fixture.generate).toHaveBeenCalledOnce()
    expect(pipeline.isRunning).toBe(true)
    expect(pipeline.canCancel).toBe(true)
    await act(async () => pipeline.cancelPipeline())
    expect(fixture.generate.mock.calls[0][2].signal.aborted).toBe(true)
    // Keep the submission guard until the canceled request actually settles.
    await act(async () => { expect(await pipeline.executeSingleItem(fixture.item)).toBe(false) })
    await act(async () => { finish(complete); await running })
    expect(pipeline.isRunning).toBe(false)
    expect(pipeline.canCancel).toBe(false)
  })

  it('releases a failed local submission so a later retry can run', async () => {
    fixture.generate.mockRejectedValueOnce(new Error('network failed')).mockResolvedValueOnce(complete)
    await act(async () => { expect(await pipeline.executeSingleItem(fixture.item)).toBe(false) })
    expect(pipeline.isRunning).toBe(false)
    await act(async () => { expect(await pipeline.executeSingleItem(fixture.item)).toBe(true) })
    expect(fixture.generate).toHaveBeenCalledTimes(2)
  })

  it('honors projected work from another panel even when a current asset already exists', async () => {
    fixture.item.status = 'completed'
    fixture.taskGraphs = { batch: { tasks: { task: {
      targetNodeId: 'video', status: 'running', phase: 'persisting', startedAt: 1, message: 'saving', error: null,
    } } } } as unknown as Record<string, RuntimeTaskGraphState>
    await act(async () => root.render(<Harness />))
    expect(pipeline.items[0]).toMatchObject({ isReady: false, status: 'running' })
    expect(pipeline.isRunning).toBe(true)
    expect(pipeline.canCancel).toBe(false)
    await act(async () => {
      expect(await pipeline.executeSingleItem(fixture.item)).toBe(false)
      await pipeline.startPipeline()
      await pipeline.startLayerPipeline(0)
    })
    expect(fixture.generate).not.toHaveBeenCalled()
    expect(fixture.generateBatch).not.toHaveBeenCalled()
    fixture.taskGraphs = { batch: { tasks: { task: {
      targetNodeId: 'video', status: 'failed', phase: 'failed', startedAt: 1, error: 'SQLite write failed',
    } } } } as unknown as Record<string, RuntimeTaskGraphState>
    await act(async () => root.render(<Harness />))
    expect(pipeline.items[0]).toMatchObject({ status: 'error', statusMessage: 'SQLite write failed' })
  })
});
