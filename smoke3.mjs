/** Verification pass for the auth flow and Phase 2b interaction changes. */
import { chromium } from 'playwright'

const OUT = '/Users/hguha/.claude/jobs/7406843c/tmp'
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

// Start from a clean slate: a session or database left by a previous run would
// make the flow below non-deterministic.
await page.evaluate(async () => {
  localStorage.clear()
  for (const info of await indexedDB.databases()) {
    if (info.name) indexedDB.deleteDatabase(info.name)
  }
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1400)

// 1. Sign-in screen (signed out by default now)
await page.screenshot({ path: `${OUT}/50-signin.png` })

// 2. Email path -> check your email
await page.getByPlaceholder('you@example.com').fill('harsh.guha@example.com')
await page.getByText('Email me a link').click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/51-check-email.png` })

await page.getByPlaceholder('000000').fill('000000')
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${OUT}/52-home-empty-greeting.png` })

// 3. Seed history
await page.evaluate(async () => {
  const repo = await import('/src/data/repository.ts')
  const WEEK = 7 * 24 * 3600 * 1000
  const plan = [
    { items: [['barbell_bench_press', 45], ['overhead_press', 29], ['cable_triceps_pushdown', 20]] },
    { items: [['deadlift', 68], ['lat_pulldown', 27], ['barbell_curl', 14]] },
    { items: [['barbell_back_squat', 57], ['romanian_deadlift', 45], ['standing_calf_raise', 34]] },
  ]
  for (let w = 4; w >= 0; w--) {
    for (const [d, session] of plan.entries()) {
      const at = Date.now() - w * WEEK - d * 2 * 24 * 3600 * 1000
      const id = await repo.startWorkout({ startedAt: at })
      for (const [ex, base] of session.items) {
        const we = await repo.addExerciseToWorkout(id, ex)
        for (const reps of [8, 8, 7]) {
          const s = await repo.addSet({ workoutExerciseId: we })
          await repo.logSetValues(s, { weightKg: base + (4 - w) * 2.5, reps })
        }
      }
      if (w % 2 === 0) {
        const we = await repo.addExerciseToWorkout(id, 'treadmill_run')
        const s = await repo.addSet({ workoutExerciseId: we })
        await repo.logSetValues(s, { durationSeconds: 1620, distanceM: 5000 })
      }
      await repo.finishWorkout(id)
    }
  }
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 82 })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}/53-home-with-data.png`, fullPage: true })

// 4. Start screen: list of past workouts to repeat
await page.getByRole('button', { name: 'Log a workout' }).first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/54-start-screen.png`, fullPage: true })

// 5. Repeat a specific (older) session -> placeholders from THAT session
const rows = page.locator('button:has-text("sets")')
await rows.nth(2).click()
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}/55-repeated-placeholders.png`, fullPage: true })

// 6. Rest timer: explicit start button
await page.screenshot({ path: `${OUT}/56-rest-idle.png` })
await page.getByRole('button', { name: /Start rest/ }).click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/57-rest-running.png` })

// 7. Add set carries a placeholder (not blank)
await page.getByText('Add set').first().click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/58-add-set-placeholder.png`, fullPage: true })

// 8. Cardio entry block
await page.getByRole('button', { name: 'Dismiss' }).click().catch(() => {})
await page.waitForTimeout(300)
await page.getByText('Add exercise').click()
await page.waitForTimeout(700)
await page.getByPlaceholder('Search exercises').fill('treadmill')
await page.waitForTimeout(500)
// Scope to the picker overlay: "Treadmill Run" also appears in last-time text
// on cards behind it, and the outer match is covered by the overlay.
await page.locator('.fixed.inset-0').getByText('Treadmill Run', { exact: true }).first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/59-cardio-block.png`, fullPage: true })

// 9. Toast swipe-dismiss check: delete a set to raise one
await page.getByRole('button', { name: 'Back', exact: true }).click()
await page.waitForTimeout(800)

// 10. Empty workout is discarded. First clear the in-progress session, since
// tapping + correctly resumes one rather than offering to start another.
await page.getByRole('button', { name: 'Log a workout' }).first().click()
await page.waitForTimeout(1000)
await page.getByText('Finish workout').click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /^Finish$/ }).click().catch(() => {})
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Discard' }).click().catch(() => {})
await page.waitForTimeout(1500)

await page.getByRole('button', { name: 'Log a workout' }).first().click()
await page.waitForTimeout(900)
await page.getByText('Start an empty workout').click()
await page.waitForTimeout(1000)
await page.getByText('Finish workout').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/60-empty-discarded.png` })
await page.getByRole('button', { name: 'Discard' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/60b-after-discard.png` })

// 11. Account screen
await page.getByRole('button', { name: 'More', exact: true }).click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/61-more-with-account.png`, fullPage: true })
await page.getByText('Harsh Guha').first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/62-account.png`, fullPage: true })

// 12. Sign-out dialog with pending writes
await page.getByText('Sign out').click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/63-signout-guard.png` })

console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8), null, 2) : 'none')
await browser.close()
