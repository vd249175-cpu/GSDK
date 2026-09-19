import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath } from 'vite'
import { resolve } from 'node:path'
import { loadApplication, runtimeRoot } from '../application.mjs'

const application = loadApplication()
const virtualIds = ['virtual:graphframework-application', 'virtual:graphframework-elements', 'virtual:graphframework-config']
export default defineConfig({
  root: resolve(runtimeRoot, 'renderer'), base: './',
  resolve: {
    dedupe: ['react', 'react-dom', 'lucide-react'],
    alias: [
      { find: '@graphframework/sdk/protocol', replacement: resolve(runtimeRoot, '../sdk/javascript/src/protocol/index.ts') },
      { find: /^react$/, replacement: resolve(runtimeRoot, 'node_modules/react/index.js') },
      { find: /^react-dom$/, replacement: resolve(runtimeRoot, 'node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: resolve(runtimeRoot, 'node_modules/react-dom/client.js') },
      { find: /^lucide-react$/, replacement: resolve(runtimeRoot, 'node_modules/lucide-react/dist/esm/lucide-react.mjs') },
      { find: /^yaml$/, replacement: resolve(runtimeRoot, 'node_modules/yaml/browser/index.js') },
      { find: /^@graphframework\/theme$/, replacement: resolve(runtimeRoot, '../frontend/theme/index.css') },
      ...['workbench', 'ui', 'context', 'client', 'theme'].map((name) => ({
        find: new RegExp(`^@graphframework/${name}($|/.*$)`),
        replacement: `${resolve(runtimeRoot, '../frontend', name, name === 'workbench' ? 'src' : '')}$1`,
      })),
    ],
  },
  plugins: [react(), {
    name: 'graphframework-application',
    resolveId(id) { if (virtualIds.includes(id)) return '\0' + id },
    load(id) {
      if (id === '\0virtual:graphframework-config') return `export const applicationDefinition = ${JSON.stringify(application.definition)};`
      if (id === '\0virtual:graphframework-application') return `import ${JSON.stringify(normalizePath(application.rendererEntry))};`
      if (id === '\0virtual:graphframework-elements') {
        const entries = application.plugins.flatMap((plugin) => (plugin.manifest.contributes?.elements ?? []).map((elementId: string) => {
          const entry = resolve(plugin.directory, 'elements', elementId, 'element.ts')
          return `${JSON.stringify(plugin.id + '/' + elementId)}: () => import(${JSON.stringify(normalizePath(entry))})`
        }))
        return `export const elementModules = {${entries.join(',')}};`
      }
    },
    transformIndexHtml(html) {
      return html.replace(/<title>.*?<\/title>/, `<title>${String(application.definition.name).replace(/[<>&]/g, '')}</title>`)
    },
  }],
  server: { fs: { allow: [runtimeRoot, application.directory, resolve(runtimeRoot, '..'), ...application.plugins.map((plugin) => plugin.directory)] } },
  build: { outDir: resolve(runtimeRoot, 'dist/renderer'), emptyOutDir: true },
})
