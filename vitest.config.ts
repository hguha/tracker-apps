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
    // fake-indexeddb lets the Dexie-backed repository be tested without a browser.
    setupFiles: ['./src/test/setup.ts'],
  },
})
