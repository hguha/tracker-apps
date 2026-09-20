/**
 * Captures the product screenshots this site ships.
 *
 * The app already knows how to build a plausible five weeks of eating — Settings → Data & sync →
 * Load demo data, which writes through the repository like any other path — so this script drives
 * that button rather than carrying its own fixture. Every image below is the running product with
 * real derived numbers behind it: the target comes from the measured trend, the dish rows come from
 * recipes actually logged, the charts are drawn from those days.
 *
 *   npm run screens -- [--app ../../apps/macros] [--headed] [--only today,coach]
 */

import { mkdirSync } from 'node:fs'
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

const APP = resolve(SITE, app ?? process.env.MACROS_APP_DIR ?? '../../apps/macros')
const OUT = resolve(SITE, 'src/assets/screens')
const PORT = 5179
// The app is served under its production subpath, so a capture exercises the same asset resolution
// the deploy does.
const BASE = `http://localhost:${PORT}/app/`

/** Every screen the site can show. Order is capture order, which is also navigation order. */
const SCREENS = [
  'onboarding',
  'today',
  'day',
  'log',
  'amount',
  'history',
  'insights',
  'insights-body',
  'insights-habits',
  'settings',
  'recipes',
  'recipe',
  'coach',
]

const wanted = (name) => (!ONLY || ONLY.includes(name)) && SCREENS.includes(name)

async function main() {
  const server = await startApp({ dir: APP, port: PORT })
  const { browser, stop: closeBrowser } = await openBrowser({ headed: HEADED })

  try {
    mkdirSync(OUT, { recursive: true })
    for (const scheme of ['light', 'dark']) {
      const want = new Set(SCREENS.filter(wanted))
      if (want.size === 0) continue
      console.log(`· ${scheme} — ${want.size} screen(s)`)

      const { context, page } = await newPhone(browser, scheme)
      // The app's own `colorScheme: 'system'` default follows the emulated preference, so the
      // scheme needs no profile edit — which is one fewer thing that could disagree with the shot.
      const shot = shooter(OUT, scheme)

      await page.goto(BASE, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /Use this device only/ }).click()

      // The welcome step only exists before setup finishes, so it is shot first or not at all.
      if (want.has('onboarding')) {
        await page.getByRole('heading', { name: 'MACROcosm' }).waitFor({ timeout: 20_000 })
        await settle(page, 600)
        await shot(page, 'onboarding')
        if (want.size === 1) {
          await context.close()
          continue
        }
      }

      await completeSetup(page)
      await loadDemoData(page)
      await shoot(page, shot, want)
      await context.close()
    }
    console.log(`\n✓ screenshots written to ${OUT}`)
  } finally {
    await closeBrowser()
    server.stop()
  }
}

/**
 * Through first-run setup, the same way a new user goes.
 *
 * Metric and a stated sex, because the cold-start target needs both — a run that skipped them would
 * screenshot the app's deliberate "no target yet" state on every single screen.
 */
