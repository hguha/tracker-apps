import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * The app is served at `hirshguha.com/workout-tracker`, which a rewrite proxies
 * to this project's own Vercel deployment. Asset URLs must therefore be relative
 * to that subpath, not to `/` — otherwise the browser requests
 * `hirshguha.com/assets/…`, which belongs to the website and 404s.
 *
 * Overridable so the same build can target a bare domain later:
 *   BASE_PATH=/ npm run build
 */
const basePath = process.env.BASE_PATH ?? '/workout-tracker/'

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true, // so you can open it from your phone on the same wifi
    port: 5173,
  },
})
