import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'core/src/index.ts'),
        'effect-harness': resolve(import.meta.dirname, 'core/src/effect-harness.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: resolve(import.meta.dirname, 'core/dist'),
    rollupOptions: {
      external: [/^node:/],
    },
    target: 'node20',
    minify: false,
    sourcemap: true,
  },
})
