import { BottomSheet, Card } from '@tracker-engine/ui'
import { Bookmark, Camera, ChefHat, Check, Plus, Sparkles, Star, Utensils } from 'lucide-react'
import { cn } from '@/lib/cn'
import * as repo from '@/data/repository'
import { nutrientsFor, perServing, portionFor } from '@/lib/nutrition'
import { portionLabel, portionWithGrams } from '@/features/shared/format'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import type { LastAmount, LibraryHit, RecentItem } from '@/data/repository'
import type { Food } from '@/domain/types'
import type { Loggable } from './loggable'

/**
 * The rows and sheets the browse panel is made of.
 *
 * Lifted out of `LogScreen` when it passed a thousand lines: the screen's job is the state machine —
 * which panel is showing, what has been added — and these are presentation with no state of their own
 * beyond a busy flag. Nothing here reaches for the network or decides what gets logged.
 */

/**
 * The other ways in, named.
 *
 * Every one of these existed already; three were unlabelled icons and two were only reachable from a
 * different screen. Discoverability was the whole problem — "creating a recipe has disappeared" was
 * about a button that had never moved, on a tab you have to stop typing to see.
 */
export function MoreWaysSheet({
  onDismiss,
  onPick,
}: {
  onDismiss: () => void
  onPick: (kind: 'photo' | 'quick' | 'custom' | 'recipe') => void
}) {
  const options = [
    { kind: 'photo' as const, icon: Camera, label: 'Photo of the plate', hint: 'Broken into foods you can correct' },
    { kind: 'recipe' as const, icon: ChefHat, label: 'New recipe', hint: 'From a link, a pasted list, or a description' },
    { kind: 'custom' as const, icon: Bookmark, label: 'Add a food from its label', hint: 'For something the databases don’t have' },
    { kind: 'quick' as const, icon: Plus, label: 'Quick add', hint: 'Calories and macros straight in, no food behind it' },
  ]

  return (
    <BottomSheet onDismiss={onDismiss}>
      <ul className="divide-y divide-line">
        {options.map((option) => (
          <li key={option.kind}>
            <button
              onClick={() => onPick(option.kind)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunken"
            >
              <option.icon size={18} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium">{option.label}</span>
                <span className="block text-[12px] text-ink-muted">{option.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  )
}

/** Your own recipes and saved meals, above the database — because you named them yourself. */
export function LibraryHits({
  hits,
  onOpen,
}: {
  hits: readonly LibraryHit[]
  onOpen: (loggable: Loggable) => void
}) {
  return (
    <Card className="p-0">
      <h2 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Yours
      </h2>
      <ul className="divide-y divide-line">
        {hits.map((hit) => {
          const each = hit.kind === 'recipe' ? perServing(hit.recipe) : hit.template.nutrients
          return (
            <li key={`${hit.kind}:${hit.kind === 'recipe' ? hit.recipe.id : hit.template.id}`}>
              <button
                onClick={() =>
                  onOpen(
                    hit.kind === 'recipe'
                      ? { kind: 'recipe', recipe: hit.recipe }
                      : { kind: 'meal', template: hit.template },
                  )
                }
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left active:bg-sunken"
              >
                {hit.kind === 'recipe' ? (
                  <ChefHat size={14} className="shrink-0 text-ink-muted" />
                ) : (
                  <Bookmark size={14} className="shrink-0 text-ink-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{hit.name}</span>
                  <span className="tabular flex items-baseline gap-2 text-[12px] text-ink-muted">
                    <span>{each.kcal} kcal</span>
                    <MacroNumbers nutrients={each} />
                    <span>{hit.kind === 'recipe' ? 'a serving' : 'saved meal'}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * What you have eaten lately: dishes and foods in one list, newest first.
 *
 * A dish is one row with the name you gave it and the foods it contains as a subtitle, so "3 steak
 * tacos" is recognisable and re-loggable in a tap. This replaced a list of `day|meal` groups labelled
 * "Lunch · Tuesday", which named no food at all and grew a new row every time you ate the same lunch.
 *
 * Tapping either kind opens the same add screen. A dish used to log straight from a "Log" button on
 * the row — six rows written on one tap with nothing to confirm and nothing to say how much.
 */
export function RecentList({
  items,
  onOpen,
}: {
  items: readonly RecentItem[]
  onOpen: (loggable: Loggable) => void
}) {
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {items.map((item) =>
          item.kind === 'food' ? (
            <li key={`f:${item.food.id}`}>
              <button
                onClick={() => onOpen({ kind: 'food', food: item.food })}
                className="w-full px-4 py-2.5 text-left active:bg-sunken"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    {item.food.description}
                  </span>
                  <Times times={item.times} />
                </div>
                <div className="tabular truncate text-[12px] text-ink-muted">
                  {describeAmount(item.food, item.amount)}
                  {item.food.brand ? ` · ${item.food.brand}` : ''}
                </div>
              </button>
            </li>
          ) : (
            <li key={`d:${item.dishId}`}>
              <button
                onClick={() => onOpen({ kind: 'dish', dish: item })}
                className="w-full px-4 py-2.5 text-left active:bg-sunken"
              >
                <span className="flex items-baseline gap-2">
                  <Utensils size={13} className="shrink-0 translate-y-px text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {item.name}
                  </span>
                  <Times times={item.times} />
                </span>
                <span className="mt-0.5 flex items-baseline gap-2 pl-[21px]">
                  <span className="tabular shrink-0 text-[12px] font-semibold">
                    {item.nutrients.kcal} kcal
                  </span>
                  <MacroNumbers nutrients={item.nutrients} />
                </span>
                <span className="block truncate pl-[21px] text-[11.5px] text-ink-muted">
                  {item.parts.join(', ')}
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
    </Card>
  )
}

/** How many times this has been eaten in the window — only worth saying past once. */
export function Times({ times }: { times: number }) {
  if (times < 2) return null
  return <span className="tabular shrink-0 text-[11.5px] text-ink-muted">{times}×</span>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="p-4 text-center text-[13px] text-ink-muted">{children}</Card>
}

/** The grams a tick will log — the last amount, or the food's own portion, or 100 g. */
export function amountGrams(food: Food, last: LastAmount | null | undefined): number {
  if (last && last.grams > 0) return last.grams
  const portion = portionFor(food, null)
  return portion ? portion.grams : 100
}

export function describeAmount(food: Food, last: LastAmount | null | undefined): string {
  const grams = amountGrams(food, last)
  const portion = last?.portionId ? portionFor(food, last.portionId) : null
  const count = last?.portionCount ?? 1
  const amount = portion
    ? `${count} × ${portionLabel(portion)} · ${Math.round(grams)} g`
    : `${Math.round(grams)} g`
  return `${amount} · ${nutrientsFor(food, grams).kcal} kcal`
}

export function FoodList({
  foods,
  onSelect,
  picked,
  onToggle,
  favourites,
  lastAmounts,
  emptyLabel,
  footer = null,
  heading,
}: {
  foods: readonly Food[]
  onSelect: (food: Food) => void
  picked: readonly Food[]
  onToggle: (food: Food) => void
  favourites: readonly string[]
  /** Only populated for ticked foods, which is the only place the number is committed blind. */
  lastAmounts: ReadonlyMap<string, LastAmount>
  emptyLabel: string
  /** Shown under the rows — a "still searching" line, so results never have to disappear. */
  footer?: React.ReactNode
  heading?: string
}) {
  return (
    <Card className="p-0">
      {heading !== undefined && (
        <h2 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {heading}
        </h2>
      )}
      {foods.length === 0 && footer === null ? (
        <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-line">
          {foods.map((food) => {
            const isPicked = picked.some((row) => row.id === food.id)
            return (
              <li key={food.id} className="flex items-center">
                {/* The name sets the amount; the tick takes the last one. Two targets because the
                    two jobs are genuinely different, and collapsing them into one costs whichever
                    is less common a whole extra screen. */}
                <button
                  onClick={() => onSelect(food)}
                  className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken"
                >
                  <div className="truncate text-[14px]">{food.description}</div>
                  <div className="tabular truncate text-[12px] text-ink-muted">
                    {/*
                      Once ticked, the row states the amount about to be logged. The confirmation bar
                      used to describe it instead — "at the amount you last had each" — so a one-off
                      300 g portion was silently repeated with nothing on screen to catch it.
                    */}
                    {isPicked ? (
                      <span className="text-accent">{describeAmount(food, lastAmounts.get(food.id))}</span>
                    ) : (
                      <>
                        {food.brand ? `${food.brand} · ` : ''}
                        {food.per100.kcal} kcal / 100g
                        {food.portions.length > 0 && ` · ${portionWithGrams(food.portions[0]!)}`}
                      </>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => void repo.toggleFavourite(food.id)}
                  aria-pressed={favourites.includes(food.id)}
                  aria-label={`${favourites.includes(food.id) ? 'Unpin' : 'Pin'} ${food.description}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:opacity-60"
                >
                  <Star
                    size={16}
                    className={favourites.includes(food.id) ? 'fill-accent text-accent' : ''}
                  />
                </button>
                <button
                  onClick={() => onToggle(food)}
                  aria-pressed={isPicked}
                  aria-label={`${isPicked ? 'Remove' : 'Add'} ${food.description}`}
                  className={cn(
                    'mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg border active:opacity-60',
                    isPicked
                      ? 'border-accent bg-accent text-accent-contrast'
                      : 'border-line text-ink-muted',
                  )}
                >
                  {isPicked ? <Check size={16} /> : <Plus size={16} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {footer !== null && <div className="px-4 pb-2.5">{footer}</div>}
    </Card>
  )
}

/** The escape hatch from search: let a sentence be broken into foods. */
export function DescribeRow({ text, onOpen }: { text: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-2xl bg-accent-wash px-3.5 py-3 text-left active:opacity-70"
    >
      <Sparkles size={16} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-accent">
          Break down “{text}” as a meal
        </span>
        <span className="block text-[12px] text-ink-muted">
          Into real foods you can correct, kept together as one dish
        </span>
      </span>
    </button>
  )
}
