import { BottomSheet, Card } from '@tracker-engine/ui'
import { Bookmark, Camera, ChefHat, Check, PencilLine, Plus, Sparkles } from 'lucide-react'
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
 * which panel is showing, what has been added — and these are presentation with no state of their own.
 *
 * **Every row has the same shape**: name, then calories and macros, then one muted line of detail.
 * They used to differ by kind — a dish carried a cutlery icon that inset its text by 21px and a macro
 * line a plain food didn't have — so a list of five things looked like three unrelated designs.
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
    { kind: 'photo' as const, icon: Camera, label: 'Photo of the plate' },
    { kind: 'recipe' as const, icon: ChefHat, label: 'New recipe' },
    // "Add a food from its label" described the commonest reason rather than the thing, so it read
    // as a way of *reading* a label rather than of creating a food.
    { kind: 'custom' as const, icon: PencilLine, label: 'Create a food' },
    { kind: 'quick' as const, icon: Plus, label: 'Calories only' },
  ]

  return (
    <BottomSheet onDismiss={onDismiss}>
      <ul className="divide-y divide-line">
        {options.map((option) => (
          <li key={option.kind}>
            <button
              onClick={() => onPick(option.kind)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium active:bg-sunken"
            >
              <option.icon size={18} className="shrink-0 text-accent" />
              {option.label}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  )
}

/** Your own recipes and saved things, above the database — because you named them yourself. */
export function LibraryHits({
  hits,
  onOpen,
}: {
  hits: readonly LibraryHit[]
  onOpen: (loggable: Loggable) => void
}) {
  return (
    <Card className="p-0">
      <Heading>Yours</Heading>
      <ul className="divide-y divide-line">
        {hits.map((hit) => {
          const each = hit.kind === 'recipe' ? perServing(hit.recipe) : hit.template.nutrients
          return (
            <li key={`${hit.kind}:${hit.kind === 'recipe' ? hit.recipe.id : hit.template.id}`}>
              <Row
                onClick={() =>
                  onOpen(
                    hit.kind === 'recipe'
                      ? { kind: 'recipe', recipe: hit.recipe }
                      : { kind: 'meal', template: hit.template },
                  )
                }
                title={hit.name}
                nutrients={each}
                detail={hit.kind === 'recipe' ? 'a serving' : 'saved'}
              />
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
 * A dish is one row with the name you gave it and the foods it contains as its detail line, so "3
 * steak tacos" is recognisable and re-loggable in a tap. This replaced a list of `day|meal` groups
 * labelled "Lunch · Tuesday", which named no food at all and grew a row every time you ate the
 * same lunch.
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
        {items.map((item) => (
          <li key={item.kind === 'food' ? `f:${item.food.id}` : `d:${item.dishId}`}>
            {item.kind === 'food' ? (
              <Row
                onClick={() => onOpen({ kind: 'food', food: item.food })}
                title={item.food.description}
                nutrients={nutrientsFor(item.food, amountGrams(item.food, item.amount))}
                detail={describeAmount(item.food, item.amount)}
                times={item.times}
              />
            ) : (
              <Row
                onClick={() => onOpen({ kind: 'dish', dish: item })}
                title={item.name}
                nutrients={item.nutrients}
                detail={item.parts.join(', ')}
                times={item.times}
              />
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** One tappable thing: what it is, what it costs, and one line of detail. Nothing else. */
function Row({
  onClick,
  title,
  nutrients,
  detail,
  times,
}: {
  onClick: () => void
  title: string
  nutrients: Parameters<typeof MacroNumbers>[0]['nutrients']
  detail: string
  times?: number
}) {
  return (
    <button onClick={onClick} className="w-full px-4 py-2.5 text-left active:bg-sunken">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px]">{title}</span>
        {times !== undefined && times > 1 && (
          <span className="tabular shrink-0 text-[11.5px] text-ink-muted">{times}×</span>
        )}
      </span>
      <span className="tabular mt-0.5 flex items-baseline gap-2">
        <span className="shrink-0 text-[12px] font-semibold">{nutrients.kcal} kcal</span>
        <MacroNumbers nutrients={nutrients} />
      </span>
      {detail !== '' && (
        <span className="block truncate text-[11.5px] text-ink-muted">{detail}</span>
      )}
    </button>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </h2>
  )
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

function describeAmount(food: Food, last: LastAmount | null | undefined): string {
  const grams = amountGrams(food, last)
  const portion = last?.portionId ? portionFor(food, last.portionId) : null
  const count = last?.portionCount ?? 1
  return portion
    ? `${count} × ${portionLabel(portion)} · ${Math.round(grams)} g`
    : `${Math.round(grams)} g`
}

export function FoodList({
  foods,
  onSelect,
  picked,
  onToggle,
  saved,
  lastAmounts,
  emptyLabel,
  footer = null,
  heading,
}: {
  foods: readonly Food[]
  onSelect: (food: Food) => void
  picked: readonly Food[]
  onToggle: (food: Food) => void
  /** Ids the user has saved. One bookmark, one word, one list — see `LogScreen`. */
  saved: readonly string[]
  /** Only populated for ticked foods, which is the only place the number is committed blind. */
  lastAmounts: ReadonlyMap<string, LastAmount>
  emptyLabel: string
  /** Shown under the rows — a "still searching" line, so results never have to disappear. */
  footer?: React.ReactNode
  heading?: string
}) {
  return (
    <Card className="p-0">
      {heading !== undefined && <Heading>{heading}</Heading>}
      {foods.length === 0 && footer === null ? (
        <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-line">
          {foods.map((food) => {
            const isPicked = picked.some((row) => row.id === food.id)
            const isSaved = saved.includes(food.id)
            return (
              <li key={food.id} className="flex items-center">
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
                      <span className="text-accent">
                        {describeAmount(food, lastAmounts.get(food.id))} ·{' '}
                        {nutrientsFor(food, amountGrams(food, lastAmounts.get(food.id))).kcal} kcal
                      </span>
                    ) : (
                      <>
                        {food.brand ? `${food.brand} · ` : ''}
                        {food.per100.kcal} kcal / 100g
                        {food.portions.length > 0 && ` · ${portionWithGrams(food.portions[0]!)}`}
                      </>
                    )}
                  </div>
                </button>
                {/*
                  A bookmark, not a star. There were two words for one idea — a starred food was
                  "pinned" and a kept meal was "saved" — which made it impossible to guess where
                  anything would turn up. One bookmark, one Saved list, foods and meals together.
                */}
                <button
                  onClick={() => void repo.toggleSaved(food.id)}
                  aria-pressed={isSaved}
                  aria-label={`${isSaved ? 'Remove' : 'Save'} ${food.description}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:opacity-60"
                >
                  <Bookmark size={16} className={isSaved ? 'fill-accent text-accent' : ''} />
                </button>
                {/*
                  A square tickbox, not a "+". The two controls did different things — the row opens
                  an amount, this one takes the last amount and queues it — and drawing the second as
                  a plus made them read as two ways to do the same thing.
                */}
                <button
                  onClick={() => onToggle(food)}
                  role="checkbox"
                  aria-checked={isPicked}
                  aria-label={`Log ${food.description} with others`}
                  className={cn(
                    'mr-3 flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-2 active:opacity-60',
                    isPicked
                      ? 'border-accent bg-accent text-accent-contrast'
                      : 'border-line-strong text-transparent',
                  )}
                >
                  <Check size={14} strokeWidth={3} />
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

/** The escape hatch from search: let what you typed be broken into foods. */
export function DescribeRow({ text, onOpen }: { text: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-2xl bg-accent-wash px-3.5 py-3 text-left active:opacity-70"
    >
      <Sparkles size={16} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-accent">
        Work out “{text}” from its ingredients
      </span>
    </button>
  )
}
