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
      // Kernel owns identity-bearing runtime capabilities. Keep it external so
      // backend-sdk and direct Kernel consumers share exactly one module.
      external: [/^node:/, /^@graphvideo\/kernel(?:\/.*)?$/],
    },
    target: 'node20',
    minify: false,
    sourcemap: true,
  },
})
