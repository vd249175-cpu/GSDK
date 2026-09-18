import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { signalProjectChanged } from '../../resources/tools/service.mjs'
import { ProjectExternalSync } from './project-external-sync.mjs'

import { openLocalProject, saveProjectSnapshot } from './project-store.mjs'

const roots = []
const synchronizers = []

afterEach(async () => {
  synchronizers.splice(0).forEach((synchronizer) => synchronizer.stop())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ProjectExternalSync', () => {
  it('reloads the active project after an external project command finishes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-external-sync-'))
    roots.push(root)
    await openLocalProject(root)
    await saveProjectSnapshot(root, {
      markdown: '<project-structure>\n# 项目\n</project-structure>',
      nodes: [],
    })

    let resolveUpdate
    const update = new Promise((resolve, reject) => {
      resolveUpdate = resolve
      setTimeout(() => reject(new Error('External project update timed out')), 2000)
    })
    const synchronizer = new ProjectExternalSync(resolveUpdate)
    synchronizers.push(synchronizer)
    await synchronizer.start(root)
    await signalProjectChanged(root, 'test')

    await expect(update).resolves.toMatchObject({ path: root, markdown: expect.stringContaining('# 项目') })
  })
})
