import { useLiveQuery } from 'dexie-react-hooks'
import { Card, Screen, useToast } from '@tracker-engine/ui'
import { Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'

/** The foods the user entered themselves. Reviewing and removing only — creating happens where
 *  the need arises, on the Add food screen. */
export function MyFoodsScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const foods = useLiveQuery(() => repo.customFoods(), [], [])

  return (
    <Screen title="Your foods" onBack={onBack}>
      {(foods ?? []).length === 0 ? (
        <Card className="p-4 text-[13.5px] text-ink-muted">
          Nothing yet. When a search or a barcode comes up empty, &ldquo;add it from the
          label&rdquo; puts the food here — searchable, synced, and reusable, unlike a quick add.
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {(foods ?? []).map((food) => (
              <li key={food.id} className="flex items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{food.description}</span>
                  <span className="tabular block text-[12px] text-ink-muted">
                    {food.brand ? `${food.brand} · ` : ''}
                    {food.per100.kcal} kcal / 100g · {grams(food.per100.proteinMg)}P{' '}
                    {grams(food.per100.carbsMg)}C {grams(food.per100.fatMg)}F
                  </span>
                </span>
                <button
                  onClick={() => {
                    void repo
                      .deleteCustomFood(food.id)
                      .then(() => toast.show(`Deleted ${food.description}`))
                  }}
                  aria-label={`Delete ${food.description}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-muted">
            Deleting a food leaves what you already logged alone — entries keep the nutrients they
            were logged with.
          </p>
        </Card>
      )}
    </Screen>
  )
}
