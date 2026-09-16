import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@graphvideo/sdk/protocol': fileURLToPath(new URL('./packages/sdk/javascript/src/protocol/index.ts', import.meta.url)),
      '@graphvideo/sdk/node': fileURLToPath(new URL('./packages/sdk/javascript/src/node/index.ts', import.meta.url)),
      '@graphvideo/sdk/effect': fileURLToPath(new URL('./packages/sdk/javascript/src/effect/index.ts', import.meta.url)),
      '@graphvideo/sdk/plugin': fileURLToPath(new URL('./packages/sdk/javascript/src/plugin/index.ts', import.meta.url)),
      '@graphvideo/sdk/analysis': fileURLToPath(new URL('./packages/sdk/javascript/src/analysis/index.ts', import.meta.url)),
      '@graphvideo/sdk/agent': fileURLToPath(new URL('./packages/sdk/javascript/src/agent/index.ts', import.meta.url)),
      '@graphvideo/sdk/testing': fileURLToPath(new URL('./packages/sdk/javascript/src/testing/index.ts', import.meta.url)),
      '@graphvideo/sdk/client': fileURLToPath(new URL('./packages/frontend/client/index.ts', import.meta.url)),
      '@graphvideo/sdk/tokens': fileURLToPath(new URL('./packages/frontend/tokens/index.ts', import.meta.url)),
      '@graphvideo/sdk/ui': fileURLToPath(new URL('./packages/frontend/ui/index.ts', import.meta.url)),
      '@graphvideo/sdk': fileURLToPath(new URL('./sdk/index.ts', import.meta.url)),
      '@graphvideo/sdk/workbench': fileURLToPath(new URL('./packages/frontend/workbench/src/index.ts', import.meta.url)),
      '@graphvideo/workbench': fileURLToPath(new URL('./packages/frontend/workbench/src/index.ts', import.meta.url)),
    },
  },
  // @ts-ignore
  test: {
    globals: true,
    watch: false,
    pool: 'threads',
    maxWorkers: 4,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 2_000,
    exclude: ['**/node_modules/**', '**/dist/**', '**/*live*.test.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'sdk',
          environment: 'node',
          include: ['packages/sdk/javascript/**/*.test.{ts,mjs}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['sdk/**/*.test.{ts,mjs}'],
          exclude: ['sdk/workbench/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['sdk/workbench/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tools/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
