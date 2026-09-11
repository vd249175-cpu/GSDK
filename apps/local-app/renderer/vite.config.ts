import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const here = resolve(__dirname)

export default defineConfig({
  root: here,
  base: './',
  resolve: {
    alias: [
      { find: '@graphvideo/workbench', replacement: resolve(here, '../../../sdk/workbench/src') },
      { find: '@graphvideo/client-sdk', replacement: resolve(here, 'src/studio/client-sdk.ts') },
      { find: '@graphvideo/domain', replacement: resolve(here, '../src-main/studio/domain/launchpad-scheduler.ts') },
      { find: '@graphvideo/sdk/tokens', replacement: resolve(here, '../../../sdk/tokens/index.ts') },
      { find: /^\.\.\/\.\.\/\.\.\/shared\/(.*)$/, replacement: `${resolve(here, '../src-main/shared')}/$1` },
      { find: /^\.\.\/\.\.\/\.\.\/\.\.\/app\/shared\/(.*)$/, replacement: `${resolve(here, '../src-main/shared')}/$1` },
    ],
  },
  plugins: [react()],
  build: { outDir: '../renderer-dist', emptyOutDir: true },
})
