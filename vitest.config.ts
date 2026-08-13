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
    // fake-indexeddb lets the Dexie-backed repository be tested without a browser.
    setupFiles: ['./test/setup.ts'],
  },
})
