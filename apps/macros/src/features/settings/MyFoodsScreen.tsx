import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'
import { ManagedList } from '@/features/shared/ManagedList'

/** The foods the user entered themselves. Reviewing and removing only — creating happens where
 *  the need arises, on the Add food screen. */
export function MyFoodsScreen({ onBack }: { onBack: () => void }) {
  const foods = useLiveQuery(() => repo.customFoods(), [], [])

  return (
    <ManagedList
      title="Your foods"
      onBack={onBack}
      onDelete={repo.deleteCustomFood}
      items={(foods ?? []).map((food) => ({
        id: food.id,
        title: food.description,
        subtitle:
          `${food.brand ? `${food.brand} · ` : ''}${food.per100.kcal} kcal / 100g · ` +
          `${grams(food.per100.proteinMg)}P ${grams(food.per100.carbsMg)}C ` +
          `${grams(food.per100.fatMg)}F`,
      }))}
      empty={
        <>
          Nothing yet. When a search or a barcode comes up empty, &ldquo;add it from the
          label&rdquo; puts the food here — searchable, synced, and reusable, unlike a quick add.
        </>
      }
      footnote={
        <>
          Deleting a food leaves what you already logged alone — entries keep the nutrients they
          were logged with.
        </>
      }
    />
  )
}
