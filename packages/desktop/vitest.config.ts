import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadApplication, runtimeRoot } from './application.mjs'

const application = loadApplication()
export default defineConfig({
  root: resolve(runtimeRoot, '../..'),
  cacheDir: resolve(runtimeRoot, 'node_modules/.vite'),
  server: { fs: { strict: false, allow: [resolve(runtimeRoot, '../..'), tmpdir()] } },
  resolve: {
    alias: [
      ...['protocol', 'node', 'effect', 'plugin', 'analysis', 'agent', 'testing'].map((name) => ({
        find: '@graphframework/sdk/' + name, replacement: resolve(runtimeRoot, '../sdk/javascript/src', name, 'index.ts'),
      })),
      ...['workbench', 'ui', 'context', 'client'].map((name) => ({
        find: new RegExp(`^@graphframework/${name}($|/.*$)`),
        replacement: `${resolve(runtimeRoot, '../frontend', name, name === 'workbench' ? 'src' : '')}$1`,
      })),
      ...Object.entries({
        'graph-host': 'host/native-graph-host.mjs', 'element-catalog': 'host/services/element-catalog.mjs',
        'agent-control': 'host/services/agent-control.mjs', 'application': 'application.mjs',
        'electron-window': 'host/effects/electron-window-adapter.mjs', 'window-options': 'host/services/window-options.mjs',
      }).map(([name, entry]) => ({ find: '@graphframework/desktop/' + name, replacement: resolve(runtimeRoot, entry) })),
      { find: /^yaml$/, replacement: resolve(runtimeRoot, 'node_modules/yaml/dist/index.js') },
      { find: /^react$/, replacement: resolve(runtimeRoot, 'node_modules/react/index.js') },
      { find: /^react-dom$/, replacement: resolve(runtimeRoot, 'node_modules/react-dom/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(runtimeRoot, 'node_modules/react/jsx-runtime.js') },
      { find: /^react-dom\/client$/, replacement: resolve(runtimeRoot, 'node_modules/react-dom/client.js') },
      { find: /^lucide-react$/, replacement: resolve(runtimeRoot, 'node_modules/lucide-react/dist/esm/lucide-react.mjs') },
    ],
  },
  plugins: [{
    name: 'graphframework-test-elements',
    resolveId(id) { if (['virtual:graphframework-elements', 'virtual:graphframework-config'].includes(id)) return '\0' + id },
    load(id) {
      if (id === '\0virtual:graphframework-config') return `export const applicationDefinition = ${JSON.stringify(application.definition)};`
      if (id !== '\0virtual:graphframework-elements') return
      const entries = application.plugins.flatMap((plugin) => (plugin.manifest.contributes?.elements ?? []).map((elementId: string) => (
        `${JSON.stringify(plugin.id + '/' + elementId)}: () => import(${JSON.stringify(resolve(plugin.directory, 'elements', elementId, 'element.ts').replaceAll('\\', '/'))})`
      )))
      return `export const elementModules = {${entries.join(',')}};`
    },
  }],
  test: {
    include: ['packages/desktop/application.test.mjs', 'packages/desktop/host/**/*.test.{mjs,ts}', 'app/plugins/*/{backend,frontend,elements,desktop,tests,resources}/**/*.test.{mjs,ts,tsx}', 'app/plugins/*/*/{backend,frontend,elements,desktop,tests,resources}/**/*.test.{mjs,ts,tsx}', 'app/plugins/*/backend.test.mjs', 'packages/frontend/*/{src,styles}/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*live*.test.ts', '**/*workflow-test*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['**/frontend/**/*.test.*', 'jsdom'], ['**/elements/**/*.test.*', 'jsdom']],
  },
})
