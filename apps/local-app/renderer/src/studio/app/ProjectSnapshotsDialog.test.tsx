import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ProjectSnapshotsDialog } from './ProjectSnapshotsDialog'

const graph = {
  activeBranchId: 'main',
  branches: [{
    id: 'main', name: '主分支', createdAt: '2026-08-27T10:00:00.000Z',
    sourceSnapshotId: null, headSnapshotId: 'snapshot-a',
  }],
  snapshots: [{
    id: 'snapshot-a', branchId: 'main', parentId: null, label: '分镜初稿',
    createdAt: '2026-08-27T10:00:00.000Z', sizeBytes: 4096, kind: 'manual' as const,
  }],
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('ProjectSnapshotsDialog', () => {
  it('renders a graphical snapshot lane and creates snapshots and branches from nodes', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const createSnapshot = vi.fn(async () => graph)
    const branchFromSnapshot = vi.fn(async () => ({
      ...graph,
      activeBranchId: 'branch-a',
      branches: [...graph.branches, {
        id: 'branch-a', name: '新版结局', createdAt: '2026-08-27T11:00:00.000Z',
        sourceSnapshotId: 'snapshot-a', headSnapshotId: 'snapshot-a',
      }],
    }))
    const client = {
      listSnapshots: vi.fn(async () => graph),
      createSnapshot,
      branchFromSnapshot,
    }

    await act(async () => {
      root.render(<ProjectSnapshotsDialog client={client} disabled={false} projectName="猫猫短视频" />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click()
      await Promise.resolve()
    })

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.querySelector('[aria-label="项目快照分支图"]')).not.toBeNull()
    expect(dialog?.textContent).toContain('分镜初稿')

    const snapshotName = dialog?.querySelector<HTMLInputElement>('input[placeholder="例如：分镜初稿完成"]')
    await act(async () => {
      if (snapshotName) changeInput(snapshotName, '配音完成')
    })
    const createButton = Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('创建当前快照'))
    await act(async () => {
      createButton?.click()
      await Promise.resolve()
    })
    expect(createSnapshot).toHaveBeenCalledWith('配音完成')

    const branchInput = dialog?.querySelector<HTMLInputElement>('input[placeholder="例如：新版结局"]')
    await act(async () => {
      if (branchInput) changeInput(branchInput, '新版结局')
    })
    const branchButton = Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.includes('从此节点建立分支'))
    await act(async () => {
      branchButton?.click()
      await Promise.resolve()
    })

    expect(branchFromSnapshot).toHaveBeenCalledWith('snapshot-a', '新版结局')

    await act(async () => root.unmount())
    container.remove()
  })
})
