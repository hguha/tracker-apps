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
 * `facts: false` leaves sex unanswered, which is the path where the app deliberately has no calorie
 * target at all; several specs need exactly that. Height and birth year no longer have an unset
 * state: both open on a real value, because scrolling a 71-entry list from a blank was the clunky
 * part and the numbers only seed the *first* target anyway.
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

  // Height then birth year, both pre-set; sex is a pair of buttons and the only one that gates
  // Continue, because it's the only one of the three with no defensible default.
  const pickers = page.locator('select')
  await pickers.nth(0).selectOption(units === 'metric' ? '178' : '70')
  await pickers.nth(1).selectOption('1994')
  if (facts) {
    await page.getByRole('button', { name: 'male', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  } else {
    await page.getByRole('button', { name: /rather not say/ }).click()
  }

  // Activity: the last guess the app makes, and the only input to the cold-start estimate that
  // isn't a measurement. Skippable, like the numbers before it.
  if (facts) {
    await page.getByRole('radio', { name: /Moderately active/ }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
  } else {
    await page.getByRole('button', { name: /not sure/ }).click()
  }

  if (weight) {
    await page.getByPlaceholder(/Today's weight/).fill(weight)
    await page.getByRole('button', { name: 'Start logging' }).click()
  } else {
    await page.getByRole('button', { name: 'Skip for now' }).click()
  }

  /**
   * Wait for the shell, not just for the click.
   *
   * `finish()` writes the profile, the weigh-in and the program, and the tab shell only mounts once the
   * *profile* write reaches the live query — so for a moment after the click the onboarding tree is
   * still on screen and the tabs are not. A test that carried straight on would sometimes act on the
   * tree about to be replaced and see its own controls detach mid-fill.
   */
  await expect(page.getByRole('button', { name: 'Insights', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start logging' })).toHaveCount(0)
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
  // Feet and inches, because imperial was chosen — not a centimetres box under an "in" label. Both
  // units are on every option, so nobody has to convert to check they picked the right one.
  await expect(page.locator('select').first().locator('option', { hasText: /5′10″ · 178 cm/ })).toHaveCount(1)
  await page.getByRole('button', { name: /rather not say/ }).click()

  // Activity: the last guess the app makes before it has anything to measure. Answered here, because
  // the two ends of the scale are several hundred kcal a day apart on the same body.
  await expect(page.getByRole('heading', { name: /How active is your week/ })).toBeVisible()
  await page.getByRole('radio', { name: /Very active/ }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByRole('heading', { name: /Today's weight/ })).toBeVisible()
  await page.getByPlaceholder(/Today's weight \(lb\)/).fill('176')
  await page.getByRole('button', { name: 'Start logging' }).click()

  // Today, with the weigh-in recorded and a target derived from it.
  await expect(page.getByText('Weighed in today')).toBeVisible()

  // Log a seeded food end to end: search, portion, then it lands on the day.
  await page.getByRole('button', { name: 'Log food' }).click()
  // Creating a recipe lives on the Recipes tab, where a recipe belongs — it used to sit in the
  // header of the screen you open to log a yoghurt.
  await page.getByRole('button', { name: /^Recipes/ }).click()
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
  // The meal and the time are one tappable line rather than a card owning the top third of the
  // screen: both are right on almost every log, and both are correctable on the day afterwards.
  // Which meal depends on the clock, so the assertion is on the shape rather than on a name — the
  // old one asserted "Breakfast" and only passed because the picker rendered every option as a
  // button, whatever the actual slot was.
  const whenChip = page.getByRole('button', {
    name: /^(Breakfast|Lunch|Dinner|Snack)\s*·.*\d{1,2}:\d\d/,
  })
  await expect(whenChip).toBeVisible()
  // And it opens the picker, which is where the slot can be corrected.
  await whenChip.click()
  await expect(page.getByRole('button', { name: 'Breakfast', exact: true })).toBeVisible()
  await whenChip.click()
  // Every other way in is behind one named list rather than a row of unlabelled glyphs. Three of
  // these were icons nobody could guess ("+" was quick-add) and two were only reachable from a
  // different screen — which is why making a recipe looked like it had disappeared.
  await page.getByRole('button', { name: 'More ways to add' }).click()
  for (const way of ['Photo of the plate', 'New recipe', 'Create a food', 'Calories only']) {
    await expect(page.getByRole('button', { name: new RegExp(way) })).toBeVisible()
  }
  // Venue is deliberately *not* here. It used to be, and was unreachable on the photo and describe
  // paths — so the field was blank on exactly the restaurant meals it exists to measure.
  await expect(page.getByRole('button', { name: 'Takeaway', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await expect(page.getByRole('button', { name: /^Log it/ })).toBeEnabled()
  await page.getByRole('button', { name: /^Log it/ }).click()

  // The screen stays open and keeps score in the header, so a five-item breakfast is one visit
  // rather than five. It used to close on every write, which meant re-picking the meal each round.
  await page.getByRole('button', { name: /Done · 1/ }).click()

  // Home shows the food. It used to show a ring, a weigh-in, a goal, badges and a coach button —
  // everything except the diary — and seeing what you ate meant guessing that the ring was tappable.
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()
  await page.getByRole('button', { name: /^(Breakfast|Lunch|Dinner|Snack)/ }).first().click()

  // The day editor: totals against that day's target, then one card per meal.
  await expect(page.getByText(/of \d+ kcal|no target for this day/)).toBeVisible()
  // Where it was eaten is asked here, on the finished meal, where the answer is actually known.
  // New rows arrive as "home" — the write-time default. It used to be unrecorded, on the grounds
  // that a default is indistinguishable from an answer; true, but it made *unrecorded* the
  // commonest value, which is a worse lie told about the same data.
  await expect(page.getByRole('button', { name: 'Home', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  for (const venue of ['Out', 'Takeaway']) {
    await expect(page.getByRole('button', { name: venue, exact: true }).first()).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  }
  await page.getByRole('button', { name: 'Out', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Out', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Tapping a row opens the amount in place — the common correction, without a sheet.
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  const stepper = page.locator('input[aria-label^="Amount of"]').first()
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
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('corner shop wrap')
  await page.getByRole('button', { name: /Create .corner shop wrap./ }).click()

  await page.getByPlaceholder('Name').fill('Corner shop wrap')
  // The label states a serving, so that is the basis offered first — the app converts to its own
  // per-100 g storage rather than making the user divide by 2.5 in their head.
  await page.getByLabel('A serving is in g').fill('250')
  await page.getByLabel('kcal').fill('500')
  await page.getByLabel('Protein in g').fill('35')
  await page.getByLabel('Carbs in g').fill('50')
  await page.getByLabel('Fat in g').fill('18')
  await expect(page.getByText('200 kcal per 100 g')).toBeVisible()
  await page.getByRole('button', { name: 'Save and log it' }).click()

  // Straight to the portion step for the food just created, then onto the day.
  await expect(page.getByRole('heading', { name: 'Corner shop wrap' })).toBeVisible()
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /Done · 1/ }).click()
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
    'Food, water & reminders',
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
  // The same words the log screen uses, in the same order: "Saved" there and "Meals" here described
  // one thing, which is most of why it was unclear where anything would show up.
  for (const tab of ['Recipes', 'Saved', 'Foods']) {
    // Anchored, not exact: a tab's label gains a count badge inside the button as soon as its live
    // query lands, so "Saved" and "Saved 1" are the same tab a few milliseconds apart.
    await page.getByRole('button', { name: new RegExp(`^${tab}`) }).click()
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
  // One button, not two. There used to be "as ingredients" and "or as a single item" side by side,
  // and the *other* screens picked differently — so logging the same dish from Today and from here
  // produced two completely different diaries.
  await expect(page.getByRole('button', { name: /^Log \d+ kcal$/ })).toBeVisible()

  // Halves, because that is how a batch dish is eaten.
  await page.getByRole('button', { name: /More Servings/ }).click()
  await expect(page.getByLabel('Servings of this recipe', { exact: true })).toHaveText('1.5')
  await page.getByRole('button', { name: /^Log \d+ kcal$/ }).click()

  // Back on Today: logged, and filed as cooked at home without being asked.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  // One line called by the recipe's name, which is the whole point of the dish columns: the
  // ingredients are underneath it rather than scattered across the day as unrecognisable USDA rows.
  await expect(page.getByText(/Test bowl/).first()).toBeVisible()
  await page.getByRole('button', { name: /^Dinner|^Lunch|^Breakfast|^Snack/ }).first().click()
  // Filed as cooked at home without being asked, since logging a recipe means you cooked it.
  await expect(page.getByRole('button', { name: 'Home', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Back' }).click()

  // And it shows up in the library card — as a link to that recipe, not to the list. It used to
  // carry a "Log 1" button that wrote a serving into the day from home with nothing to check.
  await expect(page.getByText('Your library')).toBeVisible()
  await expect(page.getByRole('button', { name: /Log one serving of Test bowl/ })).toHaveCount(0)

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
  await page.getByRole('button', { name: /Food, water & reminders/ }).click()
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
  await page.getByRole('button', { name: /Food, water & reminders/ }).click()
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
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  // One amount and a unit. It used to be "Servings" *and* "or weigh it (g)", where writing in either
  // silently cleared the other — so which number the app would use was a precedence rule with no
  // visual expression.
  await page.getByLabel('Unit').selectOption({ label: 'grams' })
  await page.getByLabel('Amount', { exact: true }).fill('183')
  // And the screen says what it does to the day, which is the question at this moment. This account
  // has no target (facts skipped), so it states the day's totals rather than a ring against one.
  await expect(page.getByText('Your day, once this is logged')).toBeVisible()
  await page.getByRole('button', { name: /^Log it/ }).click()

  // Now the tick path, without leaving: the screen stayed open, which is the point of it.
  await expect(page.getByRole('button', { name: /Done · 1/ })).toBeVisible()
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  // The tickbox, which queues a food at the amount it was last eaten in. Distinct from tapping the
  // row, which opens an amount — they used to be a "+" and a name, which read as two paths to one act.
  await page.getByRole('checkbox', { name: /^Log Chicken breast/ }).first().click()
  // The ticked row states what it is about to commit. The bar used to *describe* it — "at the amount
  // you last had each" — so a one-off 300 g portion was silently repeated with nothing to catch it.
  await expect(page.getByText(/183 g · \d+ kcal/).first()).toBeVisible()
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('egg')
  await page.getByRole('checkbox', { name: /^Log Egg/ }).first().click()
  const logBoth = page.getByRole('button', { name: /^Log 2 · \d+ kcal$/ })
  await expect(logBoth).toBeVisible()
  await logBoth.click()
  await page.getByRole('button', { name: /Done · 3/ }).click()

  // Three items on the day, and the chicken came back at 183 g rather than a database default —
  // which is the whole reason logging in MyFitnessPal feels quick.
  await page.getByRole('button', { name: /^(Breakfast|Lunch|Dinner|Snack)/ }).first().click()
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
  await page.getByRole('button', { name: /Food, water & reminders/ }).click()
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
  // Ingredients is the only shape now: one row carrying the recipe's total has no food behind it —
  // no micronutrients, no re-portioning, no way to correct one part of it — and the reason anyone
  // wanted the single row (a readable diary) is handled by the dish line that collapses them.
  await page.getByRole('button', { name: /^Log \d+ kcal$/ }).click()

  // Logging returns to the list; Back out until the tab bar is reachable again.
  for (let i = 0; i < 3; i += 1) {
    if (await page.getByRole("button", { name: "Today", exact: true }).count()) break
    await page.getByRole("button", { name: "Back" }).first().click()
  }
  await page.getByRole("button", { name: "Today", exact: true }).click()
  // One line called "Two things" on Today, because that is what the person ate.
  await expect(page.getByText(/Two things/).first()).toBeVisible()
  await page.getByRole('button', { name: /^Dinner|^Lunch|^Breakfast|^Snack/ }).first().click()

  // Opening it shows the two real foods underneath, each with its own macros.
  await page.getByRole('button', { name: /Two things/ }).first().click()
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()
  await expect(page.getByText(/Rice/).first()).toBeVisible()
  // And one tap re-logs the whole dish, which is the answer to "I had another one".
  await expect(page.getByRole('button', { name: /Have this again/ })).toBeVisible()
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
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /Done · 1/ }).click()

  await page.getByRole('button', { name: /^(Breakfast|Lunch|Dinner|Snack)/ }).first().click()
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
  await page.getByRole('button', { name: /^Saved/ }).click()
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

test('water counts on the home screen, in the units you picked', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // It was the most conspicuous gap in the app: water is the second-most-logged thing in every
  // tracker and there was nowhere at all to put it.
  await expect(page.getByText('Water — tap an amount to start.')).toBeVisible()
  // Three sizes, not one: a litre bottle used to be four taps of a number that was never 8 oz.
  const glass = page.getByRole('button', { name: 'Add Glass of water' })
  await glass.click()
  await glass.click()
  await expect(page.getByText('500 ml', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add Bottle of water' }).click()
  await expect(page.getByText('1.0 L', { exact: true })).toBeVisible()

  // Removing one, because a mis-tap should not need a settings screen to undo.
  await page.getByRole('button', { name: 'Remove Glass of water' }).click()
  await expect(page.getByText('750 ml', { exact: true })).toBeVisible()

  // A target turns the count into progress, and the glass fills against it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Food, water & reminders/ }).click()
  await page.getByRole('button', { name: '2.0 L', exact: true }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText('of 2.0 L')).toBeVisible()
  await expect(page.getByText('1.3 L to go')).toBeVisible()

  // Millilitres are what's stored; the unit is a display preference, so switching converts rather
  // than reinterpreting — 250 ml is 8 fl oz, not 250 fl oz.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Food, water & reminders/ }).click()
  await page.getByRole('button', { name: /lb \/ in/ }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByText('25 fl oz', { exact: true })).toBeVisible()
  await expect(page.getByText('of 68 fl oz')).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('reminders are off by default and say what they will and will not do', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Food, water & reminders/ }).click()

  // Off until asked for. Nothing in this app should start sending notifications on install.
  const toggle = page.getByRole('button', { name: 'Reminders', exact: true })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText(/Log breakfast and the breakfast reminder doesn’t arrive/)).toBeVisible()
  await toggle.click()

  // A time per meal, and an end-of-day nudge that only fires on a completely empty day.
  for (const meal of ['Breakfast', 'Lunch', 'Dinner']) {
    await expect(page.getByText(meal, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Only if the whole day is empty.')).toBeVisible()
  await page.getByRole('button', { name: '13:00', exact: true }).click()

  // And the setting is visible from the list, so it isn't a feature you have to remember enabling.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText(/reminders \d+ a day/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the log screen opens on what you ate, and a repeat is one tap', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // It used to open on "Suggested", which needs 120 kcal of headroom to say anything — so the
  // highest-traffic screen in the app opened on an empty card exactly when people log most.
  await page.getByRole('button', { name: 'Log food' }).click()
  await expect(page.getByRole('button', { name: /^Recent/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText(/Everything you log turns up here/)).toBeVisible()

  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.getByRole('button', { name: /^Log it/ }).click()

  // Now Recent has it, with the amount it was eaten in — so the second time is one tap and no
  // arithmetic. There is no "Suggested" tab any more; four entry points, not five.
  await expect(page.getByRole('button', { name: /^Suggested/ })).toHaveCount(0)
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a described dish can be removed, and kept as one of its units', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // No model here (empty Supabase env), so the dish is built by hand — the paths after the breakdown
  // are the same either way, and those are what this is about.
  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /^Done · / }).click()

  // A single food is not wrapped in a dish: that would add a layer to open for nothing.
  await page.getByRole('button', { name: /^(Breakfast|Lunch|Dinner|Snack)/ }).first().click()
  await expect(page.getByRole('button', { name: /Have this again/ })).toHaveCount(0)

  // Removing a lone row is the row's own bin.
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await expect(page.getByRole('button', { name: /^Remove Chicken breast/ })).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the day screen shows what each food contributes, and what the day comes to', async ({
  page,
}) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { weight: '85' })

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()

  // The portion screen answers "does this fit", not just "what is in it" — a ring for the day it will
  // make, and each macro bar split into what's already eaten plus what this adds.
  await expect(page.getByText(/still free after this/)).toBeVisible()
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /^Done · / }).click()

  // Home lists only the meals with food in them. Four rows of em-dashes was most of the card saying
  // nothing, every morning.
  await expect(page.getByRole('button', { name: /^Breakfast/ })).toHaveCount(0)
  // And the card that navigates says so, rather than needing a sentence to explain itself.
  await expect(page.getByText("Today's food")).toBeVisible()

  // The micronutrients survive. `sum` is all-or-nothing, which is right for a recipe and wrong for a
  // day: one food with a gap used to erase that nutrient from the whole day.
  await page.getByRole('button', { name: /Nutrition/ }).click()
  // Six of seven, not one of seven. The staples used to carry only macros and fibre, and being short
  // clean descriptions they outrank the fuller USDA rows for exactly the queries people type — so the
  // app's most-logged foods were its least complete. USDA records no sugar figure for raw chicken, and
  // that one genuinely stays unknown: absence is not zero.
  await expect(page.getByText('6 of 7 recorded')).toBeVisible()
  await expect(page.getByText('none of these foods record it')).toHaveCount(1)

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('your own recipes and saved meals are findable from the search box', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // A recipe the user named themselves used to be unreachable by name: searching "lasagna soup"
  // returned USDA's lasagna rows and not theirs, and the only way in was to remember it existed and
  // switch tabs. A thing you saved is the most likely answer to typing its name.
  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByRole('button', { name: /^Recipes/ }).click()
  await page.getByRole('button', { name: /New recipe/ }).click()
  await page.getByPlaceholder('Sunday chilli').fill('Lasagna soup')
  await page.getByPlaceholder('Find a food').or(page.getByPlaceholder('Add an ingredient by hand')).fill('chicken breast')
  await page.getByRole('button', { name: /Chicken breast/ }).first().click()
  await page.getByRole('button', { name: /^Save recipe/ }).click()

  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('lasagna soup')
  // Under "Yours", above the database.
  await expect(page.getByText('Yours')).toBeVisible()
  await page.getByRole('button', { name: /Lasagna soup/ }).first().click()

  // And it opens the same add screen as a plain food does: an amount, a unit, the day it will make,
  // and what is in it. It used to be a different control for every kind of thing.
  await expect(page.getByRole('heading', { name: 'Lasagna soup' })).toBeVisible()
  await expect(page.getByLabel('Amount')).toBeVisible()
  // Which of the batch is being logged, beside the number. The heading used to say "4 servings"
  // while the box said "1", so there was no telling whether one or four were about to go in.
  await expect(page.getByText('1 of 4 servings')).toBeVisible()
  // And what is in it, which is what filled the empty half of the screen.
  await expect(page.getByText(/Chicken breast/).first()).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('what fits is a question you can ask, not a card buried under recipes', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // It used to live at the bottom of the Recipes tab, which is the last place anybody would look for
  // a *food* suggestion — and it's a question people ask out loud, so it gets a door with the
  // question written on it.
  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByRole('button', { name: /What can I still have/ }).click()
  // With no target yet it says so, rather than showing an empty list.
  await expect(page.getByRole('heading', { name: /No target yet|kcal and/ })).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('any food can be looked up in the library, with its micronutrients', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // There was nowhere in the app to ask "how much potassium is in this" — the Foods tab listed only
  // the handful of rows typed in from a label, despite every food ever logged being cached locally.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Your library/ }).click()
  await page.getByRole('button', { name: /^Foods/ }).click()
  await page.getByPlaceholder(/Any food/).fill('chicken breast')

  const row = page.getByRole('button', { name: /Chicken breast/ }).first()
  await row.click()
  await expect(page.getByText('Per 100 g')).toBeVisible()
  // Named nutrients, and a source that never recorded one shows "—" rather than a zero.
  for (const nutrient of ['Fibre', 'Potassium', 'Iron', 'Sodium']) {
    await expect(page.getByText(nutrient, { exact: true })).toBeVisible()
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('one bookmark, one Saved list — foods and meals together', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  await completeOnboarding(page, { facts: false, weight: '' })

  // There used to be two words for one idea: a starred food was "pinned" and a kept meal was
  // "saved", living in different places, so there was no guessing where either would turn up.
  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('chicken breast')
  await page.getByRole('button', { name: /^Save Chicken breast/ }).first().click()

  await page.getByPlaceholder('Search a food, a recipe, or a meal').fill('')
  await page.getByRole('button', { name: /^Saved/ }).click()
  await expect(page.getByRole('button', { name: /Chicken breast/ }).first()).toBeVisible()

  // And the same bookmark undoes it.
  await page.getByRole('button', { name: /^Remove Chicken breast/ }).first().click()
  await expect(page.getByText(/Bookmark a food/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})

test('what fits can be narrowed to one kind of thing', async ({ page }) => {
  const errors = await bootWithoutErrors(page)
  // A target exists here, so the filter renders: some evenings you want to cook and some you want a
  // yoghurt, and the screen used to decide which by showing two fixed sections.
  await completeOnboarding(page, { weight: '80' })

  await page.getByRole('button', { name: 'Log food' }).click()
  await page.getByRole('button', { name: /What can I still have/ }).click()
  for (const source of ['Anything', 'Cook', 'Saved', 'Foods']) {
    await expect(page.getByRole('button', { name: source, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Cook', exact: true }).click()
  await expect(page.getByText(/Nothing here fits/)).toBeVisible()

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
})
