import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, formatDayHeading, formatTimeOfDay } from '@tracker-engine/core'
import { Card, ScreenHeader, useToast } from '@tracker-engine/ui'
import {
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  RotateCcw,
  Trash2,
  Utensils,
} from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { dayTotals } from '@/lib/nutrition'
import { mealGroups, type DishGroup, type MealGroup } from '@/lib/dayGroups'
import { dayTiming, formatDuration } from '@/lib/mealTiming'
import { MEAL_LABELS } from '@/lib/meals'
import { entryName, foodIdsOf } from '@/features/shared/entryName'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { VenueChoice } from '@/features/shared/VenueChoice'
import { SaveMealSheet } from '@/features/today/SaveMealSheet'
import { EntrySheet } from '@/features/today/EntrySheet'
import { AmountStepper } from './AmountStepper'
import {
  MEAL_SLOTS,
  type Food,
  type LogEntry,
  type MealSlot,
} from '@/domain/types'
import { DayTotals } from './DayTotals'

/**
 * One day of food, editable.
 *
 * **Grouped by meal, then by dish.** It used to group by a 45-minute gap in the clock and label each
 * group with the first row's meal slot, which is two models fighting: logging four things over a long
 * afternoon gave four cards all headed "Lunch", and a snack twenty minutes after lunch vanished into
 * it. See `lib/dayGroups` for why the slot wins.
 *
 * **Every change is written immediately, and "Revert" undoes the lot.** A draft that only commits on
 * Save reads well in a spec and loses work in practice — one back-swipe and twenty corrections are
 * gone. So the screen snapshots the day when it opens and offers to put it back, which is the same
 * promise with none of the risk. See `repo.restoreDay`.
 */
