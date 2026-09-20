/**
 * Captures the product screenshots this site ships.
 *
 * Three stages: generate a demo training log with the app's own data layer, load
 * it into a real browser's IndexedDB, then drive the app and shoot each screen.
 * Nothing is mocked or mocked up — every image is the running product.
 *
 *   npm run screens -- [--app ../../apps/reputation] [--headed] [--only home,coach]
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  newPhone,
  openBrowser,
  parseArgs,
  settle,
  shooter,
  startApp,
} from '@tracker-engine/site-kit/tools/capture-kit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SITE = resolve(HERE, '..')

const { app, only: ONLY, headed: HEADED } = parseArgs()

const APP = resolve(SITE, app ?? process.env.FITNOTE_APP_DIR ?? '../../apps/reputation')
const OUT = resolve(SITE, 'src/assets/screens')
const PORT = 5178
// The app is served under its production subpath, so a capture exercises the same asset and
// auth-redirect resolution the deploy does.
const BASE = `http://localhost:${PORT}/app/`

const DUMP = '/tmp/fitnote-demo.json'
const SEED_TEST = resolve(APP, 'test/__demo-seed.test.ts')

/**
 * Which of the app's seven themes each screen is shot in.
 *
 * Deliberately mixed: the app ships seven presets and a gallery of one accent would undersell that.
 * The hero and the AI section stay on `default` so the screenshots agree with the site's own blue;
 * everything else gets a preset that suits it — `mono` for the library because it is a dense list,
 * `settings` on default because it is where the swatches themselves appear.
 */
const THEMES = {
  workout: 'default',
  'insights-overview': 'default',
  'history-calendar': 'default',
  coach: 'default',
  'coach-plan': 'default',
  'coach-ask': 'default',
  'coach-data': 'default',
  // The first-run welcome, shot on the default theme before any data is seeded.
  onboarding: 'default',
  'exercise-detail': 'sunset',
  finish: 'forest',
  home: 'ocean',
  history: 'slate',
  'insights-strength': 'default',
  'insights-volume': 'forest',
  templates: 'crimson',
  'template-preview': 'sunset',
  library: 'mono',
  settings: 'default',
  more: 'slate',
}

const wanted = (name) => (!ONLY || ONLY.includes(name)) && name in THEMES

function generateDemoData() {
  console.log('· generating demo training log')
  copyFileSync(resolve(HERE, 'demo-seed.ts'), SEED_TEST)
  try {
    execFileSync('npx', ['vitest', 'run', 'test/__demo-seed.test.ts'], {
      cwd: APP,
      env: { ...process.env, DEMO_OUT: DUMP },
      stdio: 'inherit',
    })
  } finally {
    rmSync(SEED_TEST, { force: true })
  }
  return readFileSync(DUMP, 'utf8')
}

/**
 * Writes the dump into the live IndexedDB.
 *
 * The app has to boot once first so Dexie creates the schema at its current
 * version; opening with no version here then joins that database rather than
 * racing it into an upgrade.
 */
async function loadDemoData(page, json) {
  await page.evaluate(async (payload) => {
    const tables = JSON.parse(payload)
    const database = await new Promise((res, rej) => {
      const request = indexedDB.open('workout-tracker')
      request.onsuccess = () => res(request.result)
      request.onerror = () => rej(request.error)
    })
    const names = [...database.objectStoreNames].filter((n) => n in tables)
    await new Promise((res, rej) => {
      const tx = database.transaction(names, 'readwrite')
      tx.oncomplete = res
      tx.onerror = () => rej(tx.error)
      for (const name of names) {
        const store = tx.objectStore(name)
        for (const row of tables[name]) store.put(row)
      }
    })
    database.close()
  }, json)
}

/** Appearance lives on the profile, so it is a row edit rather than a UI walk. */
async function setAppearance(page, theme, scheme) {
  await page.evaluate(
    async ({ theme, scheme }) => {
      const database = await new Promise((res) => {
        const request = indexedDB.open('workout-tracker')
        request.onsuccess = () => res(request.result)
      })
      await new Promise((res) => {
        const tx = database.transaction(['profiles'], 'readwrite')
        tx.oncomplete = res
        const store = tx.objectStore('profiles')
        store.get('local-user').onsuccess = (event) => {
          store.put({ ...event.target.result, theme, colorScheme: scheme })
        }
      })
      database.close()
    },
    { theme, scheme },
  )
}

