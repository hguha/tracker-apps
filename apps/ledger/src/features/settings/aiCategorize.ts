// AI auto-categorization: ask the `categorize` Edge Function (Gemini) to map the
// user's uncategorized merchants to categories, then turn each mapping into a rule so
// the deterministic rules engine applies it to past + future transactions. Only
// merchant + category names leave the device (no amounts / account info).

import { getSupabase } from '@/backend/supabaseClient'
import * as repo from '@/data/repository'

export interface Assignment {
  merchant: string
  categoryId: string
}

type CallFn = (
  merchants: string[],
  categories: { id: string; name: string }[],
) => Promise<Assignment[]>

const callCategorize: CallFn = async (merchants, categories) => {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Sign in to use AI categorization.')
  const { data, error } = await supabase.functions.invoke('categorize', {
    body: { merchants, categories },
  })
  if (error) throw error
  return (data?.assignments ?? []) as Assignment[]
}

/**
 * Suggests + applies categories for every uncategorized merchant. Injectable `call`
 * for testing. Returns how many rules were created and how many merchants it looked at.
 */
export async function autoCategorize(
  call: CallFn = callCategorize,
): Promise<{ created: number; considered: number }> {
  const entries = await repo.listLedgerEntries()
  const merchants = [
    ...new Set(
      entries.filter((e) => e.categoryId === null && e.merchant.trim()).map((e) => e.merchant),
    ),
  ]
  if (merchants.length === 0) return { created: 0, considered: 0 }

  const categories = (await repo.listCategories()).map((c) => ({ id: c.id, name: c.name }))
  const assignments = await call(merchants, categories)

  const created = await repo.addRulesBulk(
    assignments.map((a) => ({ merchantMatch: a.merchant, matchType: 'equals' as const, categoryId: a.categoryId })),
  )
  return { created, considered: merchants.length }
}
