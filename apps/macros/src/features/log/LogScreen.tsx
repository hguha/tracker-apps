import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { dayKey, formatRelativeDay } from '@tracker-engine/core'
import {
  Card,
  ScreenHeader,
  SearchField,
  SegmentedTabs,
  type SegmentedTab,
} from '@tracker-engine/ui'
import { Camera, Plus, ScanLine, Sparkles } from 'lucide-react'
import { isBarcodeScanningAvailable } from '@/platform/barcode'
import { searchRemote } from '@/data/foodLookup'
import * as repo from '@/data/repository'
import { dayTotals, remaining } from '@/lib/nutrition'
import { suggestFoods } from '@/lib/suggest'
import { portionLabel } from '@/features/shared/format'
import { MEAL_LABELS } from '@/features/shared/meals'
import type { Food, MealSlot } from '@/domain/types'
import { DescribePanel } from './DescribePanel'
import { MealPreviewSheet, type MealPreview } from './MealPreviewSheet'
import { MealTimePicker } from './MealTimePicker'
import { PhotoPanel } from './PhotoPanel'
import { PortionPanel } from './PortionPanel'
import { QuickAddPanel } from './QuickAddPanel'
import { ScanPanel } from './ScanPanel'

type Panel =
  | { kind: 'browse' }
  | { kind: 'portion'; food: Food }
  | { kind: 'describe' }
  | { kind: 'scan' }
  | { kind: 'photo' }
  | { kind: 'quick' }

type BrowseTab = 'suggested' | 'again' | 'often' | 'saved'

