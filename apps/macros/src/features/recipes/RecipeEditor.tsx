import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, SearchField, useToast } from '@tracker-engine/ui'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
import { nutrientsFor, recipeNutrients, scale } from '@/lib/nutrition'
import { grams } from '@/features/shared/format'
import { estimateMeal } from '@/features/log/estimate'
import type { Food } from '@/domain/types'

interface Draft {
  foodId: string | null
  label: string
  grams: number
}

/**
 * Building or editing a recipe.
 *
 * Two ways in, because entering fifteen ingredients by hand is why nobody uses recipe features:
 * describe the dish and correct what comes back, or search ingredient by ingredient. Both end in
 * the same editable list, and every number is computed from matched food rows.
 */
export function RecipeEditor({
  recipeId,
  onBack,
}: {
  recipeId: string | null
  onBack: () => void
}) {
  const toast = useToast()
  const existing = useLiveQuery(
    () => (recipeId ? repo.getRecipe(recipeId) : Promise.resolve(undefined)),
    [recipeId],
    undefined,
  )

  const [name, setName] = useState('')
  const [servings, setServings] = useState('4')
  const [items, setItems] = useState<Draft[]>([])
  const [query, setQuery] = useState('')
  const [describe, setDescribe] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load once, when the row arrives; later edits are local until saved.
  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setServings(String(existing.servings))
    setItems(
      existing.ingredients.map((ingredient) => ({
        foodId: ingredient.foodId,
        label: ingredient.label,
        grams: ingredient.grams,
      })),
    )
  }, [existing?.id])

  const results = useLiveQuery(() => repo.searchFoods(query, 8), [query], [])
  useEffect(() => {
    if (query.trim().length < 3 || (results?.length ?? 0) >= 3) return
    const id = window.setTimeout(() => void searchRemote(query), 400)
    return () => clearTimeout(id)
  }, [query, results?.length])

  const foods = useLiveQuery(
    () => repo.foodsByIds(items.map((item) => item.foodId).filter(isPresent)),
    [items],
    new Map<string, Food>(),
  )

  const total = recipeNutrients(
    { ingredients: items.map((item, index) => ({ ...item, id: String(index), optional: false })) },
    foods ?? new Map(),
  )
  const each = scale(total, 1 / Math.max(1, Number(servings) || 1))

  async function fromDescription() {
    if (describe.trim().length < 3) return
    setIsBusy(true)
    setError(null)
    try {
      const estimate = await estimateMeal(describe)
      setItems([
        ...items,
        ...estimate.items.map((item) => ({
          foodId: item.food?.id ?? null,
          label: item.food?.description ?? item.query,
          grams: item.grams,
        })),
      ])
      if (!name.trim()) setName(describe.trim())
      setDescribe('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not work that out.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Screen title={recipeId ? 'Edit recipe' : 'New recipe'} onBack={onBack}>
      <Card className="space-y-3 p-4">
        <label className="block">
          <span className="text-[11px] text-ink-muted">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sunday chilli"
            className="mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-ink-muted">Makes this many servings</span>
          <input
            type="number"
            inputMode="numeric"
            value={servings}
            onChange={(event) => setServings(event.target.value)}
            className="tabular mt-0.5 w-full rounded-xl bg-sunken px-3 py-2 text-[15px] outline-none"
          />
        </label>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Describe it
        </h2>
        <textarea
          rows={2}
          value={describe}
          onChange={(event) => setDescribe(event.target.value)}
          placeholder="500g beef mince, two tins of tomatoes, kidney beans, onion, rice"
          className="w-full resize-none rounded-xl bg-sunken px-3 py-2.5 text-[15px] outline-none"
        />
        <Button
          variant="secondary"
          className="w-full"
          disabled={describe.trim().length < 3 || isBusy}
          onClick={() => void fromDescription()}
        >
          <Sparkles size={15} />
          {isBusy ? 'Working it out…' : 'Add these ingredients'}
        </Button>
        {error && (
          <p role="alert" className="text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </Card>

      <Card className="p-0">
        <h2 className="px-4 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          Ingredients
        </h2>
        {items.length === 0 ? (
          <p className="px-4 pb-3 text-[13px] text-ink-muted">Nothing added yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item, index) => (
              <li key={index} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">
                    {(item.foodId ? foods?.get(item.foodId)?.description : null) ?? item.label}
                  </span>
                  {item.foodId === null ? (
                    <span className="text-[11.5px]" style={{ color: 'var(--status-serious)' }}>
                      no match — not counted
                    </span>
                  ) : (
                    <span className="tabular text-[11.5px] text-ink-muted">
                      {Math.round(
                        nutrientsFor(foods!.get(item.foodId)!, item.grams).kcal,
                      )}{' '}
                      kcal
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={item.grams}
                  onChange={(event) =>
                    setItems(
                      items.map((draft, i) =>
                        i === index
                          ? { ...draft, grams: Math.max(0, Number(event.target.value) || 0) }
                          : draft,
                      ),
                    )
                  }
                  aria-label={`Grams of ${item.label}`}
                  className="tabular w-16 shrink-0 rounded-lg bg-sunken px-2 py-1.5 text-right text-[13.5px] outline-none"
                />
                <span className="text-[12px] text-ink-muted">g</span>
                <button
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                  aria-label={`Remove ${item.label}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-line px-4 py-3">
          <SearchField value={query} onChange={setQuery} placeholder="Add an ingredient" />
          {query.trim().length >= 2 && (
            <ul className="mt-2 divide-y divide-line">
              {(results ?? []).map((food) => (
                <li key={food.id}>
                  <button
                    onClick={() => {
                      setItems([
                        ...items,
                        { foodId: food.id, label: food.description, grams: 100 },
                      ])
                      setQuery('')
                    }}
                    className="flex w-full items-center gap-2 py-2 text-left active:opacity-60"
                  >
                    <Plus size={14} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {food.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <p className="tabular text-[13.5px] font-semibold">
          {total.kcal} kcal total · {each.kcal} kcal per serving
        </p>
        <p className="tabular mt-0.5 text-[12.5px] text-ink-muted">
          Per serving: {grams(each.proteinMg)}P {grams(each.carbsMg)}C {grams(each.fatMg)}F
        </p>
        <Button
          className="mt-3 w-full"
          disabled={items.length === 0 || name.trim().length === 0 || isSaving}
          onClick={() => {
            if (isSaving) return
            setIsSaving(true)
            void repo
              .saveRecipe(
                {
                  name,
                  servings: Number(servings) || 1,
                  ingredients: items,
                },
                recipeId ?? undefined,
              )
              .then(() => {
                toast.show(recipeId ? 'Recipe updated' : 'Recipe saved')
                onBack()
              })
              .finally(() => setIsSaving(false))
          }}
        >
          {isSaving ? 'Saving…' : recipeId ? 'Save changes' : 'Save recipe'}
        </Button>
      </Card>
    </Screen>
  )
}

const isPresent = (value: string | null): value is string => value !== null
