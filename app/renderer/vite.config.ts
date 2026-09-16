import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const here = resolve(__dirname)

export default defineConfig({
  root: here,
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom', 'lucide-react'],
    conditions: ['module', 'browser', 'default'],
    alias: [
      { find: '@graphvideo/sdk/protocol', replacement: resolve(here, '../../packages/sdk/javascript/src/protocol/index.ts') },
      { find: /^react$/, replacement: resolve(here, '../node_modules/react/index.js') },
      { find: /^react-dom$/, replacement: resolve(here, '../node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: resolve(here, '../node_modules/react-dom/client.js') },
      { find: /^lucide-react$/, replacement: resolve(here, '../node_modules/lucide-react/dist/esm/lucide-react.mjs') },
      { find: /^yaml$/, replacement: resolve(here, '../node_modules/yaml/browser/index.js') },
      { find: /^@graphvideo\/workbench($|\/.*$)/, replacement: `${resolve(here, '../../packages/frontend/workbench/src')}$1` },
      { find: /^@graphvideo\/ui($|\/.*$)/, replacement: `${resolve(here, '../../packages/frontend/ui')}$1` },
      { find: /^@graphvideo\/tokens($|\/.*$)/, replacement: `${resolve(here, '../../packages/frontend/tokens')}$1` },
      { find: /^@graphvideo\/client($|\/.*$)/, replacement: `${resolve(here, '../../packages/frontend/client')}$1` },
      { find: '@graphvideo/client-sdk', replacement: resolve(here, 'src/studio/client-sdk.ts') },
      { find: '@graphvideo/domain', replacement: resolve(here, '../../plugins/graphvideo.studio/backend/domain/launchpad-scheduler.ts') },
      { find: /^\.\.\/\.\.\/\.\.\/shared\/(.*)$/, replacement: `${resolve(here, '../../plugins/graphvideo.studio/backend/shared')}/$1` },
      { find: /^\.\.\/\.\.\/\.\.\/\.\.\/app\/shared\/(.*)$/, replacement: `${resolve(here, '../../plugins/graphvideo.studio/backend/shared')}/$1` },
    ],
  },
  plugins: [react()],
  build: { outDir: '../renderer-dist', emptyOutDir: true },
})
