import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@graphvideo/kernel': fileURLToPath(new URL('./core/src/index.ts', import.meta.url)),
      '@graphvideo/sdk/client': fileURLToPath(new URL('./sdk/client/index.ts', import.meta.url)),
      '@graphvideo/sdk/tokens': fileURLToPath(new URL('./sdk/tokens/index.ts', import.meta.url)),
      '@graphvideo/sdk/ui': fileURLToPath(new URL('./sdk/ui/index.ts', import.meta.url)),
      '@graphvideo/sdk/testing': fileURLToPath(new URL('./sdk/testing/index.ts', import.meta.url)),
      '@graphvideo/sdk/analysis': fileURLToPath(new URL('./sdk/analysis/index.ts', import.meta.url)),
      '@graphvideo/sdk/contract': fileURLToPath(new URL('./sdk/contract/index.ts', import.meta.url)),
      '@graphvideo/sdk': fileURLToPath(new URL('./sdk/index.ts', import.meta.url)),
      '@graphvideo/sdk/workbench': fileURLToPath(new URL('./sdk/workbench/src/index.ts', import.meta.url)),
      '@graphvideo/workbench': fileURLToPath(new URL('./sdk/workbench/src/index.ts', import.meta.url)),
      '@graphvideo/backend-sdk': fileURLToPath(new URL('./sdk/backend/index.ts', import.meta.url)),
      '@graphvideo/sdk/backend': fileURLToPath(new URL('./sdk/backend/index.ts', import.meta.url)),
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
    exclude: ['**/node_modules/**', '**/dist/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['core/**/*.test.ts'],
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
    ],
  },
})
