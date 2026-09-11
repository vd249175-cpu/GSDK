import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelProps, ProjectNode, ProjectTreeItem } from '@graphvideo/client-sdk'
import { OutlinerPanel } from './OutlinerPanel'

const fixture = vi.hoisted(() => ({
  project: {
    localPath: 'C:/fixture', issues: [],
    nodes: {
      'video-real': { id: 'video-real', type: 'video', title: '镜头', description: '', history: [] },
    } as Record<string, ProjectNode>,
    tree: [{
      key: 'shot', kind: 'node', title: '镜头', depth: 0, line: 1, relation: 'structure',
      nodeId: 'auto:%:镜头', nodeType: 'video', symbol: '%', children: [],
    }] as ProjectTreeItem[],
  },
  exportVideos: vi.fn(), editTree: vi.fn(), setNotice: vi.fn(),
}))

vi.mock('@graphvideo/client-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@graphvideo/client-sdk')>()
  const { useState } = await import('react')
  return {
    ...original,
    useApplicationClient: () => ({ assets: { exportVideos: fixture.exportVideos }, project: { editTree: fixture.editTree } }),
    useAppState: (selector: (state: { project: typeof fixture.project }) => unknown) => selector({ project: fixture.project }),
    useElementState: () => useState<string[]>([]),
    useSelectedNodeId: () => null,
    useClientSelectionActions: () => ({ selectNode: vi.fn() }),
  }
})

vi.mock('../generation/useLaunchpadPipeline', () => ({
  useLaunchpadPipeline: () => ({
    maxBudget: 1000, maxGenerationWaitMinutes: 10, spentCredits: 0,
    itemsMap: new Map(), layersSummary: [], isRunning: false, readyCount: 0,
    completedCount: 0, runningCount: 0, errorCount: 0, totalPlannedCredits: 0,
    remainingCredits: 1000, setNotice: fixture.setNotice,
  }),
}))

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
const props: PanelProps = {
  runtime: {} as PanelProps['runtime'], instanceId: 'fixture', workspaceId: 'fixture', areaId: 'fixture', viewId: 'fixture',
}

describe('Outliner editing and export', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(async () => {
    environment.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(<OutlinerPanel {...props} />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    environment.IS_REACT_ACT_ENVIRONMENT = false
  })

  function button(title: string) {
    const result = [...container.querySelectorAll('button')].find((item) => item.title.startsWith(title))
    if (!result) throw new Error(`Missing button: ${title}`)
    return result
  }

  function typeInMiddle(input: HTMLInputElement, value: string, caret: number) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.setSelectionRange(caret, caret)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('selects the new-item title once, not after each keystroke or projection refresh', async () => {
    await act(async () => button('在当前项内新建节点').click())
    const input = container.querySelector('.is-editing input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.selectionEnd).toBe(input.value.length)
    await act(async () => typeInMiddle(input, '新中节点', 2))
    expect(input.value).toBe('新中节点')
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(2)
    await act(async () => root.render(<OutlinerPanel {...props} />))
    expect(input.selectionStart).toBe(2)
  })

  it('opens a stable inline editor for renaming an existing item', async () => {
    await act(async () => button('节点 ID:').click())
    await act(async () => button('重命名').click())
    const input = container.querySelector('.is-editing input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('镜头')
    await act(async () => typeInMiddle(input, '镜一头', 2))
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(2)
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', isComposing: true, bubbles: true,
    })))
    expect(fixture.editTree).not.toHaveBeenCalled()
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(fixture.editTree).not.toHaveBeenCalled()
  })

  it('exports canonical video IDs and reports skipped files instead of zero-file success', async () => {
    fixture.exportVideos.mockResolvedValue({
      canceled: false, exported: [],
      skipped: [{ nodeId: 'video-real', title: '镜头', reason: '视频文件不存在' }],
    })
    await act(async () => button('按项目目录顺序导出').click())
    expect(fixture.exportVideos).toHaveBeenCalledWith(['video-real'])
    expect(fixture.setNotice).toHaveBeenCalledWith(expect.stringContaining('视频文件不存在'))
    expect(fixture.setNotice).not.toHaveBeenCalledWith(expect.stringContaining('成功导出 0'))
  })

  it('distinguishes partial exports and a canceled directory picker', async () => {
    fixture.exportVideos.mockResolvedValueOnce({
      canceled: false, exported: [{ nodeId: 'video-real', fileName: '001.mp4', destinationPath: 'C:/fixture/001.mp4' }],
      skipped: [{ nodeId: 'other', title: '另一镜头', reason: '没有当前版本' }],
    }).mockResolvedValueOnce({ canceled: true, exported: [], skipped: [] })
    await act(async () => button('按项目目录顺序导出').click())
    expect(fixture.setNotice).toHaveBeenLastCalledWith(expect.stringContaining('成功 1 个，未导出 1 个'))
    fixture.setNotice.mockClear()
    await act(async () => button('按项目目录顺序导出').click())
    expect(fixture.setNotice).not.toHaveBeenCalled()
  })
})
