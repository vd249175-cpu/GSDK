export default {
  test: {
    include: [
      'runs/os-recorder/**/*.test.{mjs,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/.generated/**',
    ],
  },
}
