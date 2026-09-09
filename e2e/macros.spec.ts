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
  await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  await expect(page.getByRole('heading', { name: /Today's weight/ })).toBeVisible()
  await page.getByPlaceholder('Weight (kg)').fill('80')
  await page.getByRole('button', { name: 'Start logging' }).click()

  // Today, with the weigh-in recorded and a target derived from it.
  await expect(page.getByText('Weighed in today')).toBeVisible()

  // Log a seeded food end to end: search, portion, then it lands on the day.
  await page.getByRole('button', { name: 'Log food' }).click()
  // Creating a recipe starts from the same "+", without slowing the common case down.
  const newRecipe = page.getByRole('button', { name: /New recipe/ })
  await expect(newRecipe).toBeVisible()
  // The editor renders offline: the link import needs a session, everything else does not.
  await newRecipe.click()
  await expect(page.getByRole('heading', { name: 'New recipe', level: 1 })).toBeVisible()
  await expect(page.getByPlaceholder('Sunday chilli')).toBeVisible()
  // Three ways in, all landing in the same ingredient list.
  for (const mode of ['From a link', 'Paste it', 'Describe it']) {
    await expect(page.getByRole('button', { name: mode })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Back' }).click()
  // The meal and the time are always on screen — the slot is data, not an assumption.
  await expect(page.getByRole('button', { name: 'Breakfast' })).toBeVisible()
  // Every logging path is reachable from here, including the ones that need a network.
  await expect(page.getByRole('button', { name: 'Log from a photo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quick add macros' })).toBeVisible()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('chicken breast')
  // Where it was eaten is asked in the logging flow, not buried in an edit sheet — and nothing
  // is preselected, because a default would be indistinguishable from an answer.
  for (const venue of ['Home', 'Out', 'Takeaway']) {
    await expect(page.getByRole('button', { name: venue, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  }
  await page.getByRole('button', { name: 'Out', exact: true }).click()

  await page.getByPlaceholder('Search a food, or describe a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await expect(page.getByRole('button', { name: 'Log it' })).toBeEnabled()
  await page.getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()

  // The timeline summarises the day, and tapping an item opens the correction sheet.
  await expect(page.getByRole('button', { name: /Today.s food 1 item/ })).toBeVisible()
  // The venue chosen at log time rides along, on the sitting rather than the row.
  await expect(page.getByRole('button', { name: /Eaten Out/ })).toBeVisible()
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await expect(page.getByRole('button', { name: /Remove from today/ })).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a food the databases do not have can be entered and logged offline', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('corner shop wrap')
  await page.getByRole('button', { name: /Add .corner shop wrap. from its label/ }).click()

  await page.getByPlaceholder('Corner shop chicken wrap').fill('Corner shop wrap')
  // Per 100 g, from the label; the serving size is a portion, not the basis.
  await page.locator('input[type=number]').nth(0).fill('200')
  await page.locator('input[type=number]').nth(1).fill('14')
  await page.locator('input[type=number]').nth(2).fill('20')
  await page.locator('input[type=number]').nth(3).fill('7')
  await page.getByRole('button', { name: 'Save and log it' }).click()

  // Straight to the portion step for the food just created, then onto the day.
  await expect(page.getByRole('heading', { name: 'Corner shop wrap' })).toBeVisible()
  await page.getByRole('button', { name: 'Log it' }).click()
  await expect(page.getByText(/Corner shop wrap/).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('every tab and the coach render without errors', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Each tab is asserted on its own furniture: History and Insights lead with controls rather
  // than a title, the way REPutation's do.
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByPlaceholder('Search what you ate')).toBeVisible()
  // Filter by where it was eaten, alongside the range and meal filters.
  await page.getByRole('button', { name: /Where/ }).click()
  await expect(page.getByText('Cooked at home')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Insights', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Habits' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('button', { name: /Data & sync/ })).toBeVisible()

  // Settings is a list of destinations; each one has to be reachable and come back.
  for (const route of [
    'Targets & goal',
    'Weekly check-in',
    'About you',
    'Food & units',
    'Appearance',
    'Badges',
    'Saved meals',
    'Recipes',
    'Your foods',
  ]) {
    await page.getByRole('button', { name: new RegExp(route) }).click()
    await expect(page.getByRole('heading', { name: route, level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
  }

  // The offline coach must answer with no key and no session — that's the whole point of it.
  await page.getByRole('button', { name: /^Coach Ask about your own numbers/ }).click()
  await expect(page.getByRole('heading', { name: /Ask about your own numbers/ })).toBeVisible()
  await page.getByRole('button', { name: /What's left for today\?/ }).click()
  await expect(page.getByText(/target|protein|kcal/i).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a recipe can be built, browsed, and logged a serving at a time', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // Built entirely offline: the model is only needed to convert *written* amounts.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Recipes/ }).click()
  await page.getByRole('button', { name: /New recipe/ }).click()

  await page.getByPlaceholder('Sunday chilli').fill('Test bowl')
  await page.locator('select').first().selectOption('italian')
  await page.getByPlaceholder('Add an ingredient').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  // Grams is the only editable number, because grams is what gets stored.
  await expect(page.locator('input[aria-label^="Grams of"]').first()).toBeVisible()
  await page.getByPlaceholder(/One step per line/).fill('Cook it.\nEat it.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // The list is sortable and filterable, and the cuisine came through.
  await expect(page.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suggested' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Cuisine/ })).toBeVisible()
  await expect(page.getByText('Italian').first()).toBeVisible()

  // Tapping a recipe opens what it is and how to cook it — not the editor. This is the whole
  // reason the feature was unused: the imported method had nowhere to be shown.
  await page.getByRole('button', { name: /Test bowl/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Test bowl', level: 1 })).toBeVisible()
  await expect(page.getByText('Cook it.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Log \d+ kcal$/ })).toBeVisible()

  // Halves, because that is how a batch dish is eaten.
  await page.getByRole('button', { name: /More Servings/ }).click()
  await expect(page.getByLabel('Servings of this recipe', { exact: true })).toHaveText('1.5')
  await page.getByRole('button', { name: /^Log \d+ kcal$/ }).click()

  // Back on Today: logged, and filed as cooked at home without being asked.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText(/Test bowl/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Eaten Home/ })).toBeVisible()

  // And it shows up as something to cook again, with a stated reason.
  await expect(page.getByText('Cook one of yours')).toBeVisible()

  // With a day logged, the two patterns cards render — and the cuisine came from the recipe.
  await page.getByRole('button', { name: 'Insights', exact: true }).click()
  await page.getByRole('button', { name: 'Habits' }).click()
  await expect(page.getByText('Where you eat')).toBeVisible()
  await expect(page.getByText('What you cook')).toBeVisible()
  await expect(page.getByText('Italian').first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
