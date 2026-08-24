/**
 * Renders /og-card from the built site into public/og.png.
 *
 *   npm run build && node tools/og.mjs
 *
 * Committing the result keeps the social card a static asset — crawlers fetch it
 * without the site needing to render anything.
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4401

const server = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
  cwd: SITE,
  stdio: ['ignore', 'pipe', 'pipe'],
})
// Poll rather than watch stdout: the banner prints before the listener is
// actually accepting connections.
const base = `http://localhost:${PORT}`
for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(base)
    break
  } catch {
    if (attempt > 60) throw new Error('preview server did not come up')
    await new Promise((res) => setTimeout(res, 400))
  }
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  await page.goto(`${base}/og-card/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('#og-card').screenshot({ path: resolve(SITE, 'public/og.png') })
  console.log('✓ public/og.png')
} finally {
  await browser.close()
  server.kill()
}
