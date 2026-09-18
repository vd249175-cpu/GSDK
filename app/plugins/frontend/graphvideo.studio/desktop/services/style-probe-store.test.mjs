import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createStyleProbeTarget, deleteStyleProbeTarget, importStyleProbeMedia,
  listStyleProbeTargets, readStyleProbeTarget, saveStyleProbeTarget,
} from './style-probe-store.mjs'

let projectRoot

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'gv-style-probe-'))
})

afterEach(async () => {
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

describe('Style Probe Store', () => {
  it('creates, lists, reads, updates, and deletes target markdown documents', async () => {
    expect(await listStyleProbeTargets(projectRoot)).toEqual([])

    const created = await createStyleProbeTarget(projectRoot, 'ink-style', '赛博水墨')
    expect(created.fileName).toBe('ink-style.md')
    expect(created.title).toBe('赛博水墨')

    const list = await listStyleProbeTargets(projectRoot)
    expect(list).toHaveLength(1)
    expect(list[0].fileName).toBe('ink-style.md')
    expect(list[0].title).toBe('赛博水墨')

    const content = await readStyleProbeTarget(projectRoot, 'ink-style.md')
    expect(content).toContain('# 赛博水墨')
    expect(content).toContain('<prompt_queue>')

    const updated = content.replace('## 目标描述', '## 目标描述\n高对比度霓虹边缘')
    await saveStyleProbeTarget(projectRoot, 'ink-style.md', updated)
    expect(await readStyleProbeTarget(projectRoot, 'ink-style.md')).toContain('高对比度霓虹边缘')

    await deleteStyleProbeTarget(projectRoot, 'ink-style.md')
    expect(await listStyleProbeTargets(projectRoot)).toEqual([])
  })

  it('imports local media into the project media folder', async () => {
    const dummyImage = join(projectRoot, 'temp-sample.png')
    await writeFile(dummyImage, 'image-binary-content')

    const relPath = await importStyleProbeMedia(projectRoot, dummyImage, 'ref')
    expect(relPath).toMatch(/^media\/ref-.*\.png$/)

    const storedContent = await readFile(join(projectRoot, relPath), 'utf8')
    expect(storedContent).toBe('image-binary-content')
  })
})
