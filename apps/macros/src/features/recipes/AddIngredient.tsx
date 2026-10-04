import { ChefHat, Sparkles } from 'lucide-react'
import { perServing } from '@/lib/nutrition'
import { queryTerms } from '@/lib/foodSearch'
import { FoodSearchPicker } from '@/features/shared/FoodSearchPicker'
import type { Food, Recipe } from '@/domain/types'

export function AddIngredient({
  recipes,
  isFirst,
  isAsking,
  autoFocus,
  onFood,
  onRecipe,
  onAsk,
}: {
  recipes: readonly Recipe[]
  isFirst: boolean
  isAsking: boolean
  autoFocus: boolean
  onFood: (food: Food) => void
  onRecipe: (recipe: Recipe) => void
  onAsk: (text: string) => void
}) {
  return (
    <FoodSearchPicker
      placeholder={isFirst ? 'Describe it, or search a food' : 'Add more'}
      branded={false}
      autoFocus={autoFocus}
      onPick={onFood}
      lead={(query, clear) => {
        const terms = queryTerms(query)
        const hits = recipes
          .filter((recipe) => terms.every((term) => recipe.name.toLowerCase().includes(term)))
          .slice(0, 3)
        return (
          <div className="mt-1.5 space-y-0.5">
            {query.length >= 3 && (
              <button
                disabled={isAsking}
                onClick={() => {
                  onAsk(query)
                  clear()
                }}
                className="flex w-full items-center gap-2 rounded-xl bg-accent-wash px-3 py-2.5 text-left disabled:opacity-50 active:opacity-70"
              >
                <Sparkles size={15} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-accent">
                  Ask AI: “{query}”
                </span>
              </button>
            )}
            {hits.map((recipe) => (
              <button
                key={recipe.id}
                onClick={() => {
                  onRecipe(recipe)
                  clear()
                }}
                className="flex w-full items-center gap-2 py-1.5 text-left active:opacity-60"
              >
                <ChefHat size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {recipe.name}
                  <span className="text-ink-muted"> · 1 serving · {perServing(recipe).kcal} kcal</span>
                </span>
              </button>
            ))}
          </div>
        )
      }}
    />
  )
}
