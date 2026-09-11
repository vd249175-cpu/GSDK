import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['plugins/**/*.test.{mjs,ts}', 'src-main/**/*.test.{mjs,ts}'],
    environment: 'node',
  },
})
