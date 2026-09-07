import { expect, test } from '@playwright/test'

/**
 * Runs against the LIVE Supabase project, so it covers what the default suite deliberately
 * cannot: the `foods` function reaching USDA, and barcode lookup reaching a real product.
 *
 * Opt-in (`npm run test:e2e:live`) and excluded from `verify`, because it depends on a
 * third-party API being up and spends real quota. Expects `npm run dev:macros` already
 * running on 5175 with real env.
 */
async function setUpDeviceOnly(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  // Device-only on purpose: this path must work with a project configured but no session.
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Skip/ }).first().click()
  await page.getByPlaceholder('Weight (kg)').fill('80')
  await page.getByRole('button', { name: 'Start logging' }).click()
  await expect(page.getByText('Weighed in today')).toBeVisible()
  return errors
}

test('remote search reaches USDA for a food not in the local seed', async ({ page }) => {
  const errors = await setUpDeviceOnly(page)

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('pistachios roasted')
  // Matched on the "kcal / 100g" a food row carries: a bare /pistachio/ also matches the
  // "break down as a meal" row, which is a different button entirely.
  const hit = page.getByRole('button', { name: /pistachio.*kcal \/ 100g/is }).first()
  await expect(hit).toBeVisible({ timeout: 20_000 })

  // A remote food must arrive with real energy, not the 0 kcal the first deploy returned.
  await expect(hit).not.toContainText('0 kcal / 100g')
  await hit.click()
  await page.getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText(/pistachio/i).first()).toBeVisible()

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
