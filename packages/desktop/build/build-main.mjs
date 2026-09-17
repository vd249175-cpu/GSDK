import { build } from 'esbuild'
import { readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { loadApplication, runtimeRoot } from '../application.mjs'

const runBackendDir = typeof process.env.GRAPHVIDEO_RUN_BACKEND_DIR === 'string' && process.env.GRAPHVIDEO_RUN_BACKEND_DIR
  ? process.env.GRAPHVIDEO_RUN_BACKEND_DIR
  : null
const application = loadApplication()
const alias = Object.fromEntries(['protocol', 'node', 'effect', 'plugin', 'analysis', 'agent', 'testing'].map((name) => [
  '@graphvideo/sdk/' + name, resolve(runtimeRoot, '../sdk/javascript/src', name, 'index.ts'),
]))
alias.yaml = resolve(runtimeRoot, 'node_modules/yaml/browser/index.js')
async function bundle(entry, outfile) {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm',
    alias, external: ['*.node', 'typescript', 'electron', '@graphvideo/desktop/*'], logLevel: 'warning' })
}

await bundle(resolve(runtimeRoot, 'host/native-graph-host.mjs'), resolve(runtimeRoot, 'host/native-graph-host.js'))
await bundle(resolve(runtimeRoot, 'host/services/element-catalog.mjs'), resolve(runtimeRoot, 'host/services/element-catalog.js'))
async function buildHostSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    const file = resolve(directory, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') await buildHostSources(file)
    else if (entry.isFile() && extname(file) === '.ts' && !/\.(?:test|d)\.ts$/.test(file)) {
      await bundle(file, file.slice(0, -3) + '.js')
    }
  }
}
for (const plugin of application.plugins) {
  const backend = plugin.manifest.contributes?.backend
  if (backend && /\.(?:ts|mjs)$/.test(backend)) {
    // Run-scoped builds keep generated JS inside the run; default preserves
    // the beside-source backend.js convention used by the Studio entry.
    const outfile = runBackendDir
      ? resolve(runBackendDir, `${plugin.id}.backend.js`)
      : resolve(plugin.directory, 'backend.js')
    await bundle(resolve(plugin.directory, backend), outfile)
  }
  await buildHostSources(resolve(plugin.directory, 'desktop'))
}
console.log('Desktop host and enabled plugin sources built')
