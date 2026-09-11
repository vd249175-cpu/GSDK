import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'sdk/backend/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: resolve(import.meta.dirname, 'sdk/backend/dist'),
    rollupOptions: {
      external: [/^node:/],
    },
    target: 'node20',
    minify: false,
    sourcemap: true,
  },
})
