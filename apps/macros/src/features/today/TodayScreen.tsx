import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, formatDayHeading } from '@tracker-engine/core'
import { ChefHat, Flame, Sparkles } from 'lucide-react'
import * as repo from '@/data/repository'
import { dailyAverageCovered, dayTotals, remaining } from '@/lib/nutrition'
import { CheckInCard } from '@/features/checkin/CheckInCard'
import { foodIdsOf } from '@/features/shared/entryName'
import type { BodyWeightRow, Food, MealSlot, Profile } from '@/domain/types'
import { BudgetCard } from './BudgetCard'
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
  onOpenRecipes,
  onOpenDay,
  onOpenTargets,
  onAdd,
}: {
  onOpenCoach: () => void
  onOpenAbout: () => void
  onOpenRecipes: () => void
  onOpenDay: (day: string) => void
  onOpenTargets: () => void
  onAdd: (day: string, meal: MealSlot) => void
}) {
  const today = dayKey(Date.now())

  // Rows and their names together — see DayScreen for why they can't be two queries.
  const loaded = useLiveQuery(
    async () => {
      const rows = await repo.entriesForDay(today)
      return { entries: rows, foods: await repo.foodsByIds(foodIdsOf(rows)) }
    },
    [today],
    undefined,
  )
  const entries = loaded?.entries ?? []
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const program = useLiveQuery(() => repo.activeProgram(), [], undefined)
  const weights = useLiveQuery(() => repo.weights(), [], [])

  const week = useLiveQuery(
    () => repo.entriesBetween(dayKeyOffset(Date.now(), NUTRITION_DAYS - 1), today),
    [today],
    [],
  )
  const streak = useLiveQuery(() => repo.currentStreak(), [today], 0)

  const totals = dayTotals(entries)
  const left = targets ? remaining(totals, targets) : null
  const weekDayCount = new Set((week ?? []).map((entry) => entry.day)).size

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-baseline justify-between px-1">
        <h1 className="text-[17px] font-semibold tracking-tight">
          {formatDayHeading(Date.now())}
        </h1>
        {streak > 1 && (
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-accent">
            <Flame size={14} />
            {streak} day streak
          </span>
        )}
      </div>

      <BudgetCard
        totals={totals}
        targets={targets}
        left={left}
        window={profile?.eatingWindow ?? null}
        entries={entries}
        missing={missingForTarget(profile, program != null, weights ?? [])}
        onFix={onOpenAbout}
        onOpenDay={() => onOpenDay(today)}
      />

      <TodayMeals
        entries={entries}
        foods={loaded?.foods ?? new Map<string, Food>()}
        onOpenDay={() => onOpenDay(today)}
        onAdd={(meal) => onAdd(today, meal)}
      />

      <WaterCard />

      <WeighInCard />

      <GoalCard onOpenTargets={onOpenTargets} />

      <CheckInCard />

      {weekDayCount > 0 && (
        <NutritionCard
          nutrition={dailyAverageCovered(week ?? [])}
          dayCount={weekDayCount}
          sex={profile?.sex ?? null}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Shortcut icon={<ChefHat size={18} />} label="Library" onClick={onOpenRecipes} />
        <Shortcut icon={<Sparkles size={18} />} label="Coach" onClick={onOpenCoach} />
      </div>
    </div>
  )
}

function Shortcut({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3 text-left ring-1 ring-line active:bg-sunken"
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <span className="text-[14px] font-medium">{label}</span>
    </button>
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
