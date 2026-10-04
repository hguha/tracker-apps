import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  dayKey,
  dayKeyOffset,
  dayNoon,
  formatDayHeading,
  formatTimeOfDay,
  plural,
} from '@tracker-engine/core'
import { Card, ScreenHeader, SearchField, useToast } from '@tracker-engine/ui'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import * as repo from '@/data/repository'
import { dayTotals } from '@/lib/nutrition'
import { mealGroups, type DishGroup, type MealGroup } from '@/lib/dayGroups'
import { dayTiming, formatDuration } from '@/lib/mealTiming'
import { MEAL_LABELS, mealForHour } from '@/lib/meals'
import { entryName, foodIdsOf } from '@/features/shared/entryName'
import { useDebouncedValue } from '@/features/shared/useDebouncedValue'
import { MacroNumbers } from '@/features/shared/MacroNumbers'
import { LoggableList } from '@/features/shared/LoggableList'
import { fromRecent } from '@/features/shared/loggable'
import { SwipeRow } from '@/features/shared/SwipeRow'
import { VenueChoice } from '@/features/shared/VenueChoice'
import { SaveRecipeSheet } from '@/features/shared/SaveRecipeSheet'
import { EditEntryScreen, type EditSubject } from '@/features/log/EditEntryScreen'
import {
  MEAL_SLOTS,
  type Food,
  type LogEntry,
  type MealSlot,
} from '@/domain/types'
import { DayTotals } from './DayTotals'

