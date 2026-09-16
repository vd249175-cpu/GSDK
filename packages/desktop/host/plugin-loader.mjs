import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** Enabled plugins use one loader; the host has no built-in product identity. */
export async function loadBackendPlugins(application) {
  const plugins = []
  for (const plugin of application.plugins) {
    const backend = plugin.manifest.contributes?.backend
    if (!backend) continue
    const entry = /\.(?:ts|mjs)$/.test(backend) ? 'backend.js' : backend
    const module = await import(pathToFileURL(resolve(plugin.directory, entry)).href)
    if (module.default?.id !== plugin.id || typeof module.default?.createNodes !== 'function') {
      throw new Error('Invalid backend plugin: ' + plugin.id)
    }
    plugins.push(module.default)
  }
  return plugins
}
