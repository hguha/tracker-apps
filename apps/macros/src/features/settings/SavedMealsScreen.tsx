import { useLiveQuery } from 'dexie-react-hooks'
import { Card, Screen, useToast } from '@tracker-engine/ui'
import { Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { grams } from '@/features/shared/format'

/** Managing saved meals. Logging them happens on the Add food screen; this is where they're
 *  reviewed and removed, so that screen doesn't need a delete affordance next to a log one. */
export function SavedMealsScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const templates = useLiveQuery(() => repo.mealTemplates(), [], [])

  return (
    <Screen title="Saved meals" onBack={onBack}>
      {(templates ?? []).length === 0 ? (
        <Card className="p-4 text-[13.5px] text-ink-muted">
          Nothing saved yet. On Today, tap the bookmark beside any meal you&rsquo;ve eaten and it
          becomes one tap to log again — at half or double the amount, for a batch cook.
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {(templates ?? []).map((template) => (
              <li key={template.id} className="flex items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{template.name}</span>
                  <span className="tabular block text-[12px] text-ink-muted">
                    {template.items.length} item{template.items.length === 1 ? '' : 's'} ·{' '}
                    {template.nutrients.kcal} kcal · {grams(template.nutrients.proteinMg)}P{' '}
                    {grams(template.nutrients.carbsMg)}C {grams(template.nutrients.fatMg)}F
                  </span>
                </span>
                <button
                  onClick={() => {
                    void repo
                      .deleteMealTemplate(template.id)
                      .then(() => toast.show(`Deleted ${template.name}`))
                  }}
                  aria-label={`Delete ${template.name}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  )
}
