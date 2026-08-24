/**
 * Generates the demo training log the marketing screenshots are taken from.
 *
 * This file is copied into the app repo's `test/` directory and run by its own
 * Vitest (see tools/capture.mjs) so it can drive the real data layer against
 * fake-indexeddb. That matters: personal records and the last-performance cache
 * are derived, and letting `finishWorkout` compute them is the only way to be
 * sure the screenshots show what the product would actually show.
 *
 * Output is a raw dump of every Dexie table, which the capture script writes
 * straight into the browser's IndexedDB.
 */

import { writeFileSync } from 'node:fs'
import { test } from 'vitest'
import { db } from '@/db/database'
import { seedIfNeeded } from '@/db/seed'
import * as repo from '@/data/repository'
import type { Equipment } from '@/domain/types'

const OUT = process.env.DEMO_OUT ?? '/tmp/fitnote-demo.json'

// Anchored to the run date so Home shows a live streak and History's calendar
// lands on the current month.
const NOW = new Date()

const lb = (pounds: number) => pounds * 0.45359237

type Slot = {
  exerciseId: string
  equipment: Equipment
  /** Working weight in lb at week 0, stepping up by `stepLb` every `everyWeeks`. */
  startLb?: number
  stepLb?: number
  everyWeeks?: number
  reps: number[]
  /** Bodyweight/time/distance movements carry their own shape instead of weight. */
  seconds?: number[]
  meters?: number
  runSeconds?: number
}

type Day = { name: string; weekday: number; hour: number; slots: Slot[] }

// A 4-day upper/lower split, the shape most lifting logs actually take.
const PROGRAM: Day[] = [
  {
    name: 'Upper — Push',
    weekday: 1,
    hour: 18,
    slots: [
      { exerciseId: 'bench_press', equipment: 'barbell', startLb: 185, stepLb: 5, everyWeeks: 2, reps: [8, 8, 7, 6] },
      { exerciseId: 'overhead_press', equipment: 'barbell', startLb: 115, stepLb: 5, everyWeeks: 3, reps: [8, 7, 6] },
      { exerciseId: 'incline_bench_press', equipment: 'dumbbell', startLb: 65, stepLb: 5, everyWeeks: 4, reps: [10, 9] },
      { exerciseId: 'lateral_raise', equipment: 'dumbbell', startLb: 20, stepLb: 2.5, everyWeeks: 5, reps: [15, 12] },
      { exerciseId: 'triceps_pushdown', equipment: 'cable', startLb: 60, stepLb: 5, everyWeeks: 3, reps: [12, 10] },
    ],
  },
  {
    name: 'Lower',
    weekday: 2,
    hour: 7,
    slots: [
      { exerciseId: 'back_squat', equipment: 'barbell', startLb: 245, stepLb: 10, everyWeeks: 2, reps: [5, 5, 5, 5] },
      { exerciseId: 'romanian_deadlift', equipment: 'barbell', startLb: 185, stepLb: 10, everyWeeks: 3, reps: [10, 8] },
      { exerciseId: 'leg_press', equipment: 'machine', startLb: 230, stepLb: 10, everyWeeks: 3, reps: [12, 10] },
      { exerciseId: 'standing_calf_raise', equipment: 'machine', startLb: 100, stepLb: 5, everyWeeks: 4, reps: [15, 15] },
    ],
  },
  {
    name: 'Upper — Pull',
    weekday: 4,
    hour: 18,
    slots: [
      { exerciseId: 'pull_up', equipment: 'bodyweight', startLb: 0, stepLb: 5, everyWeeks: 4, reps: [8, 7, 6] },
      { exerciseId: 'row', equipment: 'barbell', startLb: 155, stepLb: 5, everyWeeks: 2, reps: [10, 8] },
      { exerciseId: 'lat_pulldown', equipment: 'cable', startLb: 130, stepLb: 10, everyWeeks: 3, reps: [12, 10] },
      { exerciseId: 'face_pull', equipment: 'cable', startLb: 45, stepLb: 5, everyWeeks: 5, reps: [15, 15] },
      { exerciseId: 'biceps_curl', equipment: 'dumbbell', startLb: 30, stepLb: 2.5, everyWeeks: 4, reps: [12, 10] },
    ],
  },
  {
    name: 'Lower + conditioning',
    weekday: 5,
    hour: 17,
    slots: [
      { exerciseId: 'deadlift', equipment: 'barbell', startLb: 315, stepLb: 10, everyWeeks: 3, reps: [5, 5, 3] },
      { exerciseId: 'bulgarian_split_squat', equipment: 'dumbbell', startLb: 45, stepLb: 5, everyWeeks: 4, reps: [10, 10] },
      { exerciseId: 'lying_leg_curl', equipment: 'machine', startLb: 70, stepLb: 5, everyWeeks: 4, reps: [12, 10] },
      { exerciseId: 'plank', equipment: 'other', reps: [], seconds: [60, 60, 75] },
      { exerciseId: 'treadmill_run', equipment: 'other', reps: [], meters: 3200, runSeconds: 1020 },
    ],
  },
]

