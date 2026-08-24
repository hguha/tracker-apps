import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Served at the site root today; overridable so a future marketing-site proxy
// (ledger.fitness/app, mirroring reputation) can rebase without code changes.
// BASE_URL drives the auth redirect + service-worker scope, so they follow along.
const basePath = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5174,
  },
})
