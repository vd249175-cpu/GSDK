import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  branchProjectSnapshot, createProjectSnapshot, listProjectSnapshots,
} from './project-snapshot-store.mjs'
import {
  minimalProjectMarkdown, openLocalProject, saveProjectNode, saveProjectSnapshot,
} from './project-store.mjs'

let projectRoot

afterEach(async () => {
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true })
  projectRoot = undefined
})

function textNode(title, content) {
  return {
    id: 'story',
    type: 'text',
    title,
    description: '',
    content,
    history: [],
  }
}

describe('project SQLite snapshots', () => {
  it('restores a selected snapshot into a new logical branch', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'graphvideo-snapshots-'))
    await openLocalProject(projectRoot)
    await saveProjectSnapshot(projectRoot, {
      markdown: minimalProjectMarkdown,
      nodes: [textNode('版本 A', 'A')],
    })

    const firstGraph = await createProjectSnapshot(projectRoot, '初稿')
    const first = firstGraph.snapshots[0]
    await saveProjectNode(projectRoot, textNode('版本 B', 'B'))
    await createProjectSnapshot(projectRoot, '调整稿')

    const branched = await branchProjectSnapshot(projectRoot, first.id, '实验方案')
    const activeBranch = branched.branches.find((branch) => branch.id === branched.activeBranchId)
    const reopened = await openLocalProject(projectRoot)

    expect(activeBranch).toMatchObject({
      name: '实验方案',
      sourceSnapshotId: first.id,
      headSnapshotId: first.id,
    })
    expect(reopened.nodes[0]).toMatchObject({ title: '版本 A', content: 'A' })
    expect(branched.snapshots.some((snapshot) => snapshot.kind === 'recovery')).toBe(true)

    const branchHead = await createProjectSnapshot(projectRoot, '实验稿一')
    const latest = branchHead.snapshots.at(-1)
    expect(latest).toMatchObject({
      branchId: activeBranch.id,
      parentId: first.id,
      kind: 'manual',
    })

    await expect(listProjectSnapshots(projectRoot)).resolves.toEqual(branchHead)
  })
})
