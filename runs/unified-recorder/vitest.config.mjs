export default {
  test: {
    include: [
      'runs/unified-recorder/**/*.test.{mjs,ts,tsx}',
      'runs/unified-recorder/**/*.real.test.{mjs,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/.generated/**',
    ],
  },
}
