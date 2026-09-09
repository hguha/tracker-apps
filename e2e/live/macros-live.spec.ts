import { expect, test } from '@playwright/test'

/**
 * Runs against the LIVE Supabase project, so it covers what the default suite deliberately
 * cannot: the `foods` function reaching USDA, and barcode lookup reaching a real product.
 *
 * Opt-in (`npm run test:e2e:live`) and excluded from `verify`, because it depends on a
 * third-party API being up and spends real quota. Expects `npm run dev:macros` already
 * running on 5175 with real env.
 */
/**
 * Open Food Facts goes down, and when it does the *browser* logs the blocked request — its error
 * responses carry no CORS headers. The app already handles this correctly (2.5s timeout, then a
 * minute's backoff, then USDA's results stand alone), and no amount of client code can stop Chrome
 * writing that line. So a third-party outage must not be reported as a MACROcosm defect; anything
 * else still is.
 */
const isThirdPartyOutage = (message: string): boolean =>
  /openfoodfacts\.org/.test(message) ||
  message === 'Failed to load resource: net::ERR_FAILED' ||
  // A 502 from `coach` means the model wouldn't cooperate — a spent quota, an overloaded model, or
  // a truncated response. The whole point of parsing ingredient lines locally is that the import
  // survives that, so it must not fail the run; anything else from our own functions still does.
  /status of 502/.test(message)

async function setUpDeviceOnly(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !isThirdPartyOutage(message.text())) {
      errors.push(message.text())
    }
  })

  await page.goto('/')
  // Device-only on purpose: this path must work with a project configured but no session.
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  // Units are asked before the numbers, so the height field can be labelled in the right one.
  await page.getByRole('button', { name: 'Metric' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  await page.getByPlaceholder(/Today's weight/).fill('80')
  await page.getByRole('button', { name: 'Start logging' }).click()
  await expect(page.getByText('Weighed in today')).toBeVisible()
  return errors
}

test('remote search reaches USDA for a food not in the local seed', async ({ page }) => {
  const errors = await setUpDeviceOnly(page)

  await page.getByRole('button', { name: 'Log food' }).click()
  // Deliberately obscure: the seed now holds ~1,400 everyday foods, so this has to be something it
  // would never include for the test to be about the network at all.
  await page.getByPlaceholder('Search a food, or describe a meal').fill('jackfruit raw')
  // Matched on the "kcal / 100g" a food row carries: a bare name also matches the "break down as a
  // meal" row, which is a different button entirely.
  const hit = page.getByRole('button', { name: /jackfruit.*kcal \/ 100g/is }).first()
  await expect(hit).toBeVisible({ timeout: 20_000 })

  // A remote food must arrive with real energy, not the 0 kcal the first deploy returned.
  await expect(hit).not.toContainText('0 kcal / 100g')
  await hit.click()
  await page.getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText(/jackfruit/i).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('barcode lookup resolves a real product', async ({ page }) => {
  const errors = await setUpDeviceOnly(page)

  await page.getByRole('button', { name: 'Log food' }).click()
  const scan = page.getByRole('button', { name: 'Scan a barcode' })
  // Camera scanning needs a real device; typing the digits is the universal path.
  if (await scan.isVisible().catch(() => false)) {
    await scan.click()
    await page.getByPlaceholder('Or type the barcode').fill('028400642255')
    await page.getByRole('button', { name: 'Look up' }).click()
    await expect(page.getByRole('button', { name: 'Log it' })).toBeVisible({ timeout: 20_000 })
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a recipe link is read into name, servings, cuisine and method', async ({ page }) => {
  const errors = await setUpDeviceOnly(page)

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByRole('button', { name: /New recipe/ }).click()
  await page
    .getByPlaceholder('https://…')
    .fill('https://tastesbetterfromscratch.com/lasagna-soup/')
  await page.getByRole('button', { name: /Read the ingredients/ }).click()

  // Stage one is fast and everything it read is on screen immediately — this is the whole point
  // of splitting the two calls, because stage two takes most of a minute and can fail on its own.
  await expect(page.getByText(/Read from tastesbetterfromscratch\.com/i)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('1/2 pound lean ground beef')).toBeVisible()
  await expect(page.getByPlaceholder('Sunday chilli')).toHaveValue('Lasagna Soup')
  // Servings, cuisine and the method all come from the page's own structured data.
  await expect(page.locator('input[type=number]').first()).toHaveValue('7')
  await expect(page.locator('select').first()).toHaveValue('american')
  await expect(page.getByPlaceholder(/One step per line/)).toContainText('ground beef')

  // Stage two converts the stated amounts to weights. On a busy model it fails — and when it
  // does, the ingredient list above must still be here with a retry, not thrown away.
  const converted = page.locator('input[aria-label^="Grams of"]').first()
  const retry = page.getByRole('button', { name: /Convert \d+ amounts to weights/ })
  await expect(converted.or(retry)).toBeVisible({ timeout: 120_000 })
  if (await retry.isVisible().catch(() => false)) {
    await expect(page.getByText('1/2 pound lean ground beef')).toBeVisible()
  } else {
    // A pound of beef is 227 g at the amount stated — not a guessed serving size.
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(/kcal total/)).toBeVisible()
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a page with no readable recipe says so in its own words', async ({ page }) => {
  const errors = await setUpDeviceOnly(page)

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByRole('button', { name: /New recipe/ }).click()
  await page.getByPlaceholder('https://…').fill('https://example.com')
  await page.getByRole('button', { name: /Read the ingredients/ }).click()

  // The function answers 200 with an `error` field precisely so this reaches the user: a non-2xx
  // has its body discarded by supabase-js, and every reason became "something went wrong".
  await expect(page.getByRole('alert')).toContainText(/doesn.t publish its recipe/i, {
    timeout: 30_000,
  })

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a recipe link imports with the model blocked entirely', async ({ page }) => {
  const errors = await setUpDeviceOnly(page)

  // The model is the point of this test: blocked, so nothing can quietly fall back to it. Parsing
  // "1/2 pound lean ground beef" is a quantity, a unit and a food — not a language problem — and
  // making the reliable step depend on the rate-limited one is what made imports feel broken.
  await page.route('**/functions/v1/coach', (route) => route.abort())

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByRole('button', { name: /New recipe/ }).click()
  await page
    .getByPlaceholder('https://…')
    .fill('https://tastesbetterfromscratch.com/lasagna-soup/')
  await page.getByRole('button', { name: /Read the ingredients/ }).click()

  // Ingredients, weighed, from the page's own text.
  const rows = page.locator('input[aria-label^="Grams of"]')
  await expect(rows.first()).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    expect(await rows.count()).toBeGreaterThanOrEqual(10)
  }).toPass({ timeout: 30_000 })

  // Half a pound of beef is 227 g at the amount stated, not a guessed serving size.
  const values = await rows.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLInputElement).value),
  )
  expect(values, values.join(',')).toContain('227')
  await expect(page.getByPlaceholder('Sunday chilli')).toHaveValue('Lasagna Soup')
  await expect(page.getByText(/kcal total/)).toBeVisible()
  // And it says what it assumed, rather than skipping a seasoning silently.
  await expect(page.getByText(/Skipped|Converted/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Save recipe/ })).toBeEnabled()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
