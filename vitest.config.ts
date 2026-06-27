import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      exclude: ['examples/', 'dist/', 'vitest.config.ts'],
      include: ['src/**/*.ts']
    },
    include: ['test/**/*.test.ts'],
    exclude: [
      'dist/**',
      'coverage/**',
      'examples/**/generated/**',
    ],
  },
})
