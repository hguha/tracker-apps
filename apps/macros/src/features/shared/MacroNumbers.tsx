import { mgToGrams } from '@/lib/nutrition'
import type { Nutrients } from '@/domain/types'

/**
 * One row's macros, as three coloured numbers.
 *
 * Rows used to carry a `MacroSplitBar` — a hairline showing the protein/carb/fat *proportions*. That
 * answers "roughly what shape is this", which is not what anyone opens a day to find out: they want
 * to know how much protein was in the chicken, and a bar cannot say. The colours do the identifying
 * so the letters don't have to, and the numbers are the point.
 *
 * The same three hues as every bar and chart, from `--macro-*`, which is why a colour can be trusted
 * to mean one macro everywhere.
 */
export function MacroNumbers({
  nutrients,
  className = '',
}: {
  nutrients: Nutrients
  className?: string
}) {
  const g = (mg: number) => Math.round(mgToGrams(mg))

  return (
    <span className={`tabular flex shrink-0 items-baseline gap-2 text-[11.5px] ${className}`}>
      <Value grams={g(nutrients.proteinMg)} color="var(--macro-protein)" letter="P" />
      <Value grams={g(nutrients.carbsMg)} color="var(--macro-carbs)" letter="C" />
      <Value grams={g(nutrients.fatMg)} color="var(--macro-fat)" letter="F" />
    </span>
  )
}

function Value({ grams, color, letter }: { grams: number; color: string; letter: string }) {
  return (
    <span className="flex items-baseline gap-[3px]">
      <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-ink-secondary">
        {grams}
        <span className="text-ink-muted">{letter}</span>
      </span>
    </span>
  )
}
