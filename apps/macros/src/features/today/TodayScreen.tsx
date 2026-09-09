import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, dayStreaks, formatDayHeading, formatTimeOfDay } from '@tracker-engine/core'
import { Card } from '@tracker-engine/ui'
import { Flame, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { dailyAverage, dayTotals, remaining } from '@/lib/nutrition'
import { MEAL_LABELS, mealForHour } from '@/features/shared/meals'
import { CheckInCard } from '@/features/checkin/CheckInCard'
import { BadgeStrip } from '@/features/badges/BadgeStrip'
import type { BodyWeightRow, LogEntry, MealSlot, Profile } from '@/domain/types'
import { BudgetCard } from './BudgetCard'
import { EntrySheet } from './EntrySheet'
import { GoalCard } from './GoalCard'
import { NutritionCard } from './NutritionCard'
import { SaveMealSheet } from './SaveMealSheet'
import { Timeline } from './Timeline'
import { WeighInCard } from './WeighInCard'

/** The micronutrient window: a week, because one day of fibre means nothing. */
const NUTRITION_DAYS = 7

export function TodayScreen({
  onLog,
  onOpenCoach,
  onOpenAbout,
  onOpenBadges,
}: {
  onLog: (meal: MealSlot) => void
  onOpenCoach: () => void
  onOpenAbout: () => void
  onOpenBadges: () => void
}) {
  const today = dayKey(Date.now())
  const [editing, setEditing] = useState<LogEntry | null>(null)
  const [savingMeal, setSavingMeal] = useState<LogEntry[] | null>(null)

  const entries = useLiveQuery(() => repo.entriesForDay(today), [today], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], [])

  // One lookup for the whole day rather than a live query per row.
  const foods = useLiveQuery(
    async () => repo.foodsByIds((entries ?? []).map((e) => e.foodId).filter(isString)),
    [entries],
    new Map(),
  )

  const week = useLiveQuery(
    () => repo.entriesBetween(dayKeyOffset(Date.now(), NUTRITION_DAYS - 1), today),
    [today],
    [],
  )
  const loggedDays = useLiveQuery(() => repo.loggedDays(), [], [])

  const totals = dayTotals(entries ?? [])
  const left = targets ? remaining(totals, targets) : null
  const streak = dayStreaks(loggedDays ?? [])
  const weekDayCount = new Set((week ?? []).map((entry) => entry.day)).size

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-baseline justify-between px-1">
        <h1 className="text-[17px] font-semibold tracking-tight">
          {formatDayHeading(Date.now())}
        </h1>
        {streak.current > 1 && (
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-accent">
            <Flame size={14} />
            {streak.current} day streak
          </span>
        )}
      </div>

      <BudgetCard
        totals={totals}
        targets={targets}
        left={left}
        window={profile?.eatingWindow ?? null}
        entries={entries ?? []}
        missing={missingForTarget(profile, program != null, weights ?? [])}
        onFix={onOpenAbout}
      />

      <WeighInCard />

      <GoalCard />

      <CheckInCard />

      {weekDayCount > 0 && (
        <NutritionCard averages={dailyAverage(week ?? [])} dayCount={weekDayCount} />
      )}

      <BadgeStrip onOpen={onOpenBadges} />

      <Timeline
        entries={entries ?? []}
        foods={foods ?? new Map()}
        onAdd={() => onLog(mealForHour(new Date().getHours()))}
        onEdit={setEditing}
        onSaveMeal={setSavingMeal}
      />

      <button
        onClick={onOpenCoach}
        className="flex w-full items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-line active:bg-sunken"
      >
        <Sparkles size={18} className="shrink-0 text-accent" />
        <span className="flex-1 text-[14px] font-medium">Ask the coach</span>
        <span className="text-[12.5px] text-ink-muted">about your numbers</span>
      </button>

      {profile?.eatingWindow === null && (entries ?? []).length > 0 && <FastingHint />}

      {editing && (
        <EntrySheet
          entry={editing}
          name={
            (editing.foodId ? foods?.get(editing.foodId)?.description : null) ??
            editing.note ??
            'Entry'
          }
          onDismiss={() => setEditing(null)}
        />
      )}

      {savingMeal && (
        <SaveMealSheet
          entries={savingMeal}
          defaultName={`${MEAL_LABELS[savingMeal[0]!.meal]} · ${formatTimeOfDay(savingMeal[0]!.eatenAt)}`}
          onDismiss={() => setSavingMeal(null)}
        />
      )}
    </div>
  )
}

/** Only for people who haven't set a window: one line, once they have data to apply it to. */
function FastingHint() {
  return (
    <Card className="p-3.5">
      <p className="text-[12.5px] text-ink-muted">
        Eat in a set window? Turning one on in Preferences adds a fasting timer and lets the app
        tell you whether you&rsquo;re ahead or behind for the time of day — which it can&rsquo;t
        honestly guess otherwise.
      </p>
    </Card>
  )
}

/**
 * What the app still needs before it can produce a first target. Named explicitly, because
 * "no target yet" with a goal selected in Settings reads as a bug rather than a missing input.
 */
function missingForTarget(
  profile: Profile | undefined,
  hasProgram: boolean,
  weights: readonly BodyWeightRow[],
): string[] {
  if (!hasProgram || !profile) return []
  const missing: string[] = []
  if (weights.length === 0) missing.push('weight')
  if (profile.heightCm === null) missing.push('height')
  if (profile.birthYear === null) missing.push('age')
  if (profile.sex === null) missing.push('sex')
  return missing
}

const isString = (value: string | null): value is string => value !== null
