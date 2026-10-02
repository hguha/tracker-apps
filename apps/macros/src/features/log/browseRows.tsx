import { BottomSheet, Card } from '@tracker-engine/ui'
import { Bookmark, Camera, ChefHat, Check, PencilLine, Plus, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@tracker-engine/core'
import * as repo from '@/data/repository'
import { nutrientsFor } from '@/lib/nutrition'
import { amountGrams, describeAmount, portionWithGrams } from '@/features/shared/format'
import { SwipeRow } from '@/features/shared/SwipeRow'
import { LoggableList } from '@/features/shared/LoggableList'
import type { LastAmount } from '@/data/repository'
import type { Food, MealTemplate } from '@/domain/types'
import type { Loggable } from '@/features/shared/loggable'

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

/**
 * The meals you kept, with a way to stop keeping them.
 *
 * There wasn't one. A bookmarked food had a filled bookmark to tap again, but a saved meal could only
 * be deleted from a different screen in Settings — so the answer to "how do I get rid of this" was
 * "somewhere else", which is the same as no answer.
 */
export function SavedMeals({
  templates,
  onOpen,
  onRemove,
}: {
  templates: readonly MealTemplate[]
  onOpen: (loggable: Loggable) => void
  onRemove: (template: MealTemplate) => void
}) {
  const items = templates.map((template) => ({
    key: `m:${template.id}`,
    title: template.name,
    nutrients: template.nutrients,
    detail: `${template.items.length} item${template.items.length === 1 ? '' : 's'}`,
    loggable: { kind: 'meal' as const, template },
  }))
  const byKey = new Map(templates.map((template) => [`m:${template.id}`, template]))

  return (
    <LoggableList
      items={items}
      onPick={(suggestion) => onOpen(suggestion.loggable)}
      actionsFor={(suggestion) => [
        {
          label: 'Remove',
          icon: Trash2,
          tone: 'critical',
          onAction: () => onRemove(byKey.get(suggestion.key)!),
        },
      ]}
    />
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
  isRemovable = false,
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
  /**
   * Whether a swipe offers to unsave. On for the Saved list, where getting rid of something is half
   * of what the list is visited for; off in search results, where nothing is being kept yet.
   */
  isRemovable?: boolean
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
            const row = (
              <div className="flex items-center bg-surface">
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
              </div>
            )
            return (
              <li key={food.id}>
                {isRemovable ? (
                  <SwipeRow
                    actions={[
                      {
                        label: 'Remove',
                        icon: Trash2,
                        tone: 'critical',
                        onAction: () => void repo.toggleSaved(food.id),
                      },
                    ]}
                  >
                    {row}
                  </SwipeRow>
                ) : (
                  row
                )}
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
        Ask AI about “{text}”
      </span>
    </button>
  )
}
