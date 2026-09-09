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

/**
 * Through first-run setup, in one place.
 *
 * Every spec had its own copy of these six clicks, so inserting a units step broke five tests at
 * once — which is a fair signal that the sequence is shared behaviour rather than test detail.
 *
 * `facts: false` skips height/age/sex, which is the path where the app deliberately has no calorie
 * target at all; several specs need exactly that.
 */
async function completeOnboarding(
  page: import('@playwright/test').Page,
  {
    goal = 'lose' as 'lose' | 'maintain' | 'gain',
    facts = true,
    weight = '80',
    units = 'metric' as 'metric' | 'imperial',
  } = {},
) {
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: 'Get started' }).click()
  if (goal === 'lose') await page.getByRole('button', { name: /Lose fat/ }).click()
  if (goal === 'gain') await page.getByRole('button', { name: /Build/ }).click()
  if (goal === 'maintain') await page.getByRole('button', { name: /Maintain/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // Units come before the numbers, so the height field can be labelled in the right one.
  await page.getByRole('button', { name: units === 'metric' ? 'Metric' : 'Imperial' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  if (facts) {
    // By position: the height pair, then born, then sex. Labels repeat across the ft/in pair.
    const pickers = page.locator('select')
    if (units === 'metric') {
      await pickers.nth(0).selectOption('178')
      await pickers.nth(1).selectOption('1994')
      await pickers.nth(2).selectOption('male')
    } else {
      await pickers.nth(0).selectOption('5')
      await pickers.nth(1).selectOption('10')
      await pickers.nth(2).selectOption('1994')
      await pickers.nth(3).selectOption('male')
    }
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  } else {
    await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  }

  if (weight) {
    await page.getByPlaceholder(/Today's weight/).fill(weight)
    await page.getByRole('button', { name: 'Start logging' }).click()
  } else {
    await page.getByRole('button', { name: 'Skip for now' }).click()
  }
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

  // Onboarding: welcome -> goal -> units -> the cold-start facts -> first weigh-in. Units come
  // before the numbers so the height field can be labelled in the right one; it used to say
  // "Height (cm)" whatever you picked, and stored inches as centimetres.
  await expect(page.getByRole('heading', { name: 'MACROcosm' })).toBeVisible()
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByRole('heading', { name: /What are you after/ })).toBeVisible()
  await page.getByRole('button', { name: /Lose fat/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Which units/ })).toBeVisible()
  await page.getByRole('button', { name: 'Imperial' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'A few numbers' })).toBeVisible()
  // Feet and inches, because imperial was chosen — not a centimetres box under an "in" label.
  await expect(page.locator('select').first().locator('option', { hasText: '5 ft' })).toHaveCount(1)
  await page.getByRole('button', { name: /Skip — no calorie target/ }).click()
  await expect(page.getByRole('heading', { name: /Today's weight/ })).toBeVisible()
  await page.getByPlaceholder(/Today's weight \(lb\)/).fill('176')
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

  // The screen stays open and keeps score, so a five-item breakfast is one visit rather than five.
  // It used to close on every write, which meant re-picking the meal and the time each round.
  await expect(page.getByText('1 item added')).toBeVisible()
  await page.getByRole('button', { name: /Done · 1/ }).click()
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()

  // The budget card is the way into the day. It used to sit above a second card listing the same
  // day's food, which was the same information twice.
  await expect(page.getByText(/items? today|Nothing logged yet/)).toBeVisible()
  await page.getByText(/items? today/).click()

  // The day editor: totals against that day's target, then the meals as cards.
  await expect(page.getByText(/of \d+ kcal|no target for this day/)).toBeVisible()
  // The venue chosen at log time rode along, on the sitting rather than the row.
  await expect(page.getByRole('button', { name: /Eaten Out/ })).toBeVisible()

  // Tapping a row opens the amount in place — the common correction, without a sheet.
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  const stepper = page.locator('input[aria-label^="Grams of"]').first()
  await expect(stepper).toBeVisible()
  const before = await stepper.inputValue()
  await page.getByRole('button', { name: /^More Chicken breast/ }).click()
  await expect(stepper).not.toHaveValue(before)

  // Which is a real change, so it can be reverted wholesale.
  await expect(page.getByRole('button', { name: 'Revert' })).toBeVisible()
  await page.getByRole('button', { name: 'Revert' }).click()
  await expect(stepper).toHaveValue(before)
  await expect(page.getByRole('button', { name: 'Revert' })).toHaveCount(0)

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a food the databases do not have can be entered and logged offline', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

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
  await completeOnboarding(page, { facts: false, weight: '' })

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
  ]) {
    await page.getByRole('button', { name: new RegExp(route) }).click()
    await expect(page.getByRole('heading', { name: route, level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
  }

  // Recipes, saved meals and own foods share one screen: three rows called those things told
  // nobody which was which, and Settings is the last place you'd look for something you cook.
  await page.getByRole('button', { name: /Your library/ }).click()
  await expect(page.getByRole('heading', { name: 'Your library', level: 1 })).toBeVisible()
  for (const tab of ['Recipes', 'Meals', 'Foods']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your library', level: 1 })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Back' }).click()

  // The offline coach must answer with no key and no session — that's the whole point of it.
  await page.getByRole('button', { name: /^Coach Ask about your own numbers/ }).click()
  await expect(page.getByRole('heading', { name: /Ask about your own numbers/ })).toBeVisible()
  await page.getByRole('button', { name: /What's left for today\?/ }).click()
  await expect(page.getByText(/target|protein|kcal/i).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a recipe can be built, browsed, and logged a serving at a time', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // Built entirely offline: the model is only needed to convert *written* amounts.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Your library/ }).click()
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
  await expect(page.getByRole('heading', { name: 'Your library', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Suggested' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Cuisine/ })).toBeVisible()
  await expect(page.getByText('Italian').first()).toBeVisible()

  // Tapping a recipe opens what it is and how to cook it — not the editor. This is the whole
  // reason the feature was unused: the imported method had nowhere to be shown.
  await page.getByRole('button', { name: /Test bowl/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Test bowl', level: 1 })).toBeVisible()
  await expect(page.getByText('Cook it.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Log \d+ kcal as ingredients$/ })).toBeVisible()

  // Halves, because that is how a batch dish is eaten.
  await page.getByRole('button', { name: /More Servings/ }).click()
  await expect(page.getByLabel('Servings of this recipe', { exact: true })).toHaveText('1.5')
  // As ingredients, which is the default because a single row has no food behind it — so no
  // micronutrients, no re-portioning, and no way to see that the chicken was most of the calories.
  await page.getByRole('button', { name: /^Log \d+ kcal as ingredients$/ }).click()

  // Back on Today: logged, and filed as cooked at home without being asked.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText(/Test bowl/).first()).toBeVisible()
  // Filed as cooked at home without being asked — the venue chip lives on the day screen.
  await page.getByText(/items? today|item today/).click()
  await expect(page.getByRole('button', { name: /Eaten Home/ })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()

  // And it shows up in the library card, with a stated reason to cook it again.
  await expect(page.getByText('Your library')).toBeVisible()
  await expect(page.getByRole('button', { name: /Log one serving of Test bowl/ })).toBeVisible()

  // With a day logged, the two patterns cards render — and the cuisine came from the recipe.
  await page.getByRole('button', { name: 'Insights', exact: true }).click()
  await page.getByRole('button', { name: 'Habits' }).click()
  await expect(page.getByText('Where you eat')).toBeVisible()
  await expect(page.getByText('What you cook')).toBeVisible()
  await expect(page.getByText('Italian').first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('switching to imperial changes every weight on screen', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { goal: 'maintain', facts: false, weight: '80' })

  // This exists because a unit test cannot catch it: the setting was stored, synced, and shown in
  // Settings, while every screen printed kg regardless. Nothing was wrong with the value.
  // Two cards show it — the weigh-in and the projection — and both have to move together.
  await expect(page.getByText(/kg now/)).toBeVisible()
  await expect(page.getByText(/80 kg|80\.0 kg/).first()).toBeVisible()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Food & units/ }).click()
  await page.getByRole('button', { name: /lb \/ in/ }).click()
  await page.getByRole('button', { name: 'Back' }).click()

  await page.getByRole('button', { name: 'Today', exact: true }).click()
  // 80 kg is 176.4 lb to the tenth a scale reads.
  await expect(page.getByText(/176\.4 lb/).first()).toBeVisible()
  await expect(page.getByText(/lb now/)).toBeVisible()
  await expect(page.getByText(/kg now/)).toHaveCount(0)

  // Entry follows too, and storage stays metric — so the value survives switching back.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /About you/ }).click()
  await expect(page.getByText('Height (in)')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: /Food & units/ }).click()
  await page.getByRole('button', { name: /kg \/ cm/ }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText(/kg now/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('several foods log at once, at the amount each was last eaten in', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // Log one food the ordinary way, at an amount nothing would have guessed.
  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.locator('input[type=number]').nth(1).fill('183')
  await page.getByRole('button', { name: 'Log it' }).click()

  // Now the tick path, without leaving: the screen stayed open, which is the point of it.
  await expect(page.getByText('1 item added')).toBeVisible()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('chicken breast')
  await page.getByRole('button', { name: /^Add Chicken breast/ }).first().click()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('egg')
  await page.getByRole('button', { name: /^Add Egg/ }).first().click()
  await expect(page.getByRole('button', { name: 'Log 2 items' })).toBeVisible()
  await page.getByRole('button', { name: 'Log 2 items' }).click()
  await expect(page.getByText('3 items added')).toBeVisible()
  await page.getByRole('button', { name: /Done · 3/ }).click()

  // Three items on the day, and the chicken came back at 183 g rather than a database default —
  // which is the whole reason logging in MyFitnessPal feels quick.
  await page.getByText(/items? today/).click()
  await expect(page.getByText('183g')).toHaveCount(2)

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a goal weight gives the goal a bar and a date', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '85' })

  // A rate alone had no end: nothing ever satisfied "lose 0.5% a week".
  await expect(page.getByRole('button', { name: /Set a goal weight/ })).toBeVisible()
  await page.getByRole('button', { name: /Set a goal weight/ }).click()
  await expect(page.getByRole('heading', { name: 'Targets & goal', level: 1 })).toBeVisible()
  await page.getByPlaceholder('kg').fill('78')
  await page.getByRole('button', { name: 'Back' }).click()

  await expect(page.getByRole('button', { name: /78 kg goal/ })).toBeVisible()
  await expect(page.getByText(/7\.0 to go/)).toBeVisible()
  // No measured rate yet, so it says what the plan implies rather than inventing a measurement.
  await expect(page.getByText(/The plan puts it at/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('an eating window shows itself on the day it applies to', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Food & units/ }).click()
  await page.getByRole('button', { name: /16:8/ }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()

  // The window was implemented and invisible: it appended half a line to the budget text, so
  // someone who turned it on reasonably concluded it did nothing.
  await expect(page.getByText('12:00–20:00')).toBeVisible()
  await expect(page.getByText(/Opens in|left$|Closed for today/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a recipe logs as its ingredients, each with its own macros', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Your library/ }).click()
  await page.getByRole('button', { name: /New recipe/ }).click()
  await page.getByPlaceholder('Sunday chilli').fill('Two things')
  await page.getByPlaceholder('Add an ingredient by hand').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.getByPlaceholder('Add an ingredient by hand').fill('rice')
  await page.getByRole('button', { name: /Rice/ }).first().click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await page.getByRole('button', { name: /Two things/ }).first().click()
  // Ingredients is the default and the primary button, because one row carrying the recipe's total
  // has no food behind it — no micronutrients, no re-portioning, no way to correct one part of it.
  await page.getByRole('button', { name: /as ingredients$/ }).click()

  // Logging returns to the list; Back out until the tab bar is reachable again.
  for (let i = 0; i < 3; i += 1) {
    if (await page.getByRole("button", { name: "Today", exact: true }).count()) break
    await page.getByRole("button", { name: "Back" }).first().click()
  }
  await page.getByRole("button", { name: "Today", exact: true }).click()
  await page.getByText(/items? today/).click()
  // Two rows, each a real food, both attributed to the recipe by name.
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()
  await expect(page.getByText(/Rice/).first()).toBeVisible()
  await expect(page.locator('input[aria-label^="Grams of"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back' }).click()

  // And the recipe still counts as cooked — the rows carry it as provenance, since a row's subject
  // is a food and the schema allows exactly one subject.
  await page.getByRole('button', { name: 'Insights', exact: true }).click()
  await page.getByRole('button', { name: 'Habits' }).click()
  await expect(page.getByText('What you cook')).toBeVisible()
  await expect(page.getByText(/1 recipe serving/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a saved meal can be opened and renamed', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, or describe a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.getByRole('button', { name: 'Log it' }).click()
  await page.getByRole('button', { name: /Done · 1/ }).click()

  await page.getByText(/items? today/).click()
  await page.getByRole('button', { name: /Save this meal/ }).click()
  // A date, not a clock time: "Breakfast · 11 Aug" is findable in a list a month later, and
  // "Breakfast · 11:15" is a fact about one morning that says nothing about which morning.
  await expect(page.getByPlaceholder('Usual breakfast')).toHaveValue(/· .*\d+/)
  await page.getByRole('button', { name: 'Save meal' }).click()

  // Openable and renameable, both of which were missing — and with a default name that is a date,
  // renaming is what makes the list usable at all.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Your library/ }).click()
  await page.getByRole('button', { name: 'Meals', exact: true }).click()
  const saved = page.getByRole('button', { name: /\d+ item.*kcal/ }).first()
  await saved.click()
  await expect(page.getByText(/Chicken breast/)).toBeVisible()
  await page.getByLabel('Name').fill('Usual breakfast')
  await page.getByLabel('Name').blur()
  // A write plus a live-query round trip, which under a parallel run is slower than the default
  // assertion window — and slow is not the same as broken.
  await expect(page.getByRole('button', { name: /Usual breakfast/ })).toBeVisible({
    timeout: 15_000,
  })

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