async function completeSetup(page) {
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: /Lose fat/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Metric' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  const pickers = page.locator('select')
  await pickers.nth(0).selectOption('178')
  await pickers.nth(1).selectOption('1994')
  await page.getByRole('button', { name: 'male', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.getByRole('radio', { name: /Moderately active/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.getByPlaceholder(/Today's weight/).fill('80')
  await page.getByRole('button', { name: 'Start logging' }).click()
  await page.getByRole('button', { name: 'Insights', exact: true }).waitFor({ timeout: 30_000 })
}

/**
 * Five weeks of eating, written by the app's own loader.
 *
 * It reloads the page when it finishes, so the wait is for the tab shell to come back rather than
 * for the click. Three hundred-odd entries plus the weekly check-ins take a while; the timeout is
 * deliberately generous, because a half-written history would screenshot as a subtly wrong app.
 */
async function loadDemoData(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Data & sync/ }).click()
  await page.getByRole('button', { name: 'Load demo data' }).click()
  await page
    .getByRole('button', { name: 'Log food' })
    .waitFor({ state: 'visible', timeout: 180_000 })
  await settle(page, 2500)
}

/** Only the navigation the wanted screens need, in the order that keeps the app moving forward. */
async function shoot(page, take, want) {
  const shot = (name) => take(page, name)
  const tab = async (name) => {
    await page.getByRole('button', { name, exact: true }).first().click()
    await settle(page)
  }
  const back = async () => {
    await page.getByRole('button', { name: 'Back' }).first().click()
    await settle(page)
  }

  const steps = [
    {
      names: ['today'],
      async run() {
        await tab('Today')
        await settle(page, 1200)
        await shot('today')
      },
    },
    {
      names: ['day'],
      async run() {
        await tab('Today')
        // A meal line on the diary opens that day — totals against the target that was in force,
        // then a card per meal.
        await page
          .getByRole('button', { name: /^(Breakfast|Lunch|Dinner|Snack)/ })
          .first()
          .click()
        await settle(page, 1200)
        await shot('day')
        await back()
      },
    },
    {
      names: ['log', 'amount'],
      async run() {
        await page.getByRole('button', { name: 'Log food' }).click()
        await settle(page, 700)
        await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken')
        await settle(page, 1400)
        if (want.has('log')) {
          // Two rows ticked, because logging several at once is the point of the screen.
          const ticks = page.getByRole('checkbox')
          for (const index of [0, 1]) {
            const tick = ticks.nth(index)
            if (await tick.isVisible().catch(() => false)) await tick.click()
          }
          await settle(page, 600)
          await shot('log')
        }
        if (want.has('amount')) {
          await page.getByRole('button', { name: /Chicken breast/ }).first().click()
          await settle(page, 1200)
          await shot('amount')
          await back()
        }
        await back()
      },
    },
    {
      names: ['history'],
      async run() {
        await tab('History')
        await settle(page, 1600)
        await shot('history')
      },
    },
    {
      names: ['insights', 'insights-body', 'insights-habits'],
      async run() {
        await tab('Insights')
        if (want.has('insights')) {
          await settle(page, 3000)
          await shot('insights')
        }
        if (want.has('insights-body')) {
          await page.getByRole('button', { name: 'Body', exact: true }).click()
          await settle(page, 3000)
          await shot('insights-body')
        }
        if (want.has('insights-habits')) {
          await page.getByRole('button', { name: 'Habits', exact: true }).click()
          await settle(page, 3000)
          // Scrolled to where the tab earns its name: home against out, and what you actually cook.
          // `scrollIntoViewIfNeeded` does nothing here — the card is already a sliver into view, so
          // Playwright counts it as visible — hence an explicit scroll to the top of the frame.
          await page
            .getByText('Where you eat')
            .evaluate((node) => node.scrollIntoView({ block: 'start' }))
          await settle(page, 1400)
          await shot('insights-habits')
        }
      },
    },
    {
      names: ['settings'],
      async run() {
        await tab('Settings')
        await settle(page, 800)
        await shot('settings')
      },
    },
    {
      names: ['recipes', 'recipe'],
      async run() {
        await tab('Settings')
        await page.getByRole('button', { name: /Your library/ }).click()
        await settle(page, 1200)
        if (want.has('recipes')) await shot('recipes')
        if (want.has('recipe')) {
          // The detail screen, which is where a recipe shows its method and its serving stepper.
          await page.getByRole('button', { name: /Sunday chilli/ }).first().click()
          await settle(page, 1200)
          await shot('recipe')
          await back()
        }
        await back()
      },
    },
    {
      names: ['coach'],
      async run() {
        await tab('Settings')
        await page.getByRole('button', { name: /^Coach/ }).first().click()
        await settle(page, 1200)
        // Three exchanges, because one leaves two thirds of the screen empty — and because what the
        // section claims is a conversation rather than a single answer. The suggestions only exist
        // while the thread is empty, so the rest are typed the way anyone else would.
        const prompt = page.getByRole('button', { name: /What's left for today/ })
        if (await prompt.isVisible().catch(() => false)) {
          await prompt.click()
          await settle(page, 2400)
        }
        // Both are questions the offline coach genuinely answers from the log. "Suggest a dinner"
        // is not one of them without a model, and a shot of it explaining the protein floor instead
        // would be advertising a miss.
        for (const question of ['How is my weight trending?', 'Why did my target change?']) {
          await page.getByPlaceholder('Ask the coach').fill(question)
          await page.getByRole('button', { name: 'Send', exact: true }).click()
          await settle(page, 2600)
        }
        await shot('coach')
        await back()
      },
    },
  ]

  for (const step of steps) {
    if (!step.names.some((name) => want.has(name))) continue
    await step.run()
  }
}

await main()
