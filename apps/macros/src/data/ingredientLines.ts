import { parseIngredientLine, type ParsedIngredient } from '@/lib/parseIngredient'
import { isConfident, resolveAmount, type ResolvedAmount } from '@/lib/resolveAmount'
import { matchIngredient } from '@/data/matchFood'
import type { Food } from '@/domain/types'

/**
 * Ingredient lines to matched, weighed foods — locally, with no model involved.
 *
 * This is the path an import takes now. It runs in a second rather than 45, it can't be rate
 * limited, and it works offline for anything already cached. The model is kept for the cases text
 * parsing genuinely can't reach — a described dish with no stated amounts — where it's the right
 * tool rather than a dependency for the easy case.
 *
 * Every gram still comes from either a stated mass or a USDA portion. Nothing here invents a number.
 */

export interface ResolvedLine {
  parsed: ParsedIngredient
  food: Food | null
  /** Whether the name matched as written, or only after relaxing it. See `data/matchFood`. */
  matchedBy: 'exact' | 'fuzzy' | 'unmatched'
  grams: number | null
  basis: ResolvedAmount['basis']
  /** True when the figure is exact or measured; false when it's an assumption worth showing. */
  isConfident: boolean
}

export interface LinesResult {
  lines: ResolvedLine[]
  /** One sentence naming what was assumed or skipped, in the same shape the model returned. */
  assumptions: string
}

/**
 * Resolves every line, matching each name against the database.
 *
 * Lookups run in parallel because they're independent, but the *remote* fallback is deliberately
 * limited: nineteen misses would otherwise be nineteen USDA round trips. Local first, and only the
 * lines that missed go out — which for a second import of the same recipe is none of them.
 */
export async function resolveLines(
  rawLines: readonly string[],
  /**
   * Called as each line lands, so a nineteen-line import can count up on screen.
   *
   * Without it the whole thing sat behind one "Working out the amounts…" for however long the
   * slowest lookup took, which is indistinguishable from a hang — and it's the step people wrongly
   * assumed was the AI.
   */
  onProgress?: (done: number, total: number) => void,
): Promise<LinesResult> {
  const parsed = rawLines.map(parseIngredientLine).filter((line) => line.name.length > 1)
  let done = 0

  const lines = await Promise.all(
    parsed.map(async (line): Promise<ResolvedLine> => {
      const matched =
        line.isToTaste && line.quantity === null
          ? { food: null, matchedBy: 'unmatched' as const }
          : await matchIngredient(line.name)
      const amount = resolveAmount(line, matched.food)
      done += 1
      onProgress?.(done, parsed.length)
      return {
        parsed: line,
        food: matched.food,
        matchedBy: matched.matchedBy,
        grams: amount.grams,
        basis: amount.basis,
        isConfident: isConfident(amount.basis),
      }
    }),
  )

  return { lines, assumptions: describe(lines) }
}

/**
 * What had to be assumed, said in one line.
 *
 * The same contract the model's `assumptions` field had, so the UI didn't need to learn a second
 * shape — and so the user gets the same honesty about volumes from the local path.
 */
function describe(lines: readonly ResolvedLine[]): string {
  const skipped = lines.filter((line) => line.grams === null)
  const assumed = lines.filter((line) => line.basis === 'assumed-water')
  const parts: string[] = []

  if (assumed.length > 0) {
    parts.push(
      `Converted ${assumed.length} volume${assumed.length === 1 ? '' : 's'} at water's density (${assumed
        .map((line) => line.parsed.name)
        .join(', ')}) — check those weights`,
    )
  }
  if (skipped.length > 0) {
    parts.push(
      `Skipped ${skipped.map((line) => line.parsed.name).join(', ')}: no amount stated, and a weight invented for seasoning is worse than none`,
    )
  }
  return parts.join('. ')
}