async function main() {
  // Onboarding is a pre-seed screen, so an onboarding-only pass needs no demo
  // log — skip the (slow) generation step entirely.
  const onlyOnboarding = ONLY?.every((name) => name === 'onboarding') ?? false
  const json = onlyOnboarding ? '{}' : generateDemoData()

  // Every screen here is local, and `startApp` runs the app with no backend configured — which
  // hides the coach's "sign in" prompt and any sync UI, and keeps the offline coach silent.
  const server = await startApp({ dir: APP, port: PORT })
  const { browser, stop: closeBrowser } = await openBrowser({ headed: HEADED })
  const themes = [...new Set(Object.values(THEMES))]

  try {
    mkdirSync(OUT, { recursive: true })
    for (const scheme of ['light', 'dark']) {
      for (const theme of themes) {
        const screens = Object.keys(THEMES).filter(
          (name) => THEMES[name] === theme && wanted(name),
        )
        if (screens.length === 0) continue
        console.log(`· ${theme} / ${scheme} — ${screens.length} screen(s)`)

        const { context, page } = await newPhone(browser, scheme)
        const shot = shooter(OUT, scheme)

        await page.goto(BASE, { waitUntil: 'networkidle' })
        // A device-only session, the same path a new user takes.
        await page.getByRole('button', { name: 'Use this device only' }).click()

        // The welcome step is the seam between the device-only click and the demo
        // data (which sets onboardingVersion and skips setup on reload). Shoot it
        // here, before that happens.
        if (screens.includes('onboarding')) {
          await page
            .getByRole('heading', { name: /Welcome to REPutation/i })
            .waitFor({ timeout: 15_000 })
          await page.waitForTimeout(700)
          await shot(page, 'onboarding')
          if (screens.length === 1) {
            await context.close()
            continue
          }
        }

        await page.waitForTimeout(1500)
        await loadDemoData(page, json)

        // The stored session is the source of truth for the display name and
        // overwrites the profile's on every launch, so rename it there too.
        await page.evaluate(() => {
          const key = 'workout-tracker.session'
          const stored = JSON.parse(localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify({ ...stored, displayName: 'Hirsh' }))
        })
        await setAppearance(page, theme, scheme)

        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForTimeout(2500)
        await shoot(page, shot, new Set(screens))
        await context.close()
      }
    }
    console.log(`\n✓ screenshots written to ${OUT}`)
  } finally {
    await closeBrowser()
    server.stop()
  }
}

/**
 * Runs only the navigation needed for the screens this pass wants.
 *
 * Each step declares what it produces, so a themed pass that only needs `library`
 * does not sit through three chart renders to get there.
 */
