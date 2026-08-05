/**
 * Verification pass for the Phase 2 interaction changes.
 */
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

// Sign in before seeding: the profile row is created per account, so it doesn't
// exist until a session does.
await page.getByText('Use this device only').click()
await page.waitForTimeout(2000)

// Seed history so placeholders, titles, and charts have data.
await page.evaluate(async () => {
  const repo = await import('/src/data/repository.ts')
  const WEEK = 7 * 24 * 3600 * 1000
  const plan = [
    { items: [['barbell_bench_press', 45], ['overhead_press', 29], ['cable_triceps_pushdown', 20]] },
    { items: [['deadlift', 68], ['lat_pulldown', 27], ['barbell_curl', 14]] },
    { items: [['barbell_back_squat', 57], ['romanian_deadlift', 45], ['standing_calf_raise', 34]] },
  ]
  for (let w = 5; w >= 0; w--) {
    for (const [d, session] of plan.entries()) {
      const at = Date.now() - w * WEEK - d * 2 * 24 * 3600 * 1000
      const id = await repo.startWorkout({ startedAt: at })
      for (const [ex, base] of session.items) {
        const we = await repo.addExerciseToWorkout(id, ex)
        for (const reps of [8, 8, 7]) {
          const s = await repo.addSet({ workoutExerciseId: we })
          await repo.logSetValues(s, { weightKg: base + (5 - w) * 2.5, reps })
        }
      }
      if (w % 2 === 0) {
        const we = await repo.addExerciseToWorkout(id, 'treadmill_run')
        const s = await repo.addSet({ workoutExerciseId: we })
        await repo.logSetValues(s, { durationSeconds: 1500, distanceM: 5000 })
      }
      await repo.finishWorkout(id)
    }
  }
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 82 })
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 81.6, measuredAt: Date.now() - 7*24*3600*1000 })
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 82.4, measuredAt: Date.now() - 14*24*3600*1000 })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 1. History with auto-titles + row menu
await page.getByRole('button', { name: 'History' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/30-history-titles.png` })

await page.locator('button[aria-label^="Options for"]').first().click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/31-history-menu.png` })
await page.keyboard.press('Escape')
await page.locator('body').click({ position: { x: 5, y: 700 } })
await page.waitForTimeout(300)

// 2. Placeholder logging
await page.getByRole('button', { name: 'Log a workout' }).click()
await page.waitForTimeout(700)
// "Repeat last workout" was replaced by a list of past sessions (§7.4).
await page.locator('button:has-text("sets")').first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/32-placeholders.png`, fullPage: true })

// Type into the first set -> should log it and start the timer
const w = page.getByLabel(/weight in/).first()
await w.fill('140')
await page.getByLabel('reps').first().fill('8')
await page.locator('body').click({ position: { x: 5, y: 300 } })
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/33-typed-logged.png` })

// 3. Session menu
await page.getByRole('button', { name: 'Workout options' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/34-session-menu.png` })
await page.getByText('Change date and time').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/35-change-date.png` })
await page.getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Close' }).click()
await page.waitForTimeout(400)

// 4. Exercise detail sheet (the ... that used to do nothing)
await page.locator('button[aria-label$="details"]').first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/36-exercise-detail.png`, fullPage: true })
await page.getByRole('button', { name: 'Done' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Back' }).click()
await page.waitForTimeout(600)

// 5. Insights sub-tabs + filter sheets
await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/37-insights-overview.png`, fullPage: true })

await page.getByRole('button', { name: 'Strength' }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: `${OUT}/38-insights-strength.png`, fullPage: true })

await page.getByText('All exercises').click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/39-exercise-filter.png` })
await page.getByRole('button', { name: 'Close' }).click()
await page.waitForTimeout(400)

await page.getByRole('button', { name: 'Habit' }).click()
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}/40-insights-habit.png`, fullPage: true })

// 6. Appearance / themes
await page.getByRole('button', { name: 'More', exact: true }).click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/41-more.png`, fullPage: true })

await page.getByRole('button', { name: 'Forest' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/42-theme-forest.png`, fullPage: true })

await page.getByRole('button', { name: 'Dark' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/43-forest-dark.png`, fullPage: true })

await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(2200)
await page.screenshot({ path: `${OUT}/44-forest-dark-charts.png`, fullPage: true })

// 7. Exercise library
await page.getByRole('button', { name: 'More', exact: true }).click()
await page.waitForTimeout(700)
await page.getByText('Exercise library').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/45-library.png`, fullPage: true })

console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 8), null, 2) : 'none')
await browser.close()
