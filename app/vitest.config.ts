import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@graphvideo/client-sdk', replacement: resolve(__dirname, 'renderer/src/studio/client-sdk.ts') },
      { find: /^@graphvideo\/workbench($|\/.*$)/, replacement: `${resolve(__dirname, '../packages/frontend/workbench/src')}$1` },
      { find: /^@graphvideo\/ui($|\/.*$)/, replacement: `${resolve(__dirname, '../packages/frontend/ui')}$1` },
      { find: /^@graphvideo\/tokens($|\/.*$)/, replacement: `${resolve(__dirname, '../packages/frontend/tokens')}$1` },
      { find: /^@graphvideo\/client($|\/.*$)/, replacement: `${resolve(__dirname, '../packages/frontend/client')}$1` },
      { find: '@graphvideo/sdk/protocol', replacement: resolve(__dirname, '../packages/sdk/javascript/src/protocol/index.ts') },
      { find: '@graphvideo/domain', replacement: resolve(__dirname, '../plugins/graphvideo.studio/backend/domain/launchpad-scheduler.ts') },
      { find: /^\.\.\/\.\.\/\.\.\/shared\/(.*)$/, replacement: `${resolve(__dirname, '../plugins/graphvideo.studio/backend/shared')}/$1` },
      { find: /^\.\.\/\.\.\/\.\.\/\.\.\/app\/shared\/(.*)$/, replacement: `${resolve(__dirname, '../plugins/graphvideo.studio/backend/shared')}/$1` },
    ],
  },
  test: {
    include: ['plugins/**/*.test.{mjs,ts}', 'src-main/**/*.test.{mjs,ts}', 'resources/**/*.test.{mjs,ts}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*live*.test.ts', '**/*workflow-test*.test.ts'],
    environment: 'node',
  },
})
