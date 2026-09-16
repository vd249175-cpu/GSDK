import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@graphvideo/client-sdk', replacement: resolve(__dirname, 'renderer/src/studio/client-sdk.ts') },
      { find: '@graphvideo/workbench', replacement: resolve(__dirname, '../packages/frontend/workbench/src') },
      { find: '@graphvideo/sdk/workbench', replacement: resolve(__dirname, '../packages/frontend/workbench/src') },
      { find: '@graphvideo/sdk/protocol', replacement: resolve(__dirname, '../packages/sdk/javascript/src/protocol/index.ts') },
      { find: '@graphvideo/sdk/node', replacement: resolve(__dirname, '../packages/sdk/javascript/src/node/index.ts') },
      { find: '@graphvideo/sdk/effect', replacement: resolve(__dirname, '../packages/sdk/javascript/src/effect/index.ts') },
      { find: '@graphvideo/sdk/plugin', replacement: resolve(__dirname, '../packages/sdk/javascript/src/plugin/index.ts') },
      { find: '@graphvideo/sdk/analysis', replacement: resolve(__dirname, '../packages/sdk/javascript/src/analysis/index.ts') },
      { find: '@graphvideo/sdk/agent', replacement: resolve(__dirname, '../packages/sdk/javascript/src/agent/index.ts') },
      { find: '@graphvideo/sdk/testing', replacement: resolve(__dirname, '../packages/sdk/javascript/src/testing/index.ts') },
      { find: '@graphvideo/domain', replacement: resolve(__dirname, '../plugins/graphvideo.studio/backend/domain/launchpad-scheduler.ts') },
      { find: '@graphvideo/sdk/tokens', replacement: resolve(__dirname, '../packages/frontend/tokens/index.ts') },
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
