import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, dayStreaks, formatDayHeading } from '@tracker-engine/core'
import { Flame, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { dailyAverage, dayTotals, remaining } from '@/lib/nutrition'
import { CheckInCard } from '@/features/checkin/CheckInCard'
import { foodIdsOf } from '@/features/shared/entryName'
import { BadgeStrip } from '@/features/badges/BadgeStrip'
import type { BodyWeightRow, Food, MealSlot, Profile } from '@/domain/types'
import { BudgetCard } from './BudgetCard'
import { LibraryCard } from './LibraryCard'
import { GoalCard } from './GoalCard'
import { NutritionCard } from './NutritionCard'
import { TodayMeals } from './TodayMeals'
import { WaterCard } from './WaterCard'
import { WeighInCard } from './WeighInCard'

/** The micronutrient window: a week, because one day of fibre means nothing. */
const NUTRITION_DAYS = 7

export function TodayScreen({
  onOpenCoach,
  onOpenAbout,
  onOpenBadges,
  onOpenRecipes,
  onOpenRecipe,
  onOpenDay,
  onOpenTargets,
  onAdd,
}: {
  onOpenCoach: () => void
  onOpenAbout: () => void
  onOpenBadges: () => void
  onOpenRecipes: () => void
  onOpenRecipe: (recipeId: string) => void
  onOpenDay: (day: string) => void
  onOpenTargets: () => void
  onAdd: (day: string, meal: MealSlot) => void
}) {
  const today = dayKey(Date.now())

  const entries = useLiveQuery(() => repo.entriesForDay(today), [today], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], [])

  const week = useLiveQuery(
    () => repo.entriesBetween(dayKeyOffset(Date.now(), NUTRITION_DAYS - 1), today),
    [today],
    [],
  )
  const loggedDays = useLiveQuery(() => repo.loggedDays(), [], [])
  const foods = useLiveQuery(
    async () => repo.foodsByIds(foodIdsOf(entries ?? [])),
    [entries],
    new Map<string, Food>(),
  )

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
        onOpenDay={() => onOpenDay(today)}
      />

      <TodayMeals
        entries={entries ?? []}
        foods={foods ?? new Map()}
        onOpenDay={() => onOpenDay(today)}
        onAdd={(meal) => onAdd(today, meal)}
      />

      <WaterCard />

      <WeighInCard />

      <GoalCard onOpenTargets={onOpenTargets} />

      <CheckInCard />

      {weekDayCount > 0 && (
        <NutritionCard
          averages={dailyAverage(week ?? [])}
          dayCount={weekDayCount}
          sex={profile?.sex ?? null}
        />
      )}

      <BadgeStrip onOpen={onOpenBadges} />

      <LibraryCard onOpenRecipes={onOpenRecipes} onOpenRecipe={onOpenRecipe} />

      <button
        onClick={onOpenCoach}
        className="flex w-full items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-line active:bg-sunken"
      >
        <Sparkles size={18} className="shrink-0 text-accent" />
        <span className="flex-1 text-[14px] font-medium">Ask the coach</span>
        <span className="text-[12.5px] text-ink-muted">about your numbers</span>
      </button>

    </div>
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
