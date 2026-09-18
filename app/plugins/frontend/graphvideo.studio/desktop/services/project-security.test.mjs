import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveProjectPath } from './project-paths.mjs'
import { openLocalProject, persistGraphMetadata, resolveProjectNodeVersionPath, resolveProjectNodeVersionPathSync, saveProjectNode, writeProjectNodeMediaBuffer } from './project-store.mjs'
import { branchProjectSnapshot, createProjectSnapshot, listProjectSnapshots } from './project-snapshot-store.mjs'
import { GenerationAdapterWorkerHost } from './generation-adapter-worker.mjs'

let fixture, project, outside
const links = []
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'gv-security-'))
  project = join(fixture, 'project'); outside = join(fixture, 'outside')
  await mkdir(project); await mkdir(outside)
})
afterEach(async () => {
  for (const path of links.splice(0)) await unlink(path)
  const target = resolve(fixture)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('gv-security-')) throw new Error('Unsafe cleanup')
  await rm(target, { recursive: true, force: true })
})
async function junction(source, destination) {
  await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
  links.push(destination)
}
const node = { id: 'video', type: 'video', title: 'Video', description: '', history: [
  { id: 'v1', relativePath: 'nodes/video/media/sentinel.mp4', current: true },
] }

describe('physical project security boundary', () => {
  it('rejects media reads, writes and worker downloads through a junction', async () => {
    await openLocalProject(project); await saveProjectNode(project, node)
    await mkdir(join(project, 'nodes/video'), { recursive: true })
    await writeFile(join(outside, 'sentinel.mp4'), 'outside')
    await junction(outside, join(project, 'nodes/video/media'))
    await expect(resolveProjectNodeVersionPath(project, 'video', 'v1')).rejects.toThrow(/链接|junction/)
    expect(() => resolveProjectNodeVersionPathSync(project, 'video', 'v1')).toThrow(/链接|junction/)
    await expect(writeProjectNodeMediaBuffer(project, 'video', 'new.mp4', Buffer.from('new'))).rejects.toThrow(/链接|junction/)
    const host = new GenerationAdapterWorkerHost({ workspaceRoot: process.cwd(), getProjectRoot: () => project })
    host.child = {}
    host.send = () => { throw new Error('Worker must not receive unsafe paths') }
    await expect(host.executeOperation({ operation: 'download', artifact: { provider: 'mock' }, destinationRelativePath: 'nodes/video/media/new.mp4' })).rejects.toThrow(/链接|junction/)
    await expect(host.executeOperation({ operation: 'submit', spec: { provider: 'comfy', uploads: [{ sourcePath: join(project, 'nodes/video/media/sentinel.mp4') }] } })).rejects.toThrow(/链接|junction/)
    expect(await readdir(outside)).toEqual(['sentinel.mp4'])
    expect(await readFile(join(outside, 'sentinel.mp4'), 'utf8')).toBe('outside')
  })

  it('rejects a linked database directory before creating any outside SQLite files', async () => {
    await junction(outside, join(project, '.graphvideo'))
    await expect(openLocalProject(project)).rejects.toThrow(/链接|junction/)
    await expect(persistGraphMetadata(project, [])).rejects.toThrow(/链接|junction/)
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects multiply-linked databases and SQLite sidecars', async () => {
    await openLocalProject(project)
    await link(join(project, '.graphvideo/nodes.sqlite'), join(outside, 'database.sqlite'))
    await expect(persistGraphMetadata(project, [])).rejects.toThrow(/硬链接/)
    await unlink(join(outside, 'database.sqlite'))
    await writeFile(join(outside, 'sidecar'), 'sentinel')
    await link(join(outside, 'sidecar'), join(project, '.graphvideo/nodes.sqlite-journal'))
    await expect(openLocalProject(project)).rejects.toThrow(/硬链接/)
    expect(await readFile(join(outside, 'sidecar'), 'utf8')).toBe('sentinel')
  })

  it.each(['../outside/file', '..\\outside\\file', 'nodes/file:stream', 'nodes/alias. /file'])('rejects unsafe path %s', (path) => {
    if (process.platform !== 'win32' && path.includes('\\')) return
    expect(() => resolveProjectPath(project, path)).toThrow()
  })

  it('preserves normal media writing and version resolution', async () => {
    await openLocalProject(project); await saveProjectNode(project, { ...node, history: [] })
    const updated = await writeProjectNodeMediaBuffer(project, 'video', 'new.mp4', Buffer.from('fixture'))
    const path = await resolveProjectNodeVersionPath(project, 'video', updated.history[0].id)
    expect(await readFile(path, 'utf8')).toBe('fixture')
  })
})

describe('snapshot catalog security', () => {
  it.each(['../../../outside.sqlite', '..\\..\\outside.sqlite', '/outside.sqlite', 'C:\\outside.sqlite', 'snapshot.sqlite:stream'])('rejects catalog filename %s before changing the project', async (fileName) => {
    await openLocalProject(project); await saveProjectNode(project, { ...node, history: [] })
    await createProjectSnapshot(project, 'safe')
    const catalogPath = join(project, '.graphvideo/snapshots/catalog.json')
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    catalog.snapshots[0].fileName = fileName
    const altered = JSON.stringify(catalog)
    await writeFile(catalogPath, altered)
    await expect(branchProjectSnapshot(project, catalog.snapshots[0].id, 'evil')).rejects.toThrow(/文件名无效/)
    expect(await readFile(catalogPath, 'utf8')).toBe(altered)
    expect((await openLocalProject(project)).nodes[0].title).toBe('Video')
  })

  it('rejects a snapshot directory junction', async () => {
    await openLocalProject(project)
    await junction(outside, join(project, '.graphvideo/snapshots'))
    await expect(listProjectSnapshots(project)).rejects.toThrow(/链接|junction/)
    expect(await readdir(outside)).toEqual([])
  })
})
