import { expect, test } from '@playwright/test'

// Regression for the full Ledger app on the shared engine: sign in on-device, the
// engine pulls the seeded bank feed into Dexie, and the screens + coach work end to
// end in a real browser. Exercises core + local-first + ui + ai-coach from a second app.

async function continueOnDevice(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Continue on this device/i }).click()
  // Overview renders once seed + the first mock sync land.
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test('boots, syncs the seeded bank feed, and shows the overview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await continueOnDevice(page)

  // Net worth stat is computed from the pulled bank accounts.
  await expect(page.getByText('Net worth')).toBeVisible()
  // A seeded (server-authored) transaction pulled through the engine shows in Recent.
  await expect(page.getByText('Regal Cinemas')).toBeVisible({ timeout: 15_000 })

  expect(errors, `page errors: ${errors.join(', ')}`).toEqual([])
})

test('logs a manual transaction and finds it in history', async ({ page }) => {
  await continueOnDevice(page)

  await page.getByRole('button', { name: 'Log a transaction' }).click()
  await page.getByPlaceholder('0.00').fill('12.50')
  await page.getByPlaceholder('e.g. Whole Foods').fill('Corner Cafe')
  await page.getByRole('button', { name: /Add transaction/i }).click()

  // Back on the tabs; open History and confirm the manual entry is there.
  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText('Corner Cafe')).toBeVisible()
})

test('insights surfaces the recurring subscriptions', async ({ page }) => {
  await continueOnDevice(page)

  await page.getByRole('button', { name: 'Insights' }).click()
  await expect(page.getByText('Subscriptions')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Netflix')).toBeVisible()
})

test('the offline coach answers from the ledger', async ({ page }) => {
  await continueOnDevice(page)

  await page.getByRole('button', { name: /Coach/i }).first().click()
  await page.getByRole('button', { name: /Any subscriptions I forgot about\?/i }).click()
  // The offline mock computes a real answer naming a subscription.
  await expect(page.getByText(/Netflix/)).toBeVisible({ timeout: 15_000 })
})

test('imports a CSV statement into the ledger (the free path)', async ({ page }) => {
  await continueOnDevice(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Import transactions' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Description,Amount\n2026-08-15,Chipotle Import,-11.25\n'),
  })
  await page.getByRole('button', { name: /Import 1 transaction/ }).click()
  await expect(page.getByText(/Imported 1/)).toBeVisible()

  await page.getByRole('button', { name: 'History' }).click()
  await expect(page.getByText('Chipotle Import')).toBeVisible()
})
