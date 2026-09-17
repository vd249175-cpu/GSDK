import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** Enabled plugins use one loader; the host has no built-in product identity. */
export async function loadBackendPlugins(application, { backendOutfile } = {}) {
  const plugins = []
  for (const plugin of application.plugins) {
    const backend = plugin.manifest.contributes?.backend
    if (!backend) continue
    // Run-scoped builds redirect TS/MJS backends into the run's own generated
    // directory; default keeps the beside-source backend.js convention.
    const entry = typeof backendOutfile === 'function'
      ? backendOutfile(plugin)
      : /\.(?:ts|mjs)$/.test(backend) ? 'backend.js' : backend
    const module = await import(pathToFileURL(resolve(plugin.directory, entry)).href)
    if (module.default?.id !== plugin.id || typeof module.default?.createNodes !== 'function') {
      throw new Error('Invalid backend plugin: ' + plugin.id)
    }
    plugins.push(module.default)
  }
  return plugins
}
