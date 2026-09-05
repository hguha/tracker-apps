import { expect, test } from '@playwright/test'

/**
 * Boot + first-run smoke. This exists because MACROcosm shipped two crashes that every unit
 * test passed through: a readwrite transaction inside a liveQuery context, first in the boot
 * chain and then in `getProfile`. Both threw on load and only on load, so the guard has to be
 * an actual browser that fails on a page error.
 */
async function bootWithoutErrors(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  return errors
}

test('macros boots with no page errors', async ({ page }) => {
  const errors = await bootWithoutErrors(page)

  await expect(page).toHaveTitle(/MACROcosm/)
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.getByRole('button', { name: /Use this device only/ })).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('device-only setup reaches the log, then logs a food', async ({ page }) => {
  const errors = await bootWithoutErrors(page)

  await page.getByRole('button', { name: /Use this device only/ }).click()

  // Onboarding: welcome -> goal -> the cold-start facts -> first weigh-in.
  await expect(page.getByRole('heading', { name: 'MACROcosm' })).toBeVisible()
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByRole('heading', { name: /What are you after/ })).toBeVisible()
  await page.getByRole('button', { name: /Lose fat/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'A few numbers' })).toBeVisible()
  await page.getByRole('button', { name: /Skip — I'll add them later/ }).click()
  await expect(page.getByRole('heading', { name: /Today's weight/ })).toBeVisible()
  await page.getByPlaceholder('Weight (kg)').fill('80')
  await page.getByRole('button', { name: 'Start logging' }).click()

  // Today, with the weigh-in recorded and a target derived from it.
  await expect(page.getByText('Weighed in today')).toBeVisible()

  // Log a seeded food end to end: search, portion, then it lands on the day.
  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search foods').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await expect(page.getByRole('button', { name: 'Log it' })).toBeEnabled()
  await page.getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('every tab and the coach render without errors', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Skip — I'll add them later/ }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  for (const tab of ['History', 'Insights', 'Settings']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByRole('heading', { name: tab })).toBeVisible()
  }

  // The offline coach must answer with no key and no session — that's the whole point of it.
  await page.getByRole('button', { name: /^Coach Ask about your numbers/ }).click()
  await expect(page.getByRole('heading', { name: /Ask about your own numbers/ })).toBeVisible()
  await page.getByRole('button', { name: /What's left for today\?/ }).click()
  await expect(page.getByText(/target|protein|kcal/i).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
