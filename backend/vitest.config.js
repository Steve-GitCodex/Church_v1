import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files sequentially to avoid rate-limiter collisions on the shared in-memory store
    pool: 'forks',
    singleFork: true,
  },
})
