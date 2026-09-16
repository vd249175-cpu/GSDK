import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ElementCatalog } from './element-catalog.mjs'

const temporaryDirectories = []

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'graphvideo-elements-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeElement(directory, id, source = 'export default { register() {} }') {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'element.json'), JSON.stringify({
    id, name: id, apiVersion: 1, entry: 'element.ts',
  }))
  await writeFile(join(directory, 'element.ts'), source)
}

async function writeWorkspace(directory, id) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'workspace.json'), JSON.stringify({
    id, name: id, order: 10, layout: {
      kind: 'area', id: 'main', panelId: 'timeline', instanceId: 'shared-timeline',
    },
  }))
}

async function writePlugin(directory, id, { elements = [], workspaces = [] } = {}) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'graphvideo.plugin.json'), JSON.stringify({
    id, name: id, version: '1.0.0', apiVersion: 1,
    contributes: { elements, workspaces },
  }))
  for (const elementId of elements) {
    await writeElement(join(directory, 'elements', elementId), elementId)
  }
  for (const workspaceId of workspaces) {
    await writeWorkspace(join(directory, 'workspaces', workspaceId), workspaceId)
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('Element source catalog', () => {
  it('scans the single Element root and sibling workspace definitions', async () => {
    const root = await temporaryDirectory()
    const elementsRoot = join(root, 'src', 'elements')
    const workspacesRoot = join(root, 'src', 'workspaces')
    await writeElement(join(elementsRoot, 'timeline'), 'timeline')
    await writeElement(join(elementsRoot, 'storyboard'), 'storyboard')
    await writeWorkspace(join(workspacesRoot, 'editing'), 'editing')
    const catalog = new ElementCatalog({
      elementsRoot, workspacesRoot,
    })

    const result = await catalog.scan()
    expect(result.elements.map((item) => item.elementId)).toEqual(['storyboard', 'timeline'])
    expect(result.workspaces.map((item) => item.workspaceId)).toEqual(['editing'])
    expect(result.elements[1]).toEqual(expect.objectContaining({ elementId: 'timeline' }))
  })

  it('changes a package version when any Element source changes', async () => {
    const root = await temporaryDirectory()
    const elementsRoot = join(root, 'src', 'elements')
    const elementRoot = join(elementsRoot, 'tools')
    await writeElement(elementRoot, 'tools')
    const catalog = new ElementCatalog({
      elementsRoot, workspacesRoot: join(root, 'src', 'workspaces'),
    })
    const first = await catalog.scan()
    await writeFile(join(elementRoot, 'element.ts'), 'export default { register() { return 2 } }')
    const second = await catalog.scan()
    expect(second.elements[0].version).not.toBe(first.elements[0].version)
  })

  it('ignores source directories that do not contain the required manifest', async () => {
    const root = await temporaryDirectory()
    const elementsRoot = join(root, 'src', 'elements')
    await mkdir(join(elementsRoot, 'incomplete'), { recursive: true })
    const catalog = new ElementCatalog({
      elementsRoot, workspacesRoot: join(root, 'src', 'workspaces'),
    })
    await expect(catalog.scan()).resolves.toEqual({ elements: [], workspaces: [], plugins: [] })
  })

  it('discovers plugin-owned Elements and Workspaces through the same catalog', async () => {
    const root = await temporaryDirectory()
    const pluginsRoot = join(root, 'src', 'plugins')
    await writePlugin(join(pluginsRoot, 'example.timeline'), 'example.timeline', {
      elements: ['example.timeline'],
      workspaces: ['example.editing'],
    })
    const catalog = new ElementCatalog({
      elementsRoot: join(root, 'src', 'elements'),
      workspacesRoot: join(root, 'src', 'workspaces'),
      pluginsRoot,
    })

    await expect(catalog.scan()).resolves.toEqual({
      elements: [expect.objectContaining({
        elementId: 'example.timeline', pluginId: 'example.timeline',
      })],
      workspaces: [expect.objectContaining({
        workspaceId: 'example.editing', pluginId: 'example.timeline',
      })],
      plugins: [expect.objectContaining({
        pluginId: 'example.timeline', hasBackend: false,
        elements: ['example.timeline'], workspaces: ['example.editing'],
      })],
    })
  })

  it('rejects IDs contributed by more than one plugin', async () => {
    const root = await temporaryDirectory()
    const pluginsRoot = join(root, 'src', 'plugins')
    await writePlugin(join(pluginsRoot, 'example.one'), 'example.one', { elements: ['shared.panel'] })
    await writePlugin(join(pluginsRoot, 'example.two'), 'example.two', { elements: ['shared.panel'] })
    const catalog = new ElementCatalog({
      elementsRoot: join(root, 'src', 'elements'),
      workspacesRoot: join(root, 'src', 'workspaces'),
      pluginsRoot,
    })

    await expect(catalog.scan()).rejects.toThrow('Element ID 冲突: shared.panel')
  })
})
