import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    /**
     * Past the 5s/10s defaults, because several tests here do the app's real work: seeding 2,212
     * foods through the write path, and loading five weeks of demo history over fake-indexeddb.
     * That is a second or two on this machine and enough to blow the default on a two-core CI
     * runner — which is exactly how `seedFoods > is idempotent` went red on GitHub while passing
     * everywhere else. A slow integration test is not a flaky one; it needs a budget, not a retry.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