export function DayScreen({
  day: initialDay,
  onClose,
  onAdd,
}: {
  day: string
  onClose: () => void
  /** Opens the log screen for this day and meal — adding food is a whole flow of its own. */
  onAdd: (day: string, meal: MealSlot) => void
}) {
  const toast = useToast()
  const [day, setDay] = useState(initialDay)
  const [editing, setEditing] = useState<{ entry: LogEntry; siblings: LogEntry[] } | null>(null)
  const [savingMeal, setSavingMeal] = useState<LogEntry[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const today = dayKey(Date.now())
  const entries = useLiveQuery(() => repo.entriesForDay(day), [day], undefined)
  const target = useLiveQuery(async () => (await repo.targetsByDay([day])).get(day) ?? null, [day], null)
  const foods = useLiveQuery(
    async () => repo.foodsByIds(foodIdsOf(entries ?? [])),
    [entries],
    new Map<string, Food>(),
  )

  // The snapshot is taken per day and only once, so switching days with the arrows re-arms Revert
  // for the new day rather than carrying the old one's state across.
  const snapshot = useRef<{ day: string; rows: LogEntry[]; takenAt: number } | null>(null)
  const [hasSnapshot, setHasSnapshot] = useState(false)
  useEffect(() => {
    if (entries === undefined || snapshot.current?.day === day) return
    snapshot.current = { day, rows: entries.map((entry) => ({ ...entry })), takenAt: Date.now() }
    setHasSnapshot(true)
  }, [day, entries])

  const rows = entries ?? []
  const meals = mealGroups(rows)
  const timing = dayTiming(rows)
  const totals = dayTotals(rows)
  const isToday = day === today
  const emptySlots = MEAL_SLOTS.filter((slot) => !meals.some((group) => group.meal === slot))
  // A snapshot with the same contents as the day means nothing has changed yet.
  const isDirty =
    snapshot.current?.day === day &&
    hasSnapshot &&
    !sameEntries(snapshot.current.rows, rows)

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={formatDayHeading(Date.parse(`${day}T12:00:00`))}
        onBack={onClose}
        action={
          isDirty ? (
            <button
              onClick={() => {
                const taken = snapshot.current
                if (!taken) return
                void repo.restoreDay(taken.day, taken.rows, taken.takenAt).then(() => {
                  toast.show('Changes reverted')
                })
              }}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-accent active:bg-sunken"
            >
              <RotateCcw size={15} />
              Revert
            </button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <button
          onClick={() => setDay(dayKeyOffset(Date.parse(`${day}T12:00:00`), 1))}
          aria-label="Previous day"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="tabular flex-1 text-center text-[12.5px] text-ink-muted">
          {/* Keyed on firstAt, not on the span: a day with one meal has a time but no span, and
              reading that as "nothing logged" is exactly the wrong thing to say about it. */}
          {timing.firstAt === null
            ? 'Nothing logged'
            : timing.spanMinutes === null
              ? formatTimeOfDay(timing.firstAt)
              : `${formatTimeOfDay(timing.firstAt)}–${formatTimeOfDay(timing.lastAt!)} · ${formatDuration(timing.spanMinutes)}`}
        </span>
        <button
          onClick={() => setDay(dayKeyOffset(Date.parse(`${day}T12:00:00`), -1))}
          disabled={day >= today}
          aria-label="Next day"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary disabled:opacity-30 active:bg-sunken"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-8">
        <DayTotals totals={totals} target={target} meals={meals.length} />

        {meals.map((group) => (
          <MealCard
            key={group.meal}
            group={group}
            foods={foods ?? new Map()}
            expanded={expanded}
            onExpand={(key) => setExpanded((current) => (current === key ? null : key))}
            onAdd={() => onAdd(day, group.meal)}
            onSave={() => setSavingMeal(group.entries)}
            onDetails={(entry) => setEditing({ entry, siblings: group.entries })}
            onLogAgain={(dishId, name) => {
              void repo.logDishAgain(dishId).then((n) => {
                if (n > 0) toast.show(`${name} logged again`)
              })
            }}
          />
        ))}

        {/*
          The meals with nothing in them, as one row of buttons rather than four empty cards. Every
          slot stays reachable — adding to breakfast on a past day used to depend on guessing which
          meal an unlabelled "Add food" button would pick.
        */}
        <div className="flex gap-1.5">
          {emptySlots.map((slot) => (
            <button
              key={slot}
              onClick={() => onAdd(day, slot)}
              className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong py-2.5 text-[12.5px] font-medium text-ink-secondary active:bg-sunken"
            >
              <Plus size={13} className="shrink-0" />
              <span className="truncate">{MEAL_LABELS[slot]}</span>
            </button>
          ))}
        </div>

        {meals.length === 0 && (
          <Card className="p-5 text-center">
            <p className="text-[13.5px] text-ink-muted">
              Nothing logged {isToday ? 'yet today' : 'on this day'} — pick a meal above to start.
            </p>
          </Card>
        )}

        {!isToday && rows.length > 0 && (
          <button
            onClick={() => {
              void repo.copyDay(day, today).then((n) => toast.show(`Copied ${n} items to today`))
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-[13.5px] font-semibold text-accent active:bg-accent-wash"
          >
            <Copy size={15} />
            Copy this day to today
          </button>
        )}
      </div>

      {editing && (
        <EntrySheet
          entry={editing.entry}
          name={entryName(editing.entry, foods ?? new Map())}
          siblings={editing.siblings}
          onDismiss={() => setEditing(null)}
        />
      )}

      {savingMeal && (
        <SaveMealSheet
          entries={savingMeal}
          defaultName={defaultMealName(savingMeal[0]!)}
          onDismiss={() => setSavingMeal(null)}
        />
      )}
    </div>
  )
}

/** One meal: its total, where it was eaten, its dishes, and a way to add to it. */
function MealCard({
  group,
  foods,
  expanded,
  onExpand,
  onAdd,
  onSave,
  onDetails,
  onLogAgain,
}: {
  group: MealGroup
  foods: ReadonlyMap<string, Food>
  expanded: string | null
  onExpand: (key: string) => void
  onAdd: () => void
  onSave: () => void
  onDetails: (entry: LogEntry) => void
  onLogAgain: (dishId: string, name: string) => void
}) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">{MEAL_LABELS[group.meal]}</span>
          <span className="tabular block text-[11.5px] text-ink-muted">
            {formatTimeOfDay(group.firstAt)} · {group.nutrients.kcal} kcal
          </span>
        </span>
        <button
          onClick={onSave}
          aria-label="Save this meal to log again"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <Bookmark size={15} />
        </button>
      </div>

      {/*
        The venue question lives here, not in the log flow. This is the moment the answer is known —
        the meal is finished and sitting in front of you — and one tap covers every row in it.
      */}
      <div className="border-b border-line px-3.5 py-2">
        <VenueChoice entries={group.entries} />
      </div>

      <ul className="divide-y divide-line">
        {group.dishes.map((dish) =>
          dish.dishId === null ? (
            <EntryRow
              key={dish.entries[0]!.id}
              entry={dish.entries[0]!}
              name={entryName(dish.entries[0]!, foods)}
              isOpen={expanded === dish.entries[0]!.id}
              onToggle={() => onExpand(dish.entries[0]!.id)}
              onDetails={() => onDetails(dish.entries[0]!)}
            />
          ) : (
            <DishRow
              key={dish.dishId}
              dish={dish}
              foods={foods}
              isOpen={expanded === dish.dishId}
              onToggle={() => onExpand(dish.dishId!)}
              expandedEntry={expanded}
              onExpandEntry={onExpand}
              onDetails={onDetails}
              onLogAgain={() => onLogAgain(dish.dishId!, dish.name ?? 'Dish')}
            />
          ),
        )}
      </ul>

      <button
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2.5 text-[13px] font-semibold text-accent active:bg-sunken"
      >
        <Plus size={14} />
        Add to {MEAL_LABELS[group.meal].toLowerCase()}
      </button>
    </Card>
  )
}

/**
 * A dish: one line with the name the user gave it, opening onto the foods it resolved to.
 *
 * This is the fix for the single worst thing the app did. "3 steak tacos" resolved to six USDA rows
 * — *Tortillas, corn* · *Beef, round, top round steak* · *Cheddar cheese* · … — and the diary then
 * contained nothing the person recognised as their lunch, and nothing to tap to have another one.
 * The ingredients are still all there, one tap down, because they are what makes the macros and the
 * micronutrients right.
 */
function DishRow({
  dish,
  foods,
  isOpen,
  onToggle,
  expandedEntry,
  onExpandEntry,
  onDetails,
  onLogAgain,
}: {
  dish: DishGroup
  foods: ReadonlyMap<string, Food>
  isOpen: boolean
  onToggle: () => void
  expandedEntry: string | null
  onExpandEntry: (key: string) => void
  onDetails: (entry: LogEntry) => void
  onLogAgain: () => void
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn('w-full px-3.5 py-2.5 text-left active:bg-sunken', isOpen && 'bg-sunken/60')}
      >
        <span className="flex items-baseline gap-2">
          <Utensils size={13} className="shrink-0 translate-y-px text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            {dish.name ?? 'Dish'}
          </span>
          <span className="tabular shrink-0 text-[13px] font-semibold">
            {dish.nutrients.kcal}
          </span>
          <ChevronDown
            size={15}
            className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
          />
        </span>
        <span className="mt-0.5 flex items-baseline gap-2 pl-[21px]">
          <MacroNumbers nutrients={dish.nutrients} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-muted">
            {dish.entries.length} item{dish.entries.length === 1 ? '' : 's'}
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-line bg-sunken/30">
          <ul className="divide-y divide-line">
            {dish.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                name={entryName(entry, foods)}
                isOpen={expandedEntry === entry.id}
                onToggle={() => onExpandEntry(entry.id)}
                onDetails={() => onDetails(entry)}
                inset
              />
            ))}
          </ul>
          <button
            onClick={onLogAgain}
            className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-[12.5px] font-semibold text-accent active:bg-sunken"
          >
            <Plus size={13} />
            Have this again
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * One food, with its amount editable in place.
 *
 * Tapping expands rather than opening a sheet, because changing a portion is the overwhelmingly
 * common correction and a sheet costs two extra taps to do it. Everything rarer — the meal, the
 * time, deleting — is behind "More".
 *
 * The macros are on the row as numbers. They used to be a colour bar and a gram figure, which
 * answers "roughly what shape is this" but not "how much protein was the chicken" — and the second
 * question is the one somebody opens a day to ask.
 */
function EntryRow({
  entry,
  name,
  isOpen,
  onToggle,
  onDetails,
  inset = false,
}: {
  entry: LogEntry
  name: string
  isOpen: boolean
  onToggle: () => void
  onDetails: () => void
  inset?: boolean
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'w-full py-2 pr-3.5 text-left active:bg-sunken',
          inset ? 'pl-[34px]' : 'pl-3.5',
          isOpen && 'bg-sunken/60',
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px]">{name}</span>
          {entry.grams > 0 && (
            <span className="tabular shrink-0 text-[11.5px] text-ink-muted">
              {Math.round(entry.grams)}g
            </span>
          )}
          <span className="tabular w-11 shrink-0 text-right text-[13px] font-medium">
            {entry.nutrients.kcal}
          </span>
        </span>
        <MacroNumbers nutrients={entry.nutrients} className="mt-0.5" />
      </button>

      {isOpen && (
        <div
          className={cn(
            'flex items-center gap-2 border-t border-line py-2 pr-3.5',
            inset ? 'pl-[34px]' : 'pl-3.5',
          )}
        >
          <AmountStepper entry={entry} label={name} />
          <button
            onClick={onDetails}
            className="shrink-0 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-accent active:bg-page"
          >
            More
          </button>
          <button
            onClick={() => void repo.deleteEntry(entry.id)}
            aria-label={`Remove ${name}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg active:bg-page"
            style={{ color: 'var(--status-critical)' }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </li>
  )
}

/** Whether the day still matches its snapshot, on the fields the screen can change. */
function sameEntries(a: readonly LogEntry[], b: readonly LogEntry[]): boolean {
  if (a.length !== b.length) return false
  const key = (entry: LogEntry) =>
    `${entry.id}|${entry.grams}|${entry.meal}|${entry.eatenAt}|${entry.venue}|${entry.nutrients.kcal}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.every((value, index) => value === right[index])
}

/**
 * What to call a saved meal, before the user renames it.
 *
 * The date, not the clock time: "Breakfast · 11 Aug" is a thing you can find again in a list a month
 * later, and "Breakfast · 11:15" is a fact about one morning that tells you nothing about which
 * morning.
 */
const defaultMealName = (entry: LogEntry): string =>
  `${MEAL_LABELS[entry.meal]} · ${new Date(entry.eatenAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`
