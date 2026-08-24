import { expect, test } from '@playwright/test'

// Regression: the shared engine (@tracker-engine/local-first) pulls the seeded bank
// data into Dexie and the metrics layer surfaces it. Exercises core + local-first
// end-to-end in a real browser, from a second app.
test('ledger syncs bank data and shows insights', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /Ledger/ })).toBeVisible()

  await page.getByRole('button', { name: /Sync bank/i }).click()

  // Server-authored transactions pulled + pattern analysis ran: the recurring
  // detector found Netflix as a monthly subscription (3 seeded charges).
  await expect(page.getByText('Detected subscriptions')).toBeVisible()
  await expect(page.getByText(/Netflix · monthly · 3× charges/)).toBeVisible()
  await expect(page.getByText('Spending by category')).toBeVisible()
})
