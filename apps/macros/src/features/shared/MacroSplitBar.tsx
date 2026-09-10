import { mgToGrams } from '@/lib/nutrition'
import type { Nutrients } from '@/domain/types'

/**
 * The protein/carb/fat split as one bar, with each macro's grams written inside its own segment.
 *
 * By *calories*, not grams: fat is 9 kcal a gram and carbs are 4, so a gram-width bar would show a
 * fatty meal as mostly carbohydrate and be quietly wrong about the only thing it's for. The number
 * inside each segment is in grams, because that is the unit people think in — so the widths answer
 * "what shape was this day" and the labels answer "how much".
 *
 * The label is dropped from any segment too narrow to hold it, rather than shrunk or allowed to spill.
 * Ink comes from `--macro-*-ink`, which exists because white does not clear AA on the yellow.
 */
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 }

/** Below this share, "24g" at 11px doesn't fit and the segment shows colour only. */
const LABEL_MIN_SHARE = 0.16

export function MacroSplitBar({
  nutrients,
  className = '',
}: {
  nutrients: Nutrients
  className?: string
}) {
  const parts = [
    { key: 'protein', grams: mgToGrams(nutrients.proteinMg), kcalPerG: KCAL_PER_G.protein },
    { key: 'carbs', grams: mgToGrams(nutrients.carbsMg), kcalPerG: KCAL_PER_G.carbs },
    { key: 'fat', grams: mgToGrams(nutrients.fatMg), kcalPerG: KCAL_PER_G.fat },
  ].map((part) => ({ ...part, kcal: part.grams * part.kcalPerG }))

  const total = parts.reduce((sum, part) => sum + part.kcal, 0)
  if (total <= 0) return null

  return (
    <span
      className={`flex h-[22px] overflow-hidden rounded-md bg-sunken ${className}`}
      role="img"
      aria-label={parts
        .map(
          (part) =>
            `${Math.round(part.grams)} g ${part.key}, ${Math.round((part.kcal / total) * 100)}% of the calories`,
        )
        .join('; ')}
    >
      {parts.map((part) => {
        const share = part.kcal / total
        return (
          <span
            key={part.key}
            className="flex items-center justify-center overflow-hidden"
            style={{ width: `${share * 100}%`, background: `var(--macro-${part.key})` }}
          >
            {share >= LABEL_MIN_SHARE && (
              <span
                className="tabular text-[11px] font-semibold leading-none"
                style={{ color: `var(--macro-${part.key}-ink)` }}
              >
                {Math.round(part.grams)}g
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
