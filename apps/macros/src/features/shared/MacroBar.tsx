import { mgToGrams } from '@/lib/nutrition'
import type { Nutrients } from '@/domain/types'

/**
 * Progress toward one macro target — one bar, thick enough to hold its own numbers.
 *
 * There used to be two of these: a label-above-a-hairline version on the home page and a
 * label-bar-number row on the day screen, with different heights, type sizes and gram formatting.
 * Same quantity, two looks, so neither read as authoritative. This is the only one.
 *
 * **The numbers live inside the bar** rather than on a line above it, which halves the vertical
 * space three macros need and puts the figure next to the thing that encodes it.
 *
 * **The fill is a wash with a solid edge, not a solid block.** Text on a solid macro colour has to
 * change colour as the fill passes under it, and there is no ink that clears AA on all five macro
 * hues across fourteen theme/scheme combinations. A 30% wash keeps the hue unmistakable while every
 * character stays `--text-primary`; the 3px solid edge is what gives the exact reading.
 *
 * **Over target keeps the macro's own colour.** It used to switch to `--target-over`, so a day over
 * on all three showed three identical red bars — the colour that identifies the macro replaced by
 * the colour that describes its status. The overshoot is said in words instead, which is also the
 * only form that survives being read in greyscale.
 */
export function MacroBar({
  label,
  eatenMg,
  targetMg,
  sharePct,
  color,
}: {
  label: string
  eatenMg: number
  /** 0 when the app has no target yet — the bar then shows this macro's share of the day. */
  targetMg: number
  /** This macro's share of the day's calories, used when there's no target. */
  sharePct: number
  /** A `var(--macro-*)` reference. */
  color: string
}) {
  const hasTarget = targetMg > 0
  const eaten = Math.round(mgToGrams(eatenMg))
  const goal = Math.round(mgToGrams(targetMg))
  const pct = hasTarget ? (eatenMg / targetMg) * 100 : sharePct
  const fill = Math.min(100, Math.max(0, pct))
  const over = hasTarget && eaten > goal

  return (
    <div
      className="relative h-7 overflow-hidden rounded-lg bg-sunken"
      role="img"
      aria-label={
        hasTarget
          ? `${label} ${eaten} of ${goal} grams${over ? `, ${eaten - goal} over` : ''}`
          : `${label} ${eaten} grams, ${Math.round(sharePct)}% of the day's calories`
      }
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width]"
        style={{ width: `${fill}%`, background: `color-mix(in srgb, ${color} 30%, transparent)` }}
      />
      {/* Past the target the whole bar is hatched, so overshoot is visible without a hue change. */}
      {over && (
        <div
          className="absolute inset-0"
          style={{
            background: `repeating-linear-gradient(115deg, ${color} 0 2px, transparent 2px 7px)`,
            opacity: 0.28,
          }}
        />
      )}
      <div
        className="absolute bottom-0 left-0 h-[3px] transition-[width]"
        style={{ width: `${fill}%`, background: color }}
      />

      <div className="relative flex h-full items-center justify-between gap-2 px-2.5">
        <span className="text-[12.5px] font-medium">{label}</span>
        <span className="tabular text-[12.5px]">
          {eaten}
          {hasTarget ? (
            <>
              <span className="text-ink-secondary"> / {goal}g</span>
              {over && (
                <span className="font-semibold" style={{ color: 'var(--target-over)' }}>
                  {' '}
                  +{eaten - goal}
                </span>
              )}
            </>
          ) : (
            <span className="text-ink-secondary">
              g{eatenMg > 0 && ` · ${Math.round(sharePct)}%`}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

export const MACRO_BARS = [
  { key: 'proteinMg', label: 'Protein', color: 'var(--macro-protein)' },
  { key: 'carbsMg', label: 'Carbs', color: 'var(--macro-carbs)' },
  { key: 'fatMg', label: 'Fat', color: 'var(--macro-fat)' },
] as const satisfies readonly {
  key: keyof Pick<Nutrients, 'proteinMg' | 'carbsMg' | 'fatMg'>
  label: string
  color: string
}[]
