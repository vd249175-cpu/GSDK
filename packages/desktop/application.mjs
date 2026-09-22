import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const runtimeRoot = dirname(fileURLToPath(import.meta.url))
function entryInside(directory, entry) {
  if (typeof entry !== 'string' || !entry || isAbsolute(entry)) throw new Error('Invalid application entry')
  const target = resolve(directory, entry)
  const rel = relative(directory, target)
  if (rel === '..' || rel.startsWith('..' + sep)) throw new Error('Application entry escapes its plugin')
  return target
}

function entryExists(directory, entry) {
  try {
    entryInside(directory, entry)
  } catch { return false }
  return existsSync(resolve(directory, entry))
}

/** Outer-host configuration; plugin directories may live anywhere on disk. */
export function loadApplication(file = process.env.GRAPHFRAMEWORK_APPLICATION ?? resolve(runtimeRoot, '../../app/application.json')) {
  const applicationPath = resolve(file)
  const directory = dirname(applicationPath)
  const definition = JSON.parse(readFileSync(applicationPath, 'utf8'))
  if (!Array.isArray(definition.plugins)) throw new Error('Application requires a plugins list')
  const ids = new Set()
  const plugins = definition.plugins.map((plugin) => {
    // Same plugin id may appear twice with different paths: backend/frontend
    // split packages share the id but live in separate directories.
    const key = `${plugin.path}\0${plugin.id}`
    if (ids.has(key)) throw new Error('Duplicate application plugin: ' + plugin.id)
    ids.add(key)
    const pluginDirectory = resolve(directory, plugin.path)
    const manifestPath = resolve(pluginDirectory, 'graphframework.plugin.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.id !== plugin.id || (manifest.apiVersion !== 1 && manifest.apiVersion !== 2)) {
      throw new Error('Application plugin identity/API mismatch: ' + plugin.id)
    }
    return { id: plugin.id, directory: pluginDirectory, manifest }
  })
  function resolveEntry(entry) {
    const candidates = plugins.filter((item) => item.id === entry?.pluginId)
    if (candidates.length === 0) throw new Error('Application entry references a disabled plugin')
    const plugin = candidates.find((item) => entryExists(item.directory, entry.entry)) ?? candidates[0]
    return entryInside(plugin.directory, entry.entry)
  }
  return {
    definition, applicationPath, directory, plugins, runtimeRoot,
    hostEntry: resolveEntry(definition.desktop?.host), rendererEntry: resolveEntry(definition.desktop?.renderer),
    rendererFile: resolve(runtimeRoot, 'dist/renderer/index.html'),
  }
}
