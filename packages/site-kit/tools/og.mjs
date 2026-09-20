/**
 * Renders /og-card from a built site into its public/og.png.
 *
 *   npm run build && npm run og        # from the site directory
 *
 * Committing the result keeps the social card a static asset — crawlers fetch it without the site
 * needing to render anything. Run from the site's own directory; that is what it shoots.
 */

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const SITE = process.cwd()
const PORT = Number(process.env.OG_PORT ?? 4401)

/**
 * `astro preview` daemonises: it forks a server, prints where it is, and exits. So this starts it,
 * polls until it answers, and stops it by name at the end — a spawned child to kill would be the
 * wrong handle, and the server would outlive the script.
 */
const preview = (...args) =>
  execFileSync('npx', ['astro', 'preview', ...args], { cwd: SITE, stdio: 'ignore' })

preview('stop')
preview('--port', String(PORT))

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
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.goto(`${base}/og-card/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('#og-card').screenshot({ path: resolve(SITE, 'public/og.png') })
  console.log('✓ public/og.png')
} finally {
  await browser.close()
  preview('stop')
}
