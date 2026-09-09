import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, dayKeyOffset, formatDayHeading, formatTimeOfDay } from '@tracker-engine/core'
import { Card, ScreenHeader, useToast } from '@tracker-engine/ui'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { dayTotals } from '@/lib/nutrition'
import { dayTiming, eatingOccasions, formatDuration } from '@/lib/mealTiming'
import { grams as fmtGrams } from '@/features/shared/format'
import { MEAL_LABELS, mealForHour } from '@/features/shared/meals'
import { entryName, foodIdsOf } from '@/features/shared/entryName'
import { MacroSplitBar } from '@/features/shared/MacroSplitBar'
import { VENUE_ICONS, VENUE_LABELS, VENUE_LONG } from '@/features/shared/venue'
import { SaveMealSheet } from '@/features/today/SaveMealSheet'
import { EntrySheet } from '@/features/today/EntrySheet'
import { VENUES, type Food, type LogEntry, type MealSlot } from '@/domain/types'
import { DayTotals } from './DayTotals'

/**
 * One day of food, editable.
 *
 * Modelled on REPutation's session screen: the thing you are working on gets its own screen, with
 * its totals at the top and its contents as cards you can act on directly. The History tab used to
 * expand a day into an unbroken run of small grey text, which is legible in the sense that the
 * characters are all present.
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
  const occasions = eatingOccasions(rows)
  const timing = dayTiming(rows)
  const totals = dayTotals(rows)
  const isToday = day === today
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
        <DayTotals totals={totals} target={target} occasions={occasions.length} />

        {occasions.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-[13.5px] text-ink-muted">
              Nothing logged {isToday ? 'yet today' : 'on this day'}.
            </p>
          </Card>
        ) : (
          occasions.map((occasion) => (
            <Card key={occasion.startAt} className="p-0">
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="tabular block text-[13.5px] font-semibold">
                    {formatTimeOfDay(occasion.startAt)}
                    <span className="font-normal text-ink-muted">
                      {' '}
                      · {MEAL_LABELS[occasion.entries[0]!.meal]}
                    </span>
                  </span>
                  <span className="tabular block text-[11.5px] text-ink-muted">
                    {occasion.nutrients.kcal} kcal · {fmtGrams(occasion.nutrients.proteinMg)}P{' '}
                    {fmtGrams(occasion.nutrients.carbsMg)}C {fmtGrams(occasion.nutrients.fatMg)}F
                  </span>
                </span>
                <VenuePills entries={occasion.entries} />
                <button
                  onClick={() => setSavingMeal(occasion.entries)}
                  aria-label="Save this meal to log again"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Bookmark size={15} />
                </button>
              </div>

              <ul className="divide-y divide-line">
                {occasion.entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    name={entryName(entry, foods ?? new Map())}
                    isOpen={expanded === entry.id}
                    onToggle={() =>
                      setExpanded((current) => (current === entry.id ? null : entry.id))
                    }
                    onDetails={() => setEditing({ entry, siblings: occasion.entries })}
                  />
                ))}
              </ul>

              <button
                onClick={() => onAdd(day, occasion.entries[0]!.meal)}
                className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-[12.5px] font-semibold text-accent active:bg-sunken"
              >
                <Plus size={14} />
                Add to {MEAL_LABELS[occasion.entries[0]!.meal].toLowerCase()}
              </button>
            </Card>
          ))
        )}

        <button
          onClick={() =>
            onAdd(day, isToday ? mealForHour(new Date().getHours()) : nextMeal(occasions.length))
          }
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-3 text-[14px] font-semibold text-accent-contrast active:brightness-90"
        >
          <Plus size={16} />
          Add food
        </button>

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
          defaultName={`${MEAL_LABELS[savingMeal[0]!.meal]} · ${formatTimeOfDay(savingMeal[0]!.eatenAt)}`}
          onDismiss={() => setSavingMeal(null)}
        />
      )}
    </div>
  )
}

/**
 * One food, with its amount editable in place.
 *
 * Tapping expands rather than opening a sheet, because changing a portion is the overwhelmingly
 * common correction and a sheet costs two extra taps to do it. Everything rarer — the meal, the
 * time, the venue, deleting — is behind "More".
 */
