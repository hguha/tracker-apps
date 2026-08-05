/**
 * Browser smoke test. Drives the real logging loop, seeds a few weeks of
 * history so the last-time header and charts have something to show, and
 * screenshots each state for visual review.
 *
 * Not a substitute for the unit tests — this is the "render it and look at it"
 * pass, which catches layout problems no assertion would.
 *
 * Run with the dev server up:  node smoke.mjs
 */

import { chromium } from 'playwright'

const OUT = process.env.SMOKE_OUT ?? '/Users/hguha/.claude/jobs/7406843c/tmp'
const BASE = process.env.SMOKE_URL ?? 'http://localhost:5173'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

// Seed six weeks of history through the repository, so the charts and the
// last-time header have real data rather than empty states.
await page.evaluate(async () => {
  const repo = await import('/src/data/repository.ts')
  const WEEK = 7 * 24 * 3600 * 1000
  const plan = [
    {
      name: 'Push A',
      items: [
        ['barbell_bench_press', 45],
        ['overhead_press', 29],
        ['cable_triceps_pushdown', 20],
      ],
    },
    {
      name: 'Pull A',
      items: [
        ['deadlift', 68],
        ['lat_pulldown', 27],
        ['barbell_curl', 14],
      ],
    },
    {
      name: 'Legs A',
      items: [
        ['barbell_back_squat', 57],
        ['romanian_deadlift', 45],
        ['standing_calf_raise', 34],
      ],
    },
  ]

  for (let week = 5; week >= 0; week -= 1) {
    for (const [dayIndex, session] of plan.entries()) {
      const startedAt =
        Date.now() - week * WEEK - dayIndex * 2 * 24 * 3600 * 1000
      const workoutId = await repo.startWorkout({
        title: session.name,
        startedAt,
      })
      for (const [exerciseId, baseKg] of session.items) {
        const weId = await repo.addExerciseToWorkout(workoutId, exerciseId)
        // A small weekly increase, so progression charts show a real trend.
        const load = baseKg + (5 - week) * 2.5
        for (const reps of [8, 8, 7]) {
          const setId = await repo.addSet({
            workoutExerciseId: weId,
            weightKg: load,
            reps,
          })
          await repo.completeSet(setId)
        }
      }
      // A run every other week, to exercise the cardio path.
      if (week % 2 === 0) {
        const weId = await repo.addExerciseToWorkout(workoutId, 'treadmill_run')
        const setId = await repo.addSet({
          workoutExerciseId: weId,
          durationSeconds: 1500 + week * 60,
          distanceM: 5000,
        })
        await repo.completeSet(setId)
      }
      await repo.finishWorkout(workoutId)
    }
  }
  await repo.addMetricEntry({ definitionId: 'bodyweight', value: 82 })
})

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/10-home-with-data.png`, fullPage: true })

await page.getByRole('button', { name: 'History' }).click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/11-history.png` })

await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/12-insights.png`, fullPage: true })

// Every chart owes the reader a table view; check it renders.
const tableToggle = page.getByRole('button', { name: 'Show table' }).first()
await tableToggle.click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/13-table-view.png` })
await tableToggle.click()

await page.getByRole('button', { name: 'Me', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/14-me.png`, fullPage: true })

// Repeat-last-workout, which is the pre-fill-from-history path.
await page.getByRole('button', { name: 'Home' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Log a workout' }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/15-start-options.png` })

await page.getByText('Repeat last workout').click()
await page.waitForTimeout(1500)
await page.screenshot({
  path: `${OUT}/16-prefilled-from-history.png`,
  fullPage: true,
})

await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/17-dark-workout.png` })

await page.getByRole('button', { name: 'Back' }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Insights' }).click()
await page.waitForTimeout(2200)
await page.screenshot({ path: `${OUT}/18-dark-insights.png`, fullPage: true })

console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none')
await browser.close()
