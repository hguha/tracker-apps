import { useLiveQuery } from 'dexie-react-hooks'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'
import { ManagedList } from '@/features/shared/ManagedList'

/** Managing saved meals. Logging them happens on the Add food screen; this is where they're
 *  reviewed and removed, so that screen doesn't need a delete affordance next to a log one. */
export function SavedMealsScreen({ onBack }: { onBack: () => void }) {
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])

  return (
    <ManagedList
      title="Saved meals"
      onBack={onBack}
      onDelete={repo.deleteMealTemplate}
      items={(templates ?? []).map((template) => ({
        id: template.id,
        title: template.name,
        subtitle:
          `${template.items.length} item${template.items.length === 1 ? '' : 's'} · ` +
          `${template.nutrients.kcal} kcal · ${grams(template.nutrients.proteinMg)}P ` +
          `${grams(template.nutrients.carbsMg)}C ${grams(template.nutrients.fatMg)}F`,
      }))}
      empty={
        <>
          Nothing saved yet. On Today, tap the bookmark beside any meal you&rsquo;ve eaten and it
          becomes one tap to log again — at half or double the amount, for a batch cook.
        </>
      }
    />
  )
}
