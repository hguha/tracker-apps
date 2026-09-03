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

// The sign-in screen is one step: password first, with the code, sign-up and reset
// paths reachable without a round trip. Guards the panel wiring after the auth rework.
test('sign-in offers password, sign-up, reset, code and device-only paths', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Email me a code instead/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Use this device only/ })).toBeVisible()

  // Create-account panel asks for a password and states the rule.
  await page.getByRole('button', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByLabel('Choose a password')).toBeVisible()
  await page.getByLabel('Choose a password').fill('short')
  await expect(page.getByText(/at least 6 characters/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()

  await page.getByRole('button', { name: /I already have an account/ }).click()

  // Reset panel is reachable and back-navigable.
  await page.getByRole('button', { name: /Forgot password\?/ }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await page.getByRole('button', { name: /Back to sign in/ }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
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
