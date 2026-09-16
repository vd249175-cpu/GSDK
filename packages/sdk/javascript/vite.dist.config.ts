import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        protocol: resolve(import.meta.dirname, 'src/protocol/index.ts'),
        node: resolve(import.meta.dirname, 'src/node/index.ts'),
        effect: resolve(import.meta.dirname, 'src/effect/index.ts'),
        plugin: resolve(import.meta.dirname, 'src/plugin/index.ts'),
        analysis: resolve(import.meta.dirname, 'src/analysis/index.ts'),
        agent: resolve(import.meta.dirname, 'src/agent/index.ts'),
        testing: resolve(import.meta.dirname, 'src/testing/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: resolve(import.meta.dirname, 'dist'),
    rollupOptions: {
      external: [/^node:/, /^typescript$/],
    },
    target: 'node20',
    minify: false,
    sourcemap: true,
  },
})
