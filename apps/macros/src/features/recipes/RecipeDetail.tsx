import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, useToast } from '@tracker-engine/ui'
import {
  formatRelativeDay,
  fromDateTimeInputValue,
  toDateTimeInputValue,
} from '@tracker-engine/core'
import { ExternalLink, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { perServing, scale } from '@/lib/nutrition'
import { cuisineLabel } from '@/lib/cuisine'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS, mealForHour } from '@/lib/meals'
import { MealPicker } from '@/features/log/MealPicker'
import type { Food, MealSlot } from '@/domain/types'

/**
 * One recipe: what's in it, how to cook it, and a way to log having eaten it.
 *
 * This screen is why recipes were previously an unused feature. Tapping one went straight to the
 * *editor* — so the method an import had carefully read was never displayed anywhere, and the only
 * way to log a serving was to go somewhere else entirely and find the recipe again in a list.
 */
export function RecipeDetail({
  recipeId,
  onBack,
  onEdit,
}: {
  recipeId: string
  onBack: () => void
  onEdit: () => void
}) {
  const toast = useToast()
  const recipe = useLiveQuery(() => repo.getRecipe(recipeId), [recipeId], undefined)
  const usage = useLiveQuery(() => repo.recipeUsage(), [], new Map())

  const [servings, setServings] = useState(1)
  const [meal, setMeal] = useState<MealSlot>(() => mealForHour(new Date().getHours()))
  const [at, setAt] = useState(() => Date.now())
  const [isSaving, setIsSaving] = useState(false)

  const foods = useLiveQuery(
    () => repo.foodsByIds((recipe?.ingredients ?? []).map((i) => i.foodId).filter(isPresent)),
    [recipe?.id, recipe?.updatedAt],
    new Map<string, Food>(),
  )

  if (!recipe) {
    return (
      <Screen title="Recipe" onBack={onBack}>
        <Card className="p-4 text-[13.5px] text-ink-muted">This recipe is no longer here.</Card>
      </Screen>
    )
  }

  const each = perServing(recipe)
  const portion = scale(each, servings)
  const cooked = usage?.get(recipe.id)

  /**
   * One way to log a recipe, everywhere.
   *
   * There used to be two — as ingredients, or as a single opaque row — offered side by side with a
   * paragraph explaining the trade-off, and the *other* screens picked differently, so logging the
   * same chilli from Today and from here produced two completely different diaries. Ingredients win
   * because they carry strictly more (micronutrients, per-food correction, "the ricotta was a third of
   * the calories") and the reason anyone wanted the single row — a diary you can read — is now handled
   * by the shared `dishId` that collapses them to one line.
   *
   * An arrow after the guard, not a hoisted `function`: a hoisted declaration is not covered by the
   * `if (!recipe) return` above it, so `recipe` would still be possibly-undefined inside.
   */
  const log = () => {
    if (isSaving) return
    setIsSaving(true)
    return repo
      .logRecipeIngredients(recipe, servings, meal, at)
      .then(() => {
        toast.show(
          `${recipe.name} · ${servings === 1 ? 'a serving' : `${servings} servings`} · ${MEAL_LABELS[
            meal
          ].toLowerCase()}`,
        )
        onBack()
      })
      .finally(() => setIsSaving(false))
  }

  return (
    <Screen
      title={recipe.name}
      onBack={onBack}
      action={
        <button
          onClick={onEdit}
          aria-label="Edit this recipe"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <Pencil size={17} />
        </button>
      }
    >
      <Card className="p-4">
        <p className="tabular text-[22px] font-bold leading-none">
          {each.kcal}
          <span className="text-[13px] font-medium text-ink-muted"> kcal per serving</span>
        </p>
        <p className="tabular mt-1 text-[13px] text-ink-muted">
          {grams(each.proteinMg)}P {grams(each.carbsMg)}C {grams(each.fatMg)}F · makes{' '}
          {recipe.servings}
        </p>
        <p className="mt-2 text-[12.5px] text-ink-muted">
          {[
            cuisineLabel(recipe.cuisine),
            recipe.totalMinutes !== null && `${recipe.totalMinutes} min`,
            cooked ? `cooked ${cooked.timesCooked}×` : 'never logged',
            cooked?.lastCookedDay &&
              `last ${formatRelativeDay(Date.parse(`${cooked.lastCookedDay}T12:00:00`)).toLowerCase()}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </Card>

      <Card className="space-y-2.5 p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Log a serving
        </h2>

        <div className="flex items-center gap-3">
          <Stepper
            value={servings}
            onChange={setServings}
            label="Servings of this recipe"
          />
          <p className="tabular min-w-0 flex-1 text-[13px]">
            <span className="font-semibold">{portion.kcal} kcal</span>
            <span className="text-ink-muted">
              {' '}
              · {grams(portion.proteinMg)}P {grams(portion.carbsMg)}C {grams(portion.fatMg)}F
            </span>
          </p>
        </div>

        <MealPicker value={meal} onChange={setMeal} />
        <label className="block">
          <span className="text-[11px] text-ink-muted">When · {formatRelativeDay(at)}</span>
          <input
            type="datetime-local"
            value={toDateTimeInputValue(at)}
            onChange={(event) => {
              const next = fromDateTimeInputValue(event.target.value)
              if (Number.isFinite(next)) setAt(next)
            }}
            className="tabular mt-1 w-full rounded-xl bg-sunken px-3 py-2 text-[14px] outline-none"
          />
        </label>

        {/* Venue is not asked: logging a recipe means you cooked it, which is the one action in the
            app where "home" is a fact rather than a guess. */}
        <Button className="w-full" disabled={isSaving} onClick={() => void log()}>
          {isSaving ? 'Logging…' : `Log ${portion.kcal} kcal`}
        </Button>
        <p className="text-[12px] text-ink-muted">
          Lands as one line called {recipe.name}, with each ingredient underneath it — so the
          micronutrients count and you can correct one without redoing the meal.
        </p>
      </Card>

      <Card className="p-0">
        <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Ingredients
        </h2>
        <ul className="divide-y divide-line">
          {recipe.ingredients.map((ingredient) => (
            <li key={ingredient.id} className="flex items-baseline gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px]">
                {(ingredient.foodId ? foods?.get(ingredient.foodId)?.description : null) ??
                  ingredient.label}
                {ingredient.foodId === null && (
                  <span className="text-[11.5px]" style={{ color: 'var(--status-serious)' }}>
                    {' '}
                    · not counted
                  </span>
                )}
              </span>
              <span className="tabular shrink-0 text-[13px] text-ink-muted">
                {Math.round(ingredient.grams)}g
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {recipe.steps.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            Method
          </h2>
          <ol className="mt-2 space-y-2">
            {recipe.steps.map((step, index) => (
              <li key={index} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                <span className="tabular shrink-0 font-semibold text-accent">{index + 1}</span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="p-4">
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 text-[13.5px] font-semibold text-accent"
          >
            <ExternalLink size={15} />
            Open the original
          </a>
        )}
        <button
          onClick={() => {
            void repo.deleteRecipe(recipe.id).then(() => {
              toast.show('Recipe deleted')
              onBack()
            })
          }}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-[13.5px] font-semibold active:bg-sunken"
          style={{ color: 'var(--status-critical)' }}
        >
          <Trash2 size={15} />
          Delete this recipe
        </button>
        <p className="mt-2 text-[12px] text-ink-muted">
          Servings you have already logged stay exactly as they are — a log entry keeps the
          nutrients it was written with.
        </p>
      </Card>
    </Screen>
  )
}

/** Halves, because that's how a batch dish is actually eaten. */
function Stepper({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (value: number) => void
  label: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-xl bg-sunken p-1">
      <button
        onClick={() => onChange(Math.max(0.5, Math.round((value - 0.5) * 2) / 2))}
        aria-label={`Fewer ${label}`}
        className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-page"
      >
        <Minus size={15} />
      </button>
      <span className="tabular w-9 text-center text-[14px] font-semibold" aria-label={label}>
        {value}
      </span>
      <button
        onClick={() => onChange(Math.min(20, Math.round((value + 0.5) * 2) / 2))}
        aria-label={`More ${label}`}
        className="flex size-8 items-center justify-center rounded-lg text-ink-secondary active:bg-page"
      >
        <Plus size={15} />
      </button>
    </div>
  )
}

const isPresent = (value: string | null): value is string => value !== null