// Longer than the 12-week chart window, so Insights opens on a fully populated
// range instead of a ramp out of an empty first week.
const WEEKS = 20
// Week 8 is a deload: less volume, lighter bars. A log with none looks synthetic.
const DELOAD_WEEK = 8
// Scales every working weight down to a relatable early-intermediate lifter, so
// the 12-week volume total reads as a normal training block rather than an
// eye-watering number.
const LOAD_SCALE = 0.63
// Two skipped sessions, because nobody hits 60 for 60.
const SKIPPED = new Set(['3:4', '11:1'])

function workingLb(slot: Slot, week: number): number {
  const start = slot.startLb ?? 0
  const steps = Math.floor(week / (slot.everyWeeks ?? 3))
  const raw = (start + steps * (slot.stepLb ?? 5)) * LOAD_SCALE
  const loaded = week === DELOAD_WEEK ? raw * 0.85 : raw
  return Math.round(loaded / 5) * 5
}

// The start of the week `weeksAgo` back, so sessions land on real weekdays.
function sessionStart(weeksAgo: number, weekday: number, hour: number): number {
  const d = new Date(NOW)
  d.setHours(hour, weeksAgo % 2 === 0 ? 12 : 35, 0, 0)
  const shift = (d.getDay() - weekday + 7) % 7
  d.setDate(d.getDate() - shift - weeksAgo * 7)
  return d.getTime()
}

// Sixty sessions through the real write path, each finish recomputing records —
// comfortably past Vitest's default timeout.
test('generate demo data', { timeout: 120_000 }, async () => {
  await seedIfNeeded()
  await repo.updateProfile({
    displayName: 'Hirsh',
    unitWeight: 'lb',
    unitDistance: 'mi',
    weeklyWorkoutGoal: 4,
    defaultRestSeconds: 120,
    heightCm: 180,
    trainingGoal: 'Get stronger on the big lifts while staying lean.',
    onboardedAt: Date.now(),
    onboardingVersion: 99,
    theme: 'default',
    colorScheme: 'light',
    soundEnabled: true,
    // The training avatar is still rough, so the marketing shots leave it off and
    // the Home card shows the streak and weekly goal instead.
    showAvatar: false,
  })

  await seedBodyMetrics()
  await seedTemplates()

  // Oldest first: every finish rebuilds the caches for the exercises it touched,
  // so walking forward in time leaves them correct at the end.
  for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    const week = WEEKS - 1 - weeksAgo
    for (const [dayIndex, day] of PROGRAM.entries()) {
      if (SKIPPED.has(`${weeksAgo}:${dayIndex}`)) continue
      const startedAt = sessionStart(weeksAgo, day.weekday, day.hour)
      // This week's later sessions haven't happened yet; today's would sit beside
      // the in-progress one and read as an accidental double-log.
      if (startedAt > NOW.getTime()) continue
      if (new Date(startedAt).toDateString() === NOW.toDateString()) continue
      await logSession(day, week, startedAt)
    }
  }

  await seedInProgressSession()

  const dump: Record<string, unknown[]> = {}
  for (const table of db.tables) {
    // The queues are deliberately left out: a screenshot showing "56 changes
    // waiting to upload" would advertise a bug that isn't there.
    if (['outbox', 'deadLetter', 'syncState', 'editSnapshots'].includes(table.name)) continue
    dump[table.name] = await table.toArray()
  }
  writeFileSync(OUT, JSON.stringify(dump))
})

async function logSession(day: Day, week: number, startedAt: number): Promise<void> {
  const workoutId = await repo.startWorkout({ startedAt })
  const isDeload = week === DELOAD_WEEK

  for (const slot of day.slots) {
    const weId = await repo.addExerciseToWorkout(workoutId, slot.exerciseId, slot.equipment)

    if (slot.seconds) {
      for (const s of slot.seconds) {
        await repo.addSet({ workoutExerciseId: weId, durationSeconds: s + week * 2, isCompleted: true })
      }
      continue
    }
    if (slot.meters) {
      const drift = 1 - week * 0.004
      await repo.addSet({
        workoutExerciseId: weId,
        distanceM: slot.meters,
        durationSeconds: Math.round(slot.runSeconds! * drift),
        isCompleted: true,
      })
      continue
    }

    const weight = workingLb(slot, week)
    const reps = isDeload ? slot.reps.slice(0, Math.max(2, slot.reps.length - 1)) : slot.reps
    for (const [index, target] of reps.entries()) {
      // A rep or two of week-to-week noise; a log that climbs monotonically
      // reads as a spreadsheet, not a training history.
      const wobble = index === 0 ? 0 : (week + index) % 3 === 0 ? -1 : 0
      await repo.addSet({
        workoutExerciseId: weId,
        weightKg: weight > 0 ? lb(weight) : null,
        reps: Math.max(1, target + wobble),
        enteredUnit: 'lb',
        isCompleted: true,
      })
    }
  }

  await repo.finishWorkout(workoutId)
  // finishWorkout stamps `endedAt` with the wall clock; a backdated session needs
  // a duration that matches when it happened.
  const minutes = 52 + ((week * 7) % 19)
  await repo.updateWorkout(workoutId, { endedAt: startedAt + minutes * 60_000 })
}

