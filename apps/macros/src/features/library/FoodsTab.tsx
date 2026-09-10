import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, SearchField, useToast } from '@tracker-engine/ui'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { cn } from '@/lib/cn'
import { grams } from '@/features/shared/format'
import { formatAmount, nutrientTargets } from '@/lib/micronutrients'
import { useFoodSearch } from '@/features/shared/useFoodSearch'
import { MacroSplitBar } from '@/features/shared/MacroSplitBar'
import type { Food } from '@/domain/types'

/**
 * Every ingredient the app knows about, searchable, with what's actually in it.
 *
 * This tab used to list only the handful of foods the user had typed in from a label — which is a
 * fraction of a percent of what they'd logged, and never the thing they wanted to look up. There was
 * no way anywhere in the app to ask "how much potassium is in a banana", despite the answer being on
 * the device: every food ever searched or broken out of a dish is cached locally.
 *
 * Your own foods still lead when nothing is typed, because that list is short, yours, and the only
 * one with anything to prune.
 */
export function FoodsTab({ onAdd }: { onAdd: () => void }) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const { results, isSearching } = useFoodSearch(query, { branded: true })
  const own = useLiveQuery(() => repo.customFoods(), [], undefined)
  const [open, setOpen] = useState<string | null>(null)

  const isBrowsing = trimmed.length < 2
  const shown: Food[] = isBrowsing ? (own ?? []) : results

  return (
    <>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Any food — see its macros and micronutrients"
      />

      {isBrowsing && (
        <>
          <p className="px-1 text-[12.5px] text-ink-muted">
            Search above for anything you&rsquo;ve logged or looked up. Below are the foods{' '}
            <span className="font-semibold">you</span> added from a label, for something the
            databases don&rsquo;t have.
          </p>
          {/* Addable from here, not only from the moment a search fails — which was the only way in
              and meant you couldn't set one up in advance. */}
          <Button variant="secondary" className="w-full" onClick={onAdd}>
            <Plus size={15} />
            Add a food from its label
          </Button>
        </>
      )}

      {shown.length === 0 ? (
        <Card className="p-4 text-center text-[13.5px] text-ink-muted">
          {isBrowsing
            ? 'Nothing added yet.'
            : isSearching
              ? 'Searching…'
              : 'Nothing matched. Foods arrive here as you log them.'}
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {shown.map((food) => (
              <FoodRow
                key={food.id}
                food={food}
                isOpen={open === food.id}
                onToggle={() => setOpen((current) => (current === food.id ? null : food.id))}
              />
            ))}
          </ul>
        </Card>
      )}

      {isBrowsing && (own ?? []).length > 0 && (
        <p className="px-1 text-[12px] text-ink-muted">
          Deleting a food leaves what you already logged alone — entries keep the nutrients they were
          logged with.
        </p>
      )}
    </>
  )
}

/**
 * One food, opening onto everything known about it per 100 g.
 *
 * Per 100 g rather than per portion, and stated as such: it's the only basis every row shares, so two
 * foods can be compared without doing arithmetic on two different serving sizes. A nutrient the
 * source never recorded shows as "—", never as zero — an unmeasured micronutrient is not an absence,
 * and rounding it to nothing is how a day quietly loses its fibre.
 */
function FoodRow({
  food,
  isOpen,
  onToggle,
}: {
  food: Food
  isOpen: boolean
  onToggle: () => void
}) {
  const toast = useToast()
  const profile = useLiveQuery(() => repo.getProfile(), [], undefined)
  const targets = nutrientTargets(profile?.sex ?? null)

  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left active:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{food.description}</span>
          <span className="tabular block truncate text-[12px] text-ink-muted">
            {food.brand ? `${food.brand} · ` : ''}
            {food.per100.kcal} kcal / 100 g · {grams(food.per100.proteinMg)}P{' '}
            {grams(food.per100.carbsMg)}C {grams(food.per100.fatMg)}F
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="border-t border-line px-4 py-3">
          <p className="text-[11px] text-ink-muted">Per 100 g</p>
          <MacroSplitBar nutrients={food.per100} className="mt-1" />

          <dl className="mt-2.5 grid grid-cols-2 gap-x-4">
            {targets.map((target) => (
              <div
                key={target.key}
                className="flex items-baseline justify-between border-b border-line py-1"
              >
                <dt className="text-[12.5px] text-ink-secondary">{target.label}</dt>
                <dd
                  className={cn(
                    'tabular text-[12.5px]',
                    food.per100[target.key] === null && 'text-ink-muted',
                  )}
                >
                  {formatAmount({ key: target.key, amount: food.per100[target.key] })}
                </dd>
              </div>
            ))}
          </dl>

          {food.portions.length > 0 && (
            <p className="mt-2 text-[12px] text-ink-muted">
              Portions: {food.portions.map((portion) => portion.label).join(' · ')}
            </p>
          )}

          {/* Only the user's own rows can be deleted. A USDA row is shared reference data — removing
              it locally would just make the next search fetch it again. */}
          {food.source === 'custom' && (
            <button
              onClick={() => {
                void repo.deleteCustomFood(food.id).then(() => toast.show(`Deleted ${food.description}`))
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-[13px] font-semibold active:bg-sunken"
              style={{ color: 'var(--status-critical)' }}
            >
              <Trash2 size={14} />
              Delete this food
            </button>
          )}
        </div>
      )}
    </li>
  )
}
