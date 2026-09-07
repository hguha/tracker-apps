import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatRelativeDay } from '@tracker-engine/core'
import { Card, useToast } from '@tracker-engine/ui'
import { ChevronLeft, Plus, ScanLine, Sparkles, Trash2 } from 'lucide-react'
import { isBarcodeScanningAvailable } from '@/platform/barcode'
import { searchRemote } from '@/data/foodLookup'
import * as repo from '@/data/repository'
import { dayTotals, remaining } from '@/lib/nutrition'
import { suggestFoods } from '@/lib/suggest'
import { grams } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import type { Food, MealSlot, MealTemplate } from '@/domain/types'
import { DescribePanel } from './DescribePanel'
import { MealTimePicker } from './MealTimePicker'
import { PortionPanel } from './PortionPanel'
import { QuickAddPanel } from './QuickAddPanel'
import { ScanPanel } from './ScanPanel'

type Panel =
  | { kind: 'browse' }
  | { kind: 'portion'; food: Food }
  | { kind: 'describe' }
  | { kind: 'scan' }
  | { kind: 'quick' }

/**
 * Adding food, as a screen rather than a sheet.
 *
 * One input, not a mode switch: the same text either matches foods or gets broken down as a
 * meal, because a person typing "turkey sandwich and an apple" has no way of knowing in advance
 * which of those the app can do. Everything else on the screen exists to avoid typing at all —
 * the meals you already eat, ranked ahead of a search box that assumes you don't.
 */
export function LogScreen({
  meal: initialMeal,
  onClose,
}: {
  meal: MealSlot
  onClose: () => void
}) {
  const [meal, setMeal] = useState<MealSlot>(initialMeal)
  const [at, setAt] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<Panel>({ kind: 'browse' })

  const back = () => setPanel({ kind: 'browse' })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-2 py-2 pt-safe">
        <button
          onClick={() => (panel.kind === 'browse' ? onClose() : back())}
          aria-label="Back"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-secondary active:bg-sunken"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="flex-1 text-[16px] font-semibold tracking-tight">
          {panel.kind === 'browse' ? `Add to ${MEAL_LABELS[meal].toLowerCase()}` : 'Add food'}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto pb-8">
        {panel.kind === 'browse' && (
          <BrowsePanel
            meal={meal}
            at={at}
            query={query}
            onQuery={setQuery}
            onMeal={setMeal}
            onAt={setAt}
            onSelect={(food) => setPanel({ kind: 'portion', food })}
            onPanel={(kind) => setPanel({ kind } as Panel)}
            onDone={onClose}
          />
        )}
        {panel.kind === 'portion' && (
          <PortionPanel food={panel.food} meal={meal} at={at} onDone={onClose} />
        )}
        {panel.kind === 'describe' && (
          <DescribePanel meal={meal} at={at} initialText={query} onDone={onClose} />
        )}
        {panel.kind === 'quick' && <QuickAddPanel meal={meal} at={at} onDone={onClose} />}
        {panel.kind === 'scan' && (
          <ScanPanel onFound={(food) => setPanel({ kind: 'portion', food })} />
        )}
      </div>
    </div>
  )
}

