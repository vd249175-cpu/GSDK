import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const nativeImport = new Function('specifier', 'return import(specifier)');

/** Enabled plugins use one loader; the host has no built-in product identity. */
export async function loadBackendPlugins(application, { backendOutfile } = {}) {
  const plugins = []
  for (const plugin of application.plugins) {
    if (plugin.manifest.kind === 'frontend') continue
    if (plugin.manifest.apiVersion === 2 && plugin.manifest.kind !== 'backend') {
      throw new Error('Invalid backend plugin kind: ' + plugin.id)
    }
    const backend = plugin.manifest.contributes?.backend
    if (!backend) continue
    // Run-scoped builds redirect TS/MJS backends into the run's own generated
    // directory; default keeps the beside-source backend.js convention.
    const entry = typeof backendOutfile === 'function'
      ? backendOutfile(plugin)
      : /\.(?:ts|mjs)$/.test(backend) ? 'backend.js' : backend
    const module = await nativeImport(pathToFileURL(resolve(plugin.directory, entry)).href)
    if (module.default?.id !== plugin.id || typeof module.default?.createNodes !== 'function') {
      throw new Error('Invalid backend plugin: ' + plugin.id)
    }
    if (module.default.createNodes === undefined) throw new Error('Invalid backend plugin: ' + plugin.id)
    plugins.push(module.default)
  }
  return plugins
}

/** Frontend plugins carry no createNodes: elements/workspaces only. */
export async function loadFrontendPlugins(application) {
  const plugins = []
  for (const plugin of application.plugins) {
    if (plugin.manifest.apiVersion === 2 && plugin.manifest.kind !== 'frontend') continue
    if (plugin.manifest.apiVersion === 1) continue
    if (plugin.manifest.contributes?.createNodes !== undefined) {
      throw new Error('Invalid frontend plugin (must not contain createNodes): ' + plugin.id)
    }
    plugins.push({ id: plugin.id, manifest: plugin.manifest, directory: plugin.directory })
  }
  return plugins
}
