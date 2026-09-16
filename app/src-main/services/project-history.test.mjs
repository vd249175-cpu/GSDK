import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectHistoryStore } from './project-history.mjs'

let temporaryRoot
let store

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'graphvideo-history-'))
  store = new ProjectHistoryStore(join(temporaryRoot, 'project-history.json'), 3)
})

afterEach(async () => {
  const root = resolve(temporaryRoot)
  if (root.startsWith(resolve(tmpdir())) && basename(root).startsWith('graphvideo-history-')) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('Project history store', () => {
  it('keeps the most recently opened project first without duplicates', async () => {
    const firstDir = join(temporaryRoot, 'first')
    const secondDir = join(temporaryRoot, 'second')
    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })

    await store.record(firstDir, 10)
    await store.record(secondDir, 20)
    await store.record(firstDir, 30)

    const projects = await store.list()
    expect(projects.map((project) => project.name)).toEqual(['first', 'second'])
    expect(projects[0].openedAt).toBe(30)
  })

  it('removes an unavailable project and respects the history limit', async () => {
    const firstDir = join(temporaryRoot, 'first')
    const secondDir = join(temporaryRoot, 'second')
    const thirdDir = join(temporaryRoot, 'third')
    const fourthDir = join(temporaryRoot, 'fourth')
    await mkdir(firstDir, { recursive: true })
    await mkdir(secondDir, { recursive: true })
    await mkdir(thirdDir, { recursive: true })
    await mkdir(fourthDir, { recursive: true })

    await store.record(firstDir, 10)
    await store.record(secondDir, 20)
    await store.record(thirdDir, 30)
    await store.record(fourthDir, 40)
    await store.remove(thirdDir)

    expect((await store.list()).map((project) => project.name)).toEqual(['fourth', 'second'])
  })

  it('automatically excludes and prunes non-existent or deleted project directories when listing', async () => {
    const aliveDir = join(temporaryRoot, 'alive')
    const deletedDir = join(temporaryRoot, 'deleted')
    await mkdir(aliveDir, { recursive: true })
    await mkdir(deletedDir, { recursive: true })

    await store.record(aliveDir, 10)
    await store.record(deletedDir, 20)

    // Manually delete deletedDir from disk
    await rm(deletedDir, { recursive: true, force: true })

    // list() should automatically exclude and prune deletedDir
    const projects = await store.list()
    expect(projects.map((project) => project.name)).toEqual(['alive'])

    // Calling list() again confirms it was pruned from disk store
    const prunedProjects = await store.list()
    expect(prunedProjects.map((project) => project.name)).toEqual(['alive'])
  })
})
