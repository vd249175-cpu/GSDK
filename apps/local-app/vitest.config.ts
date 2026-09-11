import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@graphvideo/client-sdk', replacement: resolve(__dirname, 'renderer/src/studio/client-sdk.ts') },
      { find: '@graphvideo/workbench', replacement: resolve(__dirname, '../../sdk/workbench/src') },
      { find: '@graphvideo/sdk/workbench', replacement: resolve(__dirname, '../../sdk/workbench/src') },
      { find: '@graphvideo/domain', replacement: resolve(__dirname, 'src-main/studio/domain/launchpad-scheduler.ts') },
      { find: '@graphvideo/sdk/tokens', replacement: resolve(__dirname, '../../sdk/tokens/index.ts') },
      { find: /^\.\.\/\.\.\/\.\.\/shared\/(.*)$/, replacement: `${resolve(__dirname, 'src-main/shared')}/$1` },
      { find: /^\.\.\/\.\.\/\.\.\/\.\.\/app\/shared\/(.*)$/, replacement: `${resolve(__dirname, 'src-main/shared')}/$1` },
    ],
  },
  test: {
    include: ['plugins/**/*.test.{mjs,ts}', 'src-main/**/*.test.{mjs,ts}', 'resources/**/*.test.{mjs,ts}'],
    environment: 'node',
  },
})
