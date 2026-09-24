import { fileURLToPath } from 'node:url'

export default {
  resolve: {
    alias: {
      vitest: fileURLToPath(new URL('../../packages/desktop/node_modules/vitest/dist/index.js', import.meta.url)),
    },
  },
  test: {
    include: ['runs/agent-tool-socket/tests/**/*.test.mjs'],
    environment: 'node',
  },
}