/**
 * Adding food, as a screen rather than a sheet.
 *
 * One input, not a mode switch: the same text either matches foods or gets broken down as a
 * meal, because a person typing "turkey sandwich and an apple" has no way of knowing in advance
 * which of those the app can do. Everything else exists to avoid typing at all — the meals you
 * already eat, in tabs, so a long list of frequents doesn't bury the rest.
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

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={panel.kind === 'browse' ? `Add to ${MEAL_LABELS[meal].toLowerCase()}` : 'Add food'}
        onBack={() => (panel.kind === 'browse' ? onClose() : setPanel({ kind: 'browse' }))}
      />

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
            onPanel={setPanel}
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
        {panel.kind === 'photo' && <PhotoPanel meal={meal} at={at} onDone={onClose} />}
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
  onPanel: (panel: Panel) => void
  onDone: () => void
}) {
  const trimmed = query.trim()
  const isSearching = trimmed.length >= 2
  const [tab, setTab] = useState<BrowseTab>('suggested')
  const [preview, setPreview] = useState<MealPreview | null>(null)

  const results = useLiveQuery(() => repo.searchFoods(query), [query], [])
  const frequentIds = useLiveQuery(() => repo.frequentFoodIds(40), [], [])
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
  // Worth offering a breakdown when the text names more than one thing. It leads only when the
  // search came up thin: a query with real matches is answered by those matches.
  const looksComposed = trimmed.split(/\s+/).length >= 2
  const describeRow =
    isSearching && looksComposed ? (
      <DescribeRow text={trimmed} onOpen={() => onPanel({ kind: 'describe' })} />
    ) : null
  const describeLeads = (results?.length ?? 0) < 3

  const tabs: SegmentedTab<BrowseTab>[] = [
    { key: 'suggested', label: 'Suggested' },
    { key: 'again', label: 'Eat again', badge: (recents ?? []).length || undefined },
    { key: 'often', label: 'Frequent', badge: (frequents ?? []).length || undefined },
    { key: 'saved', label: 'Saved', badge: (templates ?? []).length || undefined },
  ]

  return (
    <div className="space-y-3 px-3 py-3">
      <Card className="p-3">
        <MealTimePicker meal={meal} at={at} onMeal={onMeal} onAt={onAt} />
      </Card>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            autoFocus
            value={query}
            onChange={onQuery}
            placeholder="Search a food, or describe a meal"
          />
        </div>
        {canScan && (
          <button
            onClick={() => onPanel({ kind: 'scan' })}
            aria-label="Scan a barcode"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
          >
            <ScanLine size={20} />
          </button>
        )}
        <button
          onClick={() => onPanel({ kind: 'photo' })}
          aria-label="Log from a photo"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
        >
          <Camera size={20} />
        </button>
        <button
          onClick={() => onPanel({ kind: 'quick' })}
          aria-label="Quick add macros"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sunken text-ink-secondary active:opacity-60"
        >
          <Plus size={20} />
        </button>
      </div>

      {isSearching ? (
        <>
          {describeLeads && describeRow}
          <FoodList foods={results ?? []} onSelect={onSelect} emptyLabel="Nothing matched." />
          {!describeLeads && describeRow}
        </>
      ) : (
        <>
          <SegmentedTabs tabs={tabs} active={tab} onSelect={setTab} />

          {tab === 'suggested' &&
            (suggestions.length === 0 ? (
              <Empty>
                {left === null
                  ? 'Suggestions need a calorie target — add your height, age and sex in Settings.'
                  : `Only ${left.kcal} kcal left, which isn't enough to build a suggestion around.`}
              </Empty>
            ) : (
              <Card className="p-0">
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
              </Card>
            ))}

          {tab === 'again' &&
            ((recents ?? []).length === 0 ? (
              <Empty>Meals you log will show up here to repeat.</Empty>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {(recents ?? []).map((recent) => (
                    <li key={`${recent.day}|${recent.meal}`}>
                      <button
                        onClick={() =>
                          setPreview({
                            title: `${MEAL_LABELS[recent.meal]} · ${formatRelativeDay(
                              Date.parse(`${recent.day}T12:00:00`),
                            )}`,
                            subtitle: `${recent.entries.length} item${
                              recent.entries.length === 1 ? '' : 's'
                            } · ${recent.nutrients.kcal} kcal`,
                            items: recent.entries.map((entry) => ({
                              foodId: entry.foodId,
                              label: entry.note || 'Quick add',
                              grams: entry.grams,
                              nutrients: entry.nutrients,
                            })),
                            nutrients: recent.nutrients,
                            log: (multiple) =>
                              repo.relogEntries(recent.entries, { meal, at, multiple }),
                          })
                        }
                        className="w-full px-4 py-2.5 text-left active:bg-sunken"
                      >
                        <div className="truncate text-[14px]">
                          {MEAL_LABELS[recent.meal]}{' '}
                          <span className="text-ink-muted">
                            · {formatRelativeDay(Date.parse(`${recent.day}T12:00:00`))}
                          </span>
                        </div>
                        <div className="tabular text-[12px] text-ink-muted">
                          {recent.nutrients.kcal} kcal · {recent.entries.length} item
                          {recent.entries.length === 1 ? '' : 's'}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

          {tab === 'often' &&
            ((frequents ?? []).length === 0 ? (
              <Empty>Foods you log more than once collect here.</Empty>
            ) : (
              <FoodList foods={frequents ?? []} onSelect={onSelect} emptyLabel="" />
            ))}

          {tab === 'saved' &&
            ((templates ?? []).length === 0 ? (
              <Empty>
                Tap the bookmark next to a meal on Today to save it — then it&rsquo;s one tap
                here, at any multiple.
              </Empty>
            ) : (
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {(templates ?? []).map((template) => (
                    <li key={template.id}>
                      <button
                        onClick={() =>
                          setPreview({
                            title: template.name,
                            subtitle: `${template.items.length} item${
                              template.items.length === 1 ? '' : 's'
                            } · ${template.nutrients.kcal} kcal`,
                            items: template.items.map((item) => ({
                              foodId: item.foodId,
                              label: template.name,
                              grams: item.grams,
                              nutrients: item.nutrients,
                            })),
                            nutrients: template.nutrients,
                            log: (multiple) => repo.logMealTemplate(template, meal, at, multiple),
                          })
                        }
                        className="w-full px-4 py-2.5 text-left active:bg-sunken"
                      >
                        <div className="truncate text-[14px]">{template.name}</div>
                        <div className="tabular text-[12px] text-ink-muted">
                          {template.nutrients.kcal} kcal · {template.items.length} item
                          {template.items.length === 1 ? '' : 's'}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

          <button
            onClick={() => onPanel({ kind: 'describe' })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sunken py-2.5 text-[13.5px] font-semibold text-accent active:opacity-60"
          >
            <Sparkles size={15} />
            Describe a meal instead
          </button>
        </>
      )}

      {preview && (
        <MealPreviewSheet
          preview={preview}
          meal={meal}
          onDismiss={() => setPreview(null)}
          onLogged={onDone}
        />
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="p-4 text-center text-[13px] text-ink-muted">{children}</Card>
}

/** The escape hatch from search: let a sentence be broken into foods. */
function DescribeRow({ text, onOpen }: { text: string; onOpen: () => void }) {
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
          Into real foods you can correct, with the macros added up
        </span>
      </span>
    </button>
  )
}

function FoodList({
  foods,
  onSelect,
  emptyLabel,
}: {
  foods: readonly Food[]
  onSelect: (food: Food) => void
  emptyLabel: string
}) {
  return (
    <Card className="p-0">
      {foods.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13.5px] text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-line">
          {foods.map((food) => (
            <li key={food.id}>
              <button
                onClick={() => onSelect(food)}
                className="w-full px-4 py-2.5 text-left active:bg-sunken"
              >
                <div className="truncate text-[14px]">{food.description}</div>
                <div className="tabular truncate text-[12px] text-ink-muted">
                  {food.brand ? `${food.brand} · ` : ''}
                  {food.per100.kcal} kcal / 100g
                  {food.portions.length > 0 && ` · ${portionLabel(food.portions[0]!)}`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
