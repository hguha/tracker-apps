import { expect, test } from '@playwright/test'

// Smoke/regression: the app boots (served under /app/), renders its shell, and logs
// no page errors. Keeps the base-path + PWA wiring honest across refactors.
test('reputation boots and renders the app shell', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')

  await expect(page).toHaveTitle(/REPutation/)
  await expect(page.locator('#root')).not.toBeEmpty()
  expect(errors, `page errors: ${errors.join(', ')}`).toEqual([])
})
