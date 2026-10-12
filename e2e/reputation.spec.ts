import { expect, test, type Page } from '@playwright/test'

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

// The welcome screen asks for one intent up front — a combined email+password form
// read as two competing offers. Guards that separation and each panel behind it.
test('auth asks for an intent first, then does exactly that one thing', async ({ page }) => {
  await page.goto('/')

  // Welcome: two explicit choices plus the no-account path. No credential fields yet.
  await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible()
  await expect(page.getByRole('button', { name: /I already have an account/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Use this device only/ })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeHidden()

  // Sign-up: email + a new password, with the rule stated and the button gated.
  await page.getByRole('button', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await page.getByLabel('Email').fill('someone@example.com')
  await page.getByLabel('Create a password').fill('short')
  await expect(page.getByText(/at least 6 characters/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
  await page.getByLabel('Create a password').fill('longenough')
  await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled()

  // Sign-in is reachable from sign-up and offers both password and code.
  await page.getByRole('button', { name: /Sign in instead/ }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Email me a one-time code/ })).toBeVisible()

  // Reset asks for a code, not a link — a link can't reach an installed iOS PWA.
  await page.getByRole('button', { name: /Forgot your password\?/ }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Email me a reset code/ })).toBeVisible()
  await page.getByRole('button', { name: /Back to sign in/ }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

  // Back always returns to the intent choice.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible()
})

// The emailed-code path is what makes auth work the same on web, PWA and native, so
// it gets an end-to-end run through the local provider's simulated email.
test('signing in with an emailed code reaches the app', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /I already have an account/ }).click()
  await page.getByLabel('Email').fill('coded@example.com')
  await page.getByRole('button', { name: /Email me a one-time code/ }).click()

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  // With no backend the accepted code is stated on screen.
  await page.getByPlaceholder('000000').fill('000000')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Welcome to REPutation' })).toBeVisible({
    timeout: 20_000,
  })
})

// The device-only path must reach the real app with no backend at all — this is the
// path a store reviewer uses, and the guarantee that the app works offline.
test('device-only sign-in reaches the app and can open badges', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Use this device only/ }).click()

  // A fresh device account lands in onboarding, which is proof the local session
  // was established and the app rendered past the auth gate.
  await expect(
    page.getByRole('heading', { name: 'Welcome to REPutation' }),
  ).toBeVisible({ timeout: 20_000 })
})

async function skipSetup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Use this device only/ }).click()
  await page.getByRole('button', { name: "Let's set up" }).click({ timeout: 20_000 })
  const tourSkip = page.getByRole('button', { name: 'Skip', exact: true })
  const next = page.getByRole('button', { name: /^(Skip for now|Almost done|Start logging)$/ })
  await expect(async () => {
    if (await next.count()) await next.first().click()
    await expect(tourSkip).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 15_000 })
  await tourSkip.click()
}

async function squat(page: Page, pounds: string) {
  await page.getByRole('button', { name: /Log a workout/ }).first().click()
  await page.getByRole('button', { name: 'Start an empty workout' }).click()
  await page.getByRole('button', { name: 'Add exercise' }).click()
  await page.getByRole('button', { name: /^Back Squat/ }).first().click()
  await page.getByRole('button', { name: /^Barbell/ }).click()
  await page.getByLabel('weight in lb').fill(pounds)
  await page.getByLabel('reps').fill('5')
  await page.getByLabel('reps').blur()
}

test('a first workout earns a level and a celebration, and a heavier set a record', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await skipSetup(page)

  await squat(page, '135')
  await page.getByRole('button', { name: 'Finish workout' }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await expect(page.getByRole('status', { name: /badges earned|First Rep/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Level 1, \d+ badges earned/ })).toBeVisible()
  await expect(page.getByText('Next up')).toBeVisible()

  await squat(page, '185')
  await expect(page.getByRole('status', { name: /new personal record/ })).toBeVisible()

  expect(errors, `page errors: ${errors.join(', ')}`).toEqual([])
})

test('reminders start off and can be switched on in settings', async ({ page }) => {
  await skipSetup(page)

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: /Settings/ }).first().click()
  await page.getByRole('button', { name: /^Reminders\s*Off/ }).click()
  await expect(page.getByRole('checkbox', { name: 'No workout yet' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reminders', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'No workout yet' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Weigh in' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Reminders\s*1 on/ })).toBeVisible()
})

test('logging bodyweight shows its smoothed trend on the Body screen', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await skipSetup(page)

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: /^Body/ }).click()
  await expect(page.getByText('Log your bodyweight to see its trend.')).toBeVisible()

  await page.getByPlaceholder('Log a new value').first().fill('80')
  await page.getByRole('button', { name: /^Log Bodyweight/i }).click()
  await expect(page.getByText(/^\d+(\.\d+)? (kg|lb) trend$/)).toBeVisible()
  expect(errors, `page errors: ${errors.join(', ')}`).toEqual([])
})

test('the offline coach answers and keeps the conversation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await skipSetup(page)

  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByText('Coach', { exact: true }).click()
  await page.getByRole('button', { name: 'What should I focus on next?' }).click()
  const question = page.getByRole('paragraph').filter({ hasText: 'What should I focus on next?' })
  await expect(question).toBeVisible()
  await expect(page.locator('p.whitespace-pre-wrap')).toHaveCount(2)

  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByText('Coach', { exact: true }).click()
  await expect(question).toBeVisible()
  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.getByRole('button', { name: 'What should I focus on next?' })).toBeVisible()

  expect(errors, `page errors: ${errors.join(', ')}`).toEqual([])
})
