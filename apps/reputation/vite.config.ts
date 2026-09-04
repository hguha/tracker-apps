import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The web app is served at `reputation.fitness/app` — the marketing site
 * (reputation-site) proxies `/app/*` to this project's Vercel deployment. Asset
 * URLs must therefore be relative to that subpath, not to `/` — otherwise the
 * browser requests `reputation.fitness/assets/…`, which belongs to the site and 404s.
 * This base also drives the auth redirect URL and the service-worker scope
 * (both read import.meta.env.BASE_URL), so they follow automatically.
 *
 * Overridable so the native build targets the bundle root:
 *   BASE_PATH=/ npm run build:native
 */
const basePath = process.env.BASE_PATH ?? '/app/'

// `<version>+<git-sha>`, so a client_errors row points at a commit.
function appVersion(): string {
  const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim()
      } catch {
        return 'unknown'
      }
    })()
  return `${pkg.version}+${sha.slice(0, 7)}`
}

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
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