function BrowsePanel({
  meal,
  at,
  query,
  onQuery,
  onMeal,
  onAt,
  onSelect,
  onPanel,
  onDone,
}: {
  meal: MealSlot
  at: number
  query: string
  onQuery: (query: string) => void
  onMeal: (meal: MealSlot) => void
  onAt: (at: number) => void
  onSelect: (food: Food) => void
  onPanel: (kind: 'describe' | 'scan' | 'quick') => void
  onDone: () => void
}) {
  const toast = useToast()
  const trimmed = query.trim()
  const isSearching = trimmed.length >= 2

  const results = useLiveQuery(() => repo.searchFoods(query), [query], [])
  const frequentIds = useLiveQuery(() => repo.frequentFoodIds(24), [], [])
  const frequents = useLiveQuery(
    async () => [...(await repo.foodsByIds(frequentIds ?? [])).values()],
    [frequentIds],
    [],
  )
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])
  const recents = useLiveQuery(() => repo.recentMeals(), [], [])
  const targets = useLiveQuery(() => repo.currentTargets(), [], null)
  const todayEntries = useLiveQuery(() => repo.entriesForDay(dayKey(Date.now())), [], [])

  // Local first, always: only reach for the long tail when the cache comes up thin, and never
  // block on it, so results already on screen can't vanish while a fetch is in flight.
  useEffect(() => {
    if (trimmed.length < 3 || (results?.length ?? 0) >= 5) return
    const id = window.setTimeout(() => void searchRemote(trimmed), 400)
    return () => clearTimeout(id)
  }, [trimmed, results?.length])

  const left = targets ? remaining(dayTotals(todayEntries ?? []), targets) : null
  const suggestions = useMemo(
    () => (left ? suggestFoods(left, frequents ?? []) : []),
    [left, frequents],
  )

  const canScan = isBarcodeScanningAvailable()
  // Worth offering a breakdown whenever the text names more than one thing — which is exactly
  // when the search box is least likely to have a single row that means it.
  const looksComposed = trimmed.split(/\s+/).length >= 2

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="p-3">
        <MealTimePicker meal={meal} at={at} onMeal={onMeal} onAt={onAt} />
      </Card>

      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search a food, or describe a meal"
          className="min-w-0 flex-1 rounded-xl bg-sunken px-3.5 py-2.5 text-[15px] outline-none"
        />
        {canScan && (
          <button
            onClick={() => onPanel('scan')}
            aria-label="Scan a barcode"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
          >
            <ScanLine size={20} />
          </button>
        )}
      </div>

      {isSearching && looksComposed && (
        <button
          onClick={() => onPanel('describe')}
          className="flex w-full items-center gap-2 rounded-2xl bg-accent-wash px-3.5 py-3 text-left active:opacity-70"
        >
          <Sparkles size={16} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-accent">
              Break down “{trimmed}”
            </span>
            <span className="block text-[12px] text-ink-muted">
              Into real foods you can correct, with the macros added up
            </span>
          </span>
        </button>
      )}

      {isSearching ? (
        <FoodList foods={results ?? []} onSelect={onSelect} emptyLabel="Nothing matched." />
      ) : (
        <>
          {suggestions.length > 0 && (
            <Section title="Fits what's left" hint={left ? `${left.kcal} kcal to go` : undefined}>
              <ul className="divide-y divide-line">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.food.id}>
                    <button
                      onClick={() => onSelect(suggestion.food)}
                      className="w-full px-4 py-2.5 text-left active:bg-sunken"
                    >
                      <div className="truncate text-[14px]">{suggestion.food.description}</div>
                      <div className="tabular text-[12px] text-ink-muted">{suggestion.why}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(templates ?? []).length > 0 && (
            <Section title="Saved meals">
              <ul className="divide-y divide-line">
                {(templates ?? []).map((template) => (
                  <SavedMealRow
                    key={template.id}
                    template={template}
                    onLog={() => {
                      void repo.logMealTemplate(template, meal, at).then((count) => {
                        toast.show(`Logged ${count} item${count === 1 ? '' : 's'}`)
                        onDone()
                      })
                    }}
                  />
                ))}
              </ul>
            </Section>
          )}

          {(recents ?? []).length > 0 && (
            <Section title="Eat again" hint="From the last two weeks">
              <ul className="divide-y divide-line">
                {(recents ?? []).map((recent) => (
                  <li key={`${recent.day}|${recent.meal}`}>
                    <button
                      onClick={() => {
                        void repo
                          .relogEntries(recent.entries, { meal, at })
                          .then((count) => {
                            toast.show(`Logged ${count} item${count === 1 ? '' : 's'}`)
                            onDone()
                          })
                      }}
                      className="w-full px-4 py-2.5 text-left active:bg-sunken"
                    >
                      <div className="truncate text-[14px]">
                        {MEAL_LABELS[recent.meal]} ·{' '}
                        <span className="text-ink-muted">
                          {formatRelativeDay(Date.parse(`${recent.day}T12:00:00`))}
                        </span>
                      </div>
                      <div className="tabular text-[12px] text-ink-muted">
                        {recent.nutrients.kcal} kcal ·{' '}
                        {recent.entries.length} item{recent.entries.length === 1 ? '' : 's'} ·{' '}
                        {recent.entries
                          .map((entry) => entry.note || '')
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(', ')}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(frequents ?? []).length > 0 && (
            <Section title="Foods you log often">
              <FoodList foods={frequents ?? []} onSelect={onSelect} emptyLabel="" bare />
            </Section>
          )}
        </>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onPanel('describe')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
        >
          <Sparkles size={15} />
          Describe a meal
        </button>
        <button
          onClick={() => onPanel('quick')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
        >
          <Plus size={15} />
          Quick add
        </button>
      </div>
    </div>
  )
}

function SavedMealRow({
  template,
  onLog,
}: {
  template: MealTemplate
  onLog: () => void
}) {
  return (
    <li className="flex items-center">
      <button onClick={onLog} className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken">
        <div className="truncate text-[14px]">{template.name}</div>
        <div className="tabular text-[12px] text-ink-muted">
          {template.nutrients.kcal} kcal · {grams(template.nutrients.proteinMg)}P{' '}
          {grams(template.nutrients.carbsMg)}C {grams(template.nutrients.fatMg)}F
        </div>
      </button>
      <button
        onClick={() => void repo.deleteMealTemplate(template.id)}
        aria-label={`Delete ${template.name}`}
        className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
      >
        <Trash2 size={15} />
      </button>
    </li>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Card className="p-0">
      <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          {title}
        </h2>
        {hint && <span className="tabular text-[12px] text-ink-muted">{hint}</span>}
      </div>
      {children}
    </Card>
  )
}

function FoodList({
  foods,
  onSelect,
  emptyLabel,
  bare = false,
}: {
  foods: readonly Food[]
  onSelect: (food: Food) => void
  emptyLabel: string
  bare?: boolean
}) {
  const list = (
    <ul className="divide-y divide-line">
      {foods.map((food) => (
        <li key={food.id}>
          <button
            onClick={() => onSelect(food)}
            className="w-full px-4 py-2.5 text-left active:bg-sunken"
          >
            <div className="truncate text-[14px]">{food.description}</div>
            <div className="tabular text-[12px] text-ink-muted">
              {food.brand ? `${food.brand} · ` : ''}
              {food.per100.kcal} kcal / 100g
            </div>
          </button>
        </li>
      ))}
    </ul>
  )

  if (bare) return list
  return (
    <Card className="p-0">
      {foods.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">{emptyLabel}</p>
      ) : (
        list
      )}
    </Card>
  )
}