function EntryRow({
  entry,
  name,
  isOpen,
  onToggle,
  onDetails,
}: {
  entry: LogEntry
  name: string
  isOpen: boolean
  onToggle: () => void
  onDetails: () => void
}) {
  const canResize = entry.foodId !== null
  const step = entry.grams >= 200 ? 25 : entry.grams >= 50 ? 10 : 5

  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'w-full px-3.5 py-2 text-left active:bg-sunken',
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
        <MacroSplitBar nutrients={entry.nutrients} className="mt-1.5" />
      </button>

      {isOpen && (
        <div className="flex items-center gap-2 border-t border-line px-3.5 py-2">
          {canResize ? (
            <>
              <Stepper
                label={name}
                grams={entry.grams}
                step={step}
                onChange={(grams) => void repo.updateEntryAmount(entry.id, grams)}
              />
              <span className="tabular min-w-0 flex-1 text-[11.5px] text-ink-muted">
                {entry.estimate ? 'estimated — check the amount' : `steps of ${step} g`}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 text-[11.5px] text-ink-muted">
              A quick add has no food behind it, so its amount can&rsquo;t be rescaled.
            </span>
          )}
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

function Stepper({
  label,
  grams,
  step,
  onChange,
}: {
  label: string
  grams: number
  step: number
  onChange: (grams: number) => void
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-page p-0.5">
      <button
        onClick={() => onChange(Math.max(1, Math.round(grams) - step))}
        aria-label={`Less ${label}`}
        className="flex size-7 items-center justify-center rounded-md text-ink-secondary active:bg-sunken"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={Math.round(grams)}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next) && next > 0) onChange(next)
        }}
        aria-label={`Grams of ${label}`}
        className="tabular w-12 bg-transparent text-center text-[13px] outline-none"
      />
      <button
        onClick={() => onChange(Math.round(grams) + step)}
        aria-label={`More ${label}`}
        className="flex size-7 items-center justify-center rounded-md text-ink-secondary active:bg-sunken"
      >
        <Plus size={14} />
      </button>
    </span>
  )
}

/** Where this sitting happened — shown when known, asked in one tap when not. */
function VenuePills({ entries }: { entries: readonly LogEntry[] }) {
  const current = entries.find((entry) => entry.venue !== null)?.venue ?? null
  const ids = entries.map((entry) => entry.id)

  if (current !== null) {
    const Icon = VENUE_ICONS[current]
    return (
      <button
        onClick={() => void repo.setVenue(ids, null)}
        aria-label={`Eaten ${VENUE_LABELS[current]} — tap to clear`}
        className="flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 py-1 text-[11px] text-ink-secondary active:opacity-60"
      >
        <Icon size={11} />
        {VENUE_LABELS[current]}
      </button>
    )
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {VENUES.map((venue) => {
        const Icon = VENUE_ICONS[venue]
        return (
          <button
            key={venue}
            onClick={() => void repo.setVenue(ids, venue)}
            aria-label={`Eaten ${VENUE_LABELS[venue].toLowerCase()}`}
            title={VENUE_LONG[venue]}
            className="flex size-7 items-center justify-center rounded-md text-ink-muted active:bg-sunken"
          >
            <Icon size={13} />
          </button>
        )
      })}
    </span>
  )
}

/** Adding to a past day with no meals yet: breakfast, then lunch, then dinner. */
const nextMeal = (existing: number): MealSlot =>
  existing === 0 ? 'breakfast' : existing === 1 ? 'lunch' : 'dinner'

/** Whether the day still matches its snapshot, on the fields the screen can change. */
function sameEntries(a: readonly LogEntry[], b: readonly LogEntry[]): boolean {
  if (a.length !== b.length) return false
  const key = (entry: LogEntry) =>
    `${entry.id}|${entry.grams}|${entry.meal}|${entry.eatenAt}|${entry.venue}`
  const left = a.map(key).sort()
  const right = b.map(key).sort()
  return left.every((value, index) => value === right[index])
}
