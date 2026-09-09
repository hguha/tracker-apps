import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button, Card, Screen, useToast } from '@tracker-engine/ui'
import { Plus, Trash2 } from 'lucide-react'
import * as repo from '@/data/repository'
import { perServing } from '@/lib/nutrition'
import { grams } from '@/features/shared/format'
import { RecipeEditor } from './RecipeEditor'

/**
 * Recipes: a dish you cook, divided into servings.
 *
 * Distinct from a saved meal, which is "log these exact items again". A recipe has a yield, so a
 * batch cooked on Sunday can be logged a third at a time all week without re-entering anything.
 */
export function RecipesScreen({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const recipes = useLiveQuery(() => repo.recipes(), [], [])
  const [editing, setEditing] = useState<string | null>(null)

  if (editing !== null) {
    return (
      <RecipeEditor
        recipeId={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
      />
    )
  }

  return (
    <Screen title="Recipes" onBack={onBack}>
      <Button className="w-full" onClick={() => setEditing('new')}>
        <Plus size={16} />
        New recipe
      </Button>

      {(recipes ?? []).length === 0 ? (
        <Card className="p-4 text-[13.5px] text-ink-muted">
          Nothing yet. A recipe is worth it for anything you cook in a batch — enter the
          ingredients once, say how many servings it makes, then log a serving at a time.
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {(recipes ?? []).map((recipe) => {
              const serving = perServing(recipe)
              return (
                <li key={recipe.id} className="flex items-center gap-2">
                  <button
                    onClick={() => setEditing(recipe.id)}
                    className="min-w-0 flex-1 px-4 py-2.5 text-left active:bg-sunken"
                  >
                    <span className="block truncate text-[14px]">{recipe.name}</span>
                    <span className="tabular block text-[12px] text-ink-muted">
                      {recipe.servings} serving{recipe.servings === 1 ? '' : 's'} ·{' '}
                      {serving.kcal} kcal each · {grams(serving.proteinMg)}P{' '}
                      {grams(serving.carbsMg)}C {grams(serving.fatMg)}F
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      void repo.deleteRecipe(recipe.id).then(() => toast.show('Recipe deleted'))
                    }}
                    aria-label={`Delete ${recipe.name}`}
                    className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted active:bg-sunken"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </Screen>
  )
}
