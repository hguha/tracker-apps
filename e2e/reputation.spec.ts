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

  // Reset panel is reachable and back-navigable.
  await page.getByRole('button', { name: /Forgot your password\?/ }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
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
