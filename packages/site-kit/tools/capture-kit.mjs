/**
 * The parts of a screenshot run that are the same for every app.
 *
 * Each site's `tools/capture.mjs` keeps only what is genuinely its own: which screens exist, and the
 * taps that reach them. Starting the app's dev server, disabling its backend, sizing a phone, and
 * writing the file are here — they were copied between the two sites and the copies immediately
 * disagreed about the port, the base path, and how long "ready" takes.
 *
 * Every image is the running product. Nothing here mocks a screen.
 */

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** iPhone 15 Pro logical size; ×3 so the images stay sharp on retina displays. */
export const VIEWPORT = { width: 393, height: 852 }
export const SCALE = 3

/** `--app ../x --only home,coach --headed` for every capture script, parsed once. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flag = (name) => {
    const at = argv.indexOf(`--${name}`)
    return at === -1 ? undefined : argv[at + 1]
  }
  return {
    app: flag('app'),
    only: flag('only')?.split(','),
    headed: argv.includes('--headed'),
  }
}

/**
 * Runs the app's dev server with **no backend configured**.
 *
 * `.env.capture.local` wins over `.env`, and an unconfigured backend is what keeps the screenshots
 * honest: no sync banner, no "sign in to use the coach", no live AI call that might be rate-limited
 * halfway through a run. Returns a handle whose `stop()` also removes the file.
 *
 * `--mode capture` is what makes that file load at all — Vite reads `.env.[mode].local`, and only
 * for the mode it was given. It also means the app's own `.env.local`, with the real keys in it, is
 * never touched.
 */
export async function startApp({ dir, port, ready = /ready in/ }) {
  const envFile = resolve(dir, '.env.capture.local')
  writeFileSync(envFile, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n')

  console.log('· starting the app dev server')
  const child = spawn('npx', ['vite', '--mode', 'capture', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (buffer) => process.stderr.write(buffer))

  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('dev server did not start')), 90_000)
      child.stdout.on('data', (buffer) => {
        if (ready.test(String(buffer))) {
          clearTimeout(timer)
          res()
        }
      })
      child.on('exit', (code) => rej(new Error(`dev server exited (${code})`)))
    })
  } catch (error) {
    child.kill()
    rmSync(envFile, { force: true })
    throw error
  }

  return {
    stop() {
      child.kill()
      rmSync(envFile, { force: true })
    },
  }
}

/** A headless browser, closed by `stop()`. */
export async function openBrowser({ headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed })
  return { browser, stop: () => browser.close() }
}

/**
 * A phone-shaped page in one colour scheme.
 *
 * `reducedMotion` is not cosmetic: without it a capture can land mid-transition, which is how a
 * screenshot ends up showing a half-faded sheet.
 */
export async function newPhone(browser, scheme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.on('console', (message) => message.type() === 'error' && console.log('   !', message.text()))
  return { context, page }
}

/** `shot('home')` → `<out>/home-<scheme>.png`, with a line on the console so a long run is legible. */
export function shooter(outDir, scheme) {
  return async (page, name) => {
    await page.screenshot({ path: `${outDir}/${name}-${scheme}.png` })
    console.log(`   ${name}-${scheme}.png`)
  }
}

/** Long enough for a chart to draw, short enough that a 20-screen run stays under a few minutes. */
export const settle = (page, ms = 900) => page.waitForTimeout(ms)
