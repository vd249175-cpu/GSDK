import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { parseStudioPluginManifest } from '@graphvideo/backend-sdk'

async function directoriesAt(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

function pathInside(root, ...parts) {
  const rootPath = resolve(root)
  const targetPath = resolve(rootPath, ...parts)
  const pathFromRoot = relative(rootPath, targetPath)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')) {
    return targetPath
  }
  throw new Error('源码目录路径越界')
}

async function hashDirectory(directory) {
  const hash = createHash('sha256')
  async function append(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = pathInside(current, entry.name)
      if (entry.isDirectory()) await append(entryPath)
      else if (entry.isFile()) {
        hash.update(relative(directory, entryPath).split(sep).join('/'))
        hash.update(await readFile(entryPath))
      }
    }
  }
  await append(directory)
  return hash.digest('hex').slice(0, 16)
}

function assertUnique(items, idField, kind) {
  const owners = new Map()
  for (const item of items) {
    const id = item[idField]
    const owner = item.pluginId ?? 'built-in'
    const previous = owners.get(id)
    if (previous) throw new Error(`${kind} ID 冲突: ${id} (${previous} / ${owner})`)
    owners.set(id, owner)
  }
}

export class ElementCatalog {
  constructor({ elementsRoot, workspacesRoot, pluginsRoot, pluginIds = null }) {
    this.elementsRoot = elementsRoot
    this.workspacesRoot = workspacesRoot
    this.pluginsRoot = pluginsRoot
    this.pluginIds = Array.isArray(pluginIds) ? new Set(pluginIds) : null
  }

  async scan() {
    const elements = []
    const plugins = []
    if (this.elementsRoot) {
      for (const elementId of await directoriesAt(this.elementsRoot)) {
        const directory = pathInside(this.elementsRoot, elementId)
        try {
          const manifestText = await readFile(pathInside(directory, 'element.json'), 'utf8')
          elements.push({
            elementId,
            manifestText,
            version: await hashDirectory(directory),
            pluginId: 'built-in',
          })
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
        }
      }
    }

    const workspaces = []
    if (this.workspacesRoot) {
      for (const workspaceId of await directoriesAt(this.workspacesRoot)) {
        const directory = pathInside(this.workspacesRoot, workspaceId)
        try {
          workspaces.push({
            workspaceId,
            definitionText: await readFile(pathInside(directory, 'workspace.json'), 'utf8'),
            version: await hashDirectory(directory),
            pluginId: 'built-in',
          })
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
        }
      }
    }
    if (this.pluginsRoot) {
      for (const pluginDirectoryId of await directoriesAt(this.pluginsRoot)) {
        if (this.pluginIds && !this.pluginIds.has(pluginDirectoryId)) continue
        const pluginDirectory = pathInside(this.pluginsRoot, pluginDirectoryId)
        let manifest
        try {
          manifest = parseStudioPluginManifest(
            await readFile(pathInside(pluginDirectory, 'graphvideo.plugin.json'), 'utf8'),
          )
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
          throw error
        }
        if (manifest.id !== pluginDirectoryId) {
          throw new Error(`Plugin 目录名与 Manifest ID 不一致: ${pluginDirectoryId} / ${manifest.id}`)
        }
        const pluginVersion = await hashDirectory(pluginDirectory)
        plugins.push({
          pluginId: manifest.id,
          version: pluginVersion,
          hasBackend: Boolean(manifest.contributes.backend),
          elements: [...manifest.contributes.elements],
          workspaces: [...manifest.contributes.workspaces],
        })
        for (const elementId of manifest.contributes.elements) {
          const directory = pathInside(pluginDirectory, 'elements', elementId)
          elements.push({
            elementId,
            manifestText: await readFile(pathInside(directory, 'element.json'), 'utf8'),
            version: pluginVersion,
            pluginId: manifest.id,
          })
        }
        for (const workspaceId of manifest.contributes.workspaces) {
          const directory = pathInside(pluginDirectory, 'workspaces', workspaceId)
          workspaces.push({
            workspaceId,
            definitionText: await readFile(pathInside(directory, 'workspace.json'), 'utf8'),
            version: pluginVersion,
            pluginId: manifest.id,
          })
        }
      }
    }
    assertUnique(elements, 'elementId', 'Element')
    assertUnique(workspaces, 'workspaceId', 'Workspace')
    return { elements, workspaces, plugins }
  }
}