/** Past this, a meal slot covers two separate sittings and its header needs to say a range. */
const SPREAD_MS = 90 * 60_000

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
  const [editing, setEditing] = useState<EditSubject | null>(null)
  const [savingMeal, setSavingMeal] = useState<LogEntry[] | null>(null)
  /** What to look for in the diary — see the search field below. */
  const [find, setFind] = useState('')

  const today = dayKey(Date.now())
  /**
   * The rows and their foods in one query, not two.
   *
   * As two, the names arrived a render later than the rows — so every row briefly read "Food", which
   * is `entryName`'s fallback for a food that genuinely isn't cached. A flicker showing the *wrong*
   * word is worse than a slower first paint, and the second query only started once the first had
   * resolved anyway, so nothing is lost by asking for both together.
   */
  const loaded = useLiveQuery(
    async () => {
      const rows = await repo.entriesForDay(day)
      return { entries: rows, foods: await repo.foodsByIds(foodIdsOf(rows)) }
    },
    [day],
    undefined,
  )
  const entries = loaded?.entries
  const foods = loaded?.foods ?? new Map<string, Food>()
  const target = useLiveQuery(async () => (await repo.targetsByDay([day])).get(day) ?? null, [day], null)

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

  if (editing) return <EditEntryScreen subject={editing} onClose={() => setEditing(null)} />

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={formatDayHeading(dayNoon(day))}
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
          onClick={() => setDay(dayKeyOffset(dayNoon(day), 1))}
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
          onClick={() => setDay(dayKeyOffset(dayNoon(day), -1))}
          disabled={day >= today}
          aria-label="Next day"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary disabled:opacity-30 active:bg-sunken"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-8">
        {/*
          Searching what you've already eaten, straight into this day.

          Not a second copy of the add-food screen: this only finds things from the diary, which is the
          case the day screen is the right place for. "Have this again" already re-logs a dish in one
          tap — but only if the dish happens to be on the day you are looking at, so the useful version
          of it was reachable by scrolling back through history to find where you last ate the thing.
        */}
        <SearchField
          value={find}
          onChange={setFind}
          placeholder="Something you've eaten before"
        />
        {find.trim().length >= 2 ? (
          <PastItems
            query={find}
            onLog={(log, name) => {
              void log().then((count) => {
                if (count > 0) {
                  setFind('')
                  toast.show(`${name} added`)
                }
              })
            }}
            day={day}
          />
        ) : (
          <>
            <DayTotals totals={totals} target={target} meals={meals.length} />

            {meals.map((group) => (
              <MealCard
                key={group.meal}
                group={group}
                foods={foods}
                onAdd={() => onAdd(day, group.meal)}
                onSave={() => setSavingMeal(group.entries)}
                onEdit={setEditing}
                onLogAgain={(dishId, name) => {
                  void repo.logDishAgain(dishId).then((n) => {
                    if (n > 0) toast.show(`${name} logged again`)
                  })
                }}
                onRemove={(dishId, name) => {
                  void repo.deleteDish(dishId).then((n) => {
                    if (n > 0) toast.show(`${name} removed`)
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
          </>
        )}
      </div>

      {savingMeal && (
        <SaveRecipeSheet
          entries={savingMeal}
          defaultName={defaultMealName(savingMeal[0]!)}
          onDismiss={() => setSavingMeal(null)}
        />
      )}
    </div>
  )
}

/**
 * Things eaten before, matched by name, each one tap from being on this day.
 *
 * Logged at the amount it was last eaten in and at the time of day the day is being viewed for, which
 * is the same contract as "Have this again" and as ticking foods on the add screen. No portion step:
 * this list only contains things whose amount is already known, and re-picking it is what the add
 * screen is for.
 */
function PastItems({
  query,
  day,
  onLog,
}: {
  query: string
  day: string
  onLog: (log: () => Promise<number>, name: string) => void
}) {
  const settled = useDebouncedValue(query)
  const items = useLiveQuery(() => repo.searchHistory(settled), [settled], undefined)

  // The clock time now, on that date: a meal added to last Tuesday happened at *some* hour, and
  // stamping it midnight would file it before breakfast.
  const at = () => {
    const now = new Date()
    const midnight = Date.parse(`${day}T00:00:00`)
    return Number.isFinite(midnight)
      ? midnight + (now.getHours() * 60 + now.getMinutes()) * 60_000
      : Date.now()
  }

  if (items === undefined) return null
  if (items.length === 0) {
    return (
      <Card className="p-4 text-center text-[13px] text-ink-muted">
        Nothing in your diary matches that.
      </Card>
    )
  }

  return (
    <LoggableList
      heading="One tap, as you last had it"
      items={items.map(fromRecent)}
      onPick={(repeat) => {
        const when = at()
        onLog(
          () =>
            repeat.logAgain({
              meal: mealForHour(new Date(when).getHours()),
              at: when,
              venue: 'home',
            }),
          repeat.title,
        )
      }}
    />
  )
}

/** One meal: its total, where it was eaten, its dishes, and a way to add to it. */
function MealCard({
  group,
  foods,
  onAdd,
  onSave,
  onEdit,
  onLogAgain,
  onRemove,
}: {
  group: MealGroup
  foods: ReadonlyMap<string, Food>
  onAdd: () => void
  onSave: () => void
  onEdit: (subject: EditSubject) => void
  onLogAgain: (dishId: string, name: string) => void
  onRemove: (dishId: string, name: string) => void
}) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">{MEAL_LABELS[group.meal]}</span>
          <span className="tabular block text-[11.5px] text-ink-muted">
            {formatTimeOfDay(group.firstAt)}
            {group.lastAt - group.firstAt >= SPREAD_MS && `–${formatTimeOfDay(group.lastAt)}`}
            {' · '}
            {group.nutrients.kcal} kcal
          </span>
        </span>
        <button
          onClick={onSave}
          aria-label="Save as a recipe"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
        >
          <Bookmark size={15} />
        </button>
      </div>

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
              onOpen={() => onEdit({ kind: 'entry', id: dish.entries[0]!.id })}
            />
          ) : (
            <DishRow
              key={dish.dishId}
              dish={dish}
              onOpen={() => onEdit({ kind: 'dish', dishId: dish.dishId! })}
              onLogAgain={() => onLogAgain(dish.dishId!, dish.name ?? 'Dish')}
              onRemove={() => onRemove(dish.dishId!, dish.name ?? 'Dish')}
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

function DishRow({
  dish,
  onOpen,
  onLogAgain,
  onRemove,
}: {
  dish: DishGroup
  onOpen: () => void
  onLogAgain: () => void
  onRemove: () => void
}) {
  return (
    <li>
      <SwipeRow
        actions={[
          { label: 'Again', icon: Plus, onAction: onLogAgain },
          { label: 'Delete', icon: Trash2, tone: 'critical', onAction: onRemove },
        ]}
      >
        <button onClick={onOpen} className="w-full px-3.5 py-2.5 text-left active:bg-sunken">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
              {dish.name ?? 'Dish'}
            </span>
            <span className="tabular w-11 shrink-0 text-right text-[11.5px] text-ink-muted">
              {plural(dish.entries.length, 'item')}
            </span>
            <span className="tabular w-11 shrink-0 text-right text-[13px] font-semibold">
              {dish.nutrients.kcal}
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-muted" />
          </span>
          <MacroNumbers nutrients={dish.nutrients} className="mt-0.5" />
        </button>
      </SwipeRow>
    </li>
  )
}

function EntryRow({
  entry,
  name,
  onOpen,
}: {
  entry: LogEntry
  name: string
  onOpen: () => void
}) {
  return (
    <li>
      <SwipeRow
        actions={[
          {
            label: 'Again',
            icon: Copy,
            onAction: () => void repo.relogEntries([entry], { at: Date.now() }),
          },
          {
            label: 'Delete',
            icon: Trash2,
            tone: 'critical',
            onAction: () => void repo.deleteEntry(entry.id),
          },
        ]}
      >
        <button onClick={onOpen} className="w-full px-3.5 py-2 text-left active:bg-sunken">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px]">{name}</span>
            <span className="tabular w-11 shrink-0 text-right text-[11.5px] text-ink-muted">
              {entry.grams > 0 ? `${Math.round(entry.grams)}g` : ''}
            </span>
            <span className="tabular w-11 shrink-0 text-right text-[13px] font-medium">
              {entry.nutrients.kcal}
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-muted" />
          </span>
          <span className="mt-0.5 flex items-baseline gap-2">
            <MacroNumbers nutrients={entry.nutrients} />
            <span className="tabular flex-1 text-right text-[11px] text-ink-muted">
              {formatTimeOfDay(entry.eatenAt)}
            </span>
          </span>
        </button>
      </SwipeRow>
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

const defaultMealName = (entry: LogEntry): string =>
  `${MEAL_LABELS[entry.meal]} · ${new Date(entry.eatenAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`
