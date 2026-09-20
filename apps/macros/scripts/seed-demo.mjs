// Seeds a demo account by driving the real app: sign in, load the demo history, wait for the
// outbox to drain. Deliberately not a bespoke insert script — going through the app is what
// proves the write path and sync work, and keeps the demo account identical to what someone
// sees locally after tapping the same button.
//
//   npm run dev:macros                                    # real env, port 5175
//   DEMO_EMAIL=… DEMO_PASSWORD=… node apps/macros/scripts/seed-demo.mjs
//
// Credentials come from the environment so they never land in the repo.

import { chromium } from 'playwright'

// The dev server serves the app under its production subpath, so this is the same URL shape as
// macrocosm.fitness/app rather than a second one only the scripts know about.
const APP = process.env.APP_URL ?? 'http://localhost:5175/app/'
const EMAIL = process.env.DEMO_EMAIL
const PASSWORD = process.env.DEMO_PASSWORD

if (!EMAIL || !PASSWORD) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD.')
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage()
// The demo write + concurrent sync drain is slow; the defaults are far too tight for it.
page.setDefaultTimeout(120_000)
page.on('pageerror', (error) => console.error('[pageerror]', error.message))
page.on('response', async (response) => {
  if (response.status() >= 400 && response.url().includes('supabase.co')) {
    const body = await response.text().catch(() => '')
    console.error(`[net] ${response.status()} ${response.url().slice(0, 90)} :: ${body.slice(0, 200)}`)
  }
})

try {
  await page.goto(APP)

  await page.getByRole('button', { name: /I already have an account/ }).click()
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // A fresh account lands on onboarding; one already set up lands on the tab shell.
  const onboarding = page.getByRole('button', { name: 'Get started' })
  const logFood = page.getByRole('button', { name: 'Log food' })
  await onboarding.or(logFood).first().waitFor({ state: 'visible', timeout: 45_000 })

  if (await onboarding.isVisible()) {
    console.log('running onboarding')
    await onboarding.click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: /Skip/ }).first().click()
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await logFood.waitFor({ state: 'visible', timeout: 90_000 })
  }

  console.log('loading demo data')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /^Data & sync/ }).click()
  await page.getByRole('button', { name: 'Load demo data' }).click()

  // The loader reloads when it finishes writing.
  await logFood.waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /^Data & sync/ }).click()

  // Drained when nothing is queued AND the counters have actually resolved — reading "0" while
  // the day count still shows "—" means the live queries haven't caught up, not that the push
  // is finished.
  const queued = page.locator('dt', { hasText: 'Queued for sync' }).locator('+ dd')
  const days = page.locator('dt', { hasText: 'Days logged' }).locator('+ dd')
  let last = ''
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const pending = (await queued.textContent())?.trim() ?? ''
    const logged = (await days.textContent())?.trim() ?? ''
    if (`${logged}/${pending}` !== last) {
      console.log(`days=${logged} queued=${pending}`)
      last = `${logged}/${pending}`
    }
    if (pending === '0' && logged !== '—' && logged !== '') break
    await page.waitForTimeout(2000)
  }

  const failed = page.locator('dt', { hasText: 'Failed to sync' })
  console.log('failed rows:', (await failed.count()) > 0
    ? (await failed.locator('+ dd').textContent())?.trim()
    : '0')
  console.log(
    'status:',
    (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400),
  )
  console.log('done')
} finally {
  await browser.close()
}
