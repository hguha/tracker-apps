import { parseIngredientLine, type ParsedIngredient } from '@/lib/parseIngredient'
import { isConfident, resolveAmount, type ResolvedAmount } from '@/lib/resolveAmount'
import * as repo from '@/data/repository'
import { searchRemote } from '@/data/foodLookup'
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
export async function resolveLines(rawLines: readonly string[]): Promise<LinesResult> {
  const parsed = rawLines.map(parseIngredientLine).filter((line) => line.name.length > 1)

  const lines = await Promise.all(
    parsed.map(async (line): Promise<ResolvedLine> => {
      const food = line.isToTaste && line.quantity === null ? null : await bestMatch(line.name)
      const amount = resolveAmount(line, food)
      return {
        parsed: line,
        food,
        grams: amount.grams,
        basis: amount.basis,
        isConfident: isConfident(amount.basis),
      }
    }),
  )

  return { lines, assumptions: describe(lines) }
}

/** Local, then one remote search — the same order every other lookup in the app uses. */
async function bestMatch(name: string): Promise<Food | null> {
  const local = await repo.searchFoods(name, 1)
  if (local[0]) return local[0]

  // Generic sources only: these are ingredients, and Open Food Facts' packaged rows are the wrong
  // answer for "cooked spaghetti" as well as the slowest part of resolving nineteen of them.
  await searchRemote(name, { branded: false })
  const matched = await repo.searchFoods(name, 1)
  if (matched[0]) return matched[0]

  // One retry on the head noun. "low sodium chicken broth" may miss where "chicken broth" hits, and
  // a slightly wrong row the user can see beats an unmatched line contributing zero.
  const head = name.split(/\s+/).slice(-2).join(' ')
  if (head !== name && head.length > 3) {
    const fallback = await repo.searchFoods(head, 1)
    if (fallback[0]) return fallback[0]
  }
  return null
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
