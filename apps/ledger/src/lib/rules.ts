// Pure rule matching for auto-categorization. A rule maps a merchant pattern to a
// category; the first enabled rule that matches wins. Case-insensitive. Kept pure and
// separate from the DB so it's trivially testable and reused by the apply path + any
// preview UI.

import type { Rule } from '@/domain/types'

export function ruleMatches(rule: Rule, merchant: string): boolean {
  if (!rule.enabled || rule.deletedAt !== null) return false
  const needle = rule.merchantMatch.trim().toLowerCase()
  if (!needle) return false
  const hay = merchant.toLowerCase()
  return rule.matchType === 'equals' ? hay === needle : hay.includes(needle)
}

/** The category a set of rules assigns to a merchant, or null if none match. */
export function categoryForMerchant(merchant: string, rules: Rule[]): string | null {
  for (const rule of rules) {
    if (ruleMatches(rule, merchant)) return rule.categoryId
  }
  return null
}
