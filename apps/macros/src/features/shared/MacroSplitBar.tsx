import { mgToGrams } from '@/lib/nutrition'
import type { Nutrients } from '@/domain/types'

/**
 * The protein/carb/fat split as one thin bar.
 *
 * Replaces "39gP 0gC 5gF" repeated down a screen of fifteen rows. That text is unreadable at the
 * size it has to render, it triples the width every row needs, and nobody reads the third one — the
 * question it answers is "roughly what shape is this", which a bar answers instantly and a row of
 * digits answers slowly.
 *
 * By *calories*, not grams: fat is 9 kcal a gram and carbs are 4, so a gram-width bar would show a
 * fatty meal as mostly carbohydrate and be quietly wrong about the only thing it's for.
 */
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 }

export function MacroSplitBar({
  nutrients,
  className = '',
}: {
  nutrients: Nutrients
  className?: string
}) {
  const protein = mgToGrams(nutrients.proteinMg) * KCAL_PER_G.protein
  const carbs = mgToGrams(nutrients.carbsMg) * KCAL_PER_G.carbs
  const fat = mgToGrams(nutrients.fatMg) * KCAL_PER_G.fat
  const total = protein + carbs + fat
  if (total <= 0) return null

  const pct = (value: number) => `${(value / total) * 100}%`

  return (
    <span
      className={`flex h-1 overflow-hidden rounded-full bg-sunken ${className}`}
      role="img"
      aria-label={`${Math.round((protein / total) * 100)}% protein, ${Math.round(
        (carbs / total) * 100,
      )}% carbs, ${Math.round((fat / total) * 100)}% fat by calories`}
    >
      <span style={{ width: pct(protein), background: 'var(--macro-protein)' }} />
      <span style={{ width: pct(carbs), background: 'var(--macro-carbs)' }} />
      <span style={{ width: pct(fat), background: 'var(--macro-fat)' }} />
    </span>
  )
}
