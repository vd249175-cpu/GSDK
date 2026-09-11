import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['plugins/**/*.test.mjs', 'src-main/**/*.test.mjs'],
    environment: 'node',
  },
})
