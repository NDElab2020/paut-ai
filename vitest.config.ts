import { defineConfig } from 'vitest/config'
import { alias } from './build/vite-shared'

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 60_000,
    pool: 'forks'
  }
})
