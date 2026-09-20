import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

/**
 * The web app is served at `macrocosm.fitness/app` — the marketing site (sites/macros-site)
 * rewrites `/app/*` onto this project's Vercel deployment. Asset URLs have to be relative to
 * that subpath: with the default `/`, the browser asks for `macrocosm.fitness/assets/…`, which
 * belongs to the site and 404s. The auth redirect (`@tracker-engine/auth` reads BASE_URL) and the
 * service-worker scope follow from it, so both stay correct without a second setting.
 *
 * The native bundle is served from the app's own root:
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
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5175,
  },
})