async function seedBodyMetrics(): Promise<void> {
  const series: [string, (week: number) => number][] = [
    ['bodyweight', (w) => 84.4 - w * 0.19 + (w % 3) * 0.22],
    ['body_fat_pct', (w) => 18.6 - w * 0.24 + (w % 4) * 0.15],
    ['waist', (w) => 86 - w * 0.31],
    ['resting_hr', (w) => 58 - w * 0.32 + (w % 3)],
    ['sleep_hours', (w) => 6.8 + (w % 5) * 0.22],
  ]

  for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo -= 1) {
    const week = WEEKS - 1 - weeksAgo
    const measuredAt = sessionStart(weeksAgo, 0, 8)
    if (measuredAt > NOW.getTime()) continue
    for (const [definitionId, at] of series) {
      await repo.addMetricEntry({
        definitionId,
        value: Math.round(at(week) * 10) / 10,
        measuredAt,
      })
    }
  }
}

async function seedTemplates(): Promise<void> {
  for (const day of PROGRAM) {
    const templateId = await repo.createTemplate(day.name, 'Upper / Lower')
    await repo.updateTemplate(templateId, {
      description: `${day.slots.length} exercises · ${day.name.includes('Lower') ? 'squat and hinge' : 'press and pull'}`,
      timesUsed: WEEKS - 1,
    })
    for (const slot of day.slots) {
      const rowId = await repo.addExerciseToTemplate(templateId, slot.exerciseId, slot.equipment)
      const reps = slot.reps.length > 0 ? slot.reps : [1]
      await repo.updateTemplateExercise(rowId, {
        targetSets: slot.seconds?.length ?? (slot.meters ? 1 : slot.reps.length),
        targetRepsLow: slot.reps.length > 0 ? Math.min(...reps) : null,
        targetRepsHigh: slot.reps.length > 0 ? Math.max(...reps) : null,
        targetWeightKg: slot.startLb ? lb(workingLb(slot, WEEKS - 1)) : null,
        restSeconds: slot.startLb && slot.startLb > 150 ? 180 : 90,
      })
    }
  }
}

/**
 * The session the Active Workout screenshot is taken of: two exercises logged,
 * the third waiting, and a third bench set that beats every previous one so the
 * PR glow is on screen. The glow is derived from the data, not from having just
 * typed, so a seeded record shows exactly as a live one would.
 */
async function seedInProgressSession(): Promise<void> {
  const startedAt = NOW.getTime() - 34 * 60_000
  const workoutId = await repo.startWorkout({ startedAt })
  const week = WEEKS - 1

  const bench = PROGRAM[0]!.slots[0]!
  const benchId = await repo.addExerciseToWorkout(workoutId, 'bench_press', 'barbell')
  const top = workingLb(bench, week) + 10
  for (const [weight, reps] of [
    // 8 reps, not 10: a warm-up that set a *rep* record would put the PR trophy
    // on the lightest row on screen, which reads as a bug rather than a feature.
    [workingLb(bench, week) - 40, 8],
    [workingLb(bench, week), 8],
    [top, 8],
  ] as const) {
    await repo.addSet({
      workoutExerciseId: benchId,
      weightKg: lb(weight),
      reps,
      enteredUnit: 'lb',
      isCompleted: true,
    })
  }
  // The empty row the user is about to fill in.
  await repo.addSet({ workoutExerciseId: benchId })
  // A note on the card, so the screenshots show that a session carries context
  // and not just numbers.
  await repo.updateWorkoutExercise(benchId, {
    notes: 'Pause 1s on the chest. Right shoulder felt fine today.',
  })
  await repo.updateWorkout(workoutId, {
    notes: 'Slept 8h. Bar speed good — push for 160 next week.',
  })

  const ohp = PROGRAM[0]!.slots[1]!
  const ohpId = await repo.addExerciseToWorkout(workoutId, 'overhead_press', 'barbell')
  await repo.addSet({
    workoutExerciseId: ohpId,
    weightKg: lb(workingLb(ohp, week)),
    reps: 8,
    enteredUnit: 'lb',
    isCompleted: true,
  })
  await repo.addSet({ workoutExerciseId: ohpId })
  await repo.addSet({ workoutExerciseId: ohpId })

  const inclineId = await repo.addExerciseToWorkout(workoutId, 'incline_bench_press', 'dumbbell')
  for (let i = 0; i < 3; i += 1) await repo.addSet({ workoutExerciseId: inclineId })

  // PRs and last-time come from the finished history; recompute for the exercises
  // on screen so the header and the glow both have something to compare against.
  for (const exerciseId of ['bench_press', 'overhead_press', 'incline_bench_press']) {
    const equipment: Equipment = exerciseId === 'incline_bench_press' ? 'dumbbell' : 'barbell'
    await repo.rebuildLastPerformance(exerciseId, equipment)
    await repo.refreshPersonalRecords(exerciseId, equipment)
  }
}