async function shoot(page, take, want) {
  const shot = (name) => take(page, name)
  const tab = async (name) => {
    await page.getByRole('button', { name, exact: true }).first().click()
    await settle(page)
  }
  const back = async () => {
    await page.getByRole('button', { name: /back/i }).first().click()
    await settle(page)
  }

  const steps = [
    {
      names: ['home'],
      async run() {
        await tab('Home')
        await shot('home')
      },
    },
    {
      names: ['insights-overview', 'insights-volume'],
      async run() {
        await tab('Insights')
        if (want.has('insights-overview')) {
          await settle(page, 2500)
          await shot('insights-overview')
        }
        if (want.has('insights-volume')) {
          await page.getByRole('button', { name: 'Volume', exact: true }).click()
          await settle(page, 2500)
          await shot('insights-volume')
        }
      },
    },
    {
      names: ['insights-strength'],
      async run() {
        await tab('Insights')
        await page.getByRole('button', { name: 'Strength', exact: true }).click()
        await settle(page, 1200)
        // The strength charts each plot a single lift and stay empty until one is
        // picked, so choose a subject before shooting the tab.
        await page.getByRole('button', { name: /All exercises/ }).click()
        await settle(page, 700)
        // Scoped to the sheet: the same exercise name also labels buttons on the
        // charts behind it, and those are the ones the backdrop blocks.
        const sheet = page.getByRole('dialog')
        await sheet.getByPlaceholder(/Search exercise/i).fill('Bench Press')
        await settle(page, 500)
        // Selecting an exercise applies it and dismisses the sheet in one tap.
        await sheet.getByRole('button', { name: /^Bench Press/ }).first().click()
        await settle(page, 1200)
        await page.getByLabel(/weight in/).fill('155')
        await page.getByLabel('reps').fill('5')
        await settle(page, 2500)
        await shot('insights-strength')
      },
    },
    {
      names: ['history', 'history-calendar'],
      async run() {
        await tab('History')
        if (want.has('history')) await shot('history')
        if (want.has('history-calendar')) {
          await page.getByRole('button', { name: 'Calendar', exact: true }).click()
          await settle(page)
          await shot('history-calendar')
        }
      },
    },
    {
      names: ['more'],
      async run() {
        await tab('More')
        await shot('more')
      },
    },
    {
      names: ['templates', 'template-preview'],
      async run() {
        await tab('More')
        await page.getByRole('button', { name: /Templates/ }).first().click()
        await settle(page)
        if (want.has('templates')) await shot('templates')
        if (want.has('template-preview')) {
          // The preview sheet is where a template actually shows its plan.
          await page.getByRole('button', { name: /Upper — Push/ }).first().click()
          await settle(page, 1200)
          await shot('template-preview')
          await page.keyboard.press('Escape')
          await settle(page)
        }
        await back()
      },
    },
    {
      names: ['library'],
      async run() {
        await tab('More')
        await page.getByRole('button', { name: /Exercise library|Library/ }).first().click()
        await settle(page)
        await shot('library')
      },
    },
    {
      names: ['settings'],
      async run() {
        await tab('More')
        await page.getByRole('button', { name: /Settings/ }).first().click()
        await settle(page)
        await shot('settings')
        await back()
      },
    },
    {
      names: ['coach', 'coach-plan', 'coach-ask', 'coach-data'],
      async run() {
        await tab('More')
        await page.getByRole('button', { name: /Coach/ }).first().click()
        await settle(page, 1200)

        // Drive the conversational chat: type a message, send, wait for the reply.
        const ask = async (text) => {
          const box = page.getByPlaceholder(/Ask your coach/)
          await box.click()
          await box.fill(text)
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await settle(page, 2800)
        }
        // Start a fresh conversation so each shot stands on its own.
        const newChat = async () => {
          const button = page.getByRole('button', { name: /^New$/ }).first()
          if (await button.isEnabled().catch(() => false)) {
            await button.click()
            await settle(page, 400)
          }
        }

        // "Weakest area" → a specific, data-backed answer.
        if (want.has('coach')) {
          await ask('What is my weakest area right now?')
          await shot('coach')
        }
        // A plan request, then a refinement — the shot shows iterating on a
        // template, not just generating one.
        if (want.has('coach-plan')) {
          await newChat()
          await ask('Build me a push/pull/legs plan for size')
          await ask('Make it a 6-week strength block')
          // Scroll the chat's own container so the refinement message sits near the
          // top — the follow-up and the start of the revised plan share the frame.
          await page.evaluate(() => {
            // The message bubble is the smallest element whose text is exactly the
            // refinement (parents also contain it, so match exactly).
            const target = [...document.querySelectorAll('div, p, span')].find(
              (n) => n.textContent?.trim() === 'Make it a 6-week strength block',
            )
            const scroller = target?.closest('.overflow-y-auto')
            if (target && scroller) {
              scroller.scrollTop +=
                target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
            }
          })
          await settle(page, 900)
          await shot('coach-plan')
        }
        // A volume question → answered with real counts from the log.
        if (want.has('coach-ask')) {
          await newChat()
          await ask('How much have I been training?')
          await shot('coach-ask')
        }
        // What the coach would send.
        if (want.has('coach-data')) {
          await page.getByRole('button', { name: /what's sent/i }).first().click()
          await settle(page, 1000)
          await shot('coach-data')
          await page.keyboard.press('Escape')
          await settle(page)
        }
        await back()
      },
    },
    {
      // Last: these leave the tab shell, and `finish` ends the demo session.
      names: ['workout', 'exercise-detail', 'finish'],
      async run() {
        await page
          .getByRole('button', { name: /Back to your workout|Log a workout/ })
          .click()
        await settle(page, 1500)
        if (want.has('workout')) await shot('workout')

        if (want.has('exercise-detail')) {
          // The per-exercise sheet: the note that follows the movement, its
          // records, and what the last sessions looked like.
          await page.getByRole('button', { name: /Bench Press details/ }).first().click()
          await settle(page, 1400)
          await shot('exercise-detail')
          await page.keyboard.press('Escape')
          await settle(page)
        }
        if (want.has('finish')) {
          await page.getByRole('button', { name: /Finish workout/ }).click()
          await settle(page, 1800)
          await shot('finish')
        }
      },
    },
  ]

  for (const step of steps) {
    if (!step.names.some((name) => want.has(name))) continue
    await step.run()
  }
}

await main()
