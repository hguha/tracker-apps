// The offline coach (principle #9): a data-driven mock so the feature works — and
// demos — with no network and no key. It doesn't reason like the model; it computes
// real facts from the ledger and answers common intents, and can still surface a
// budget-suggestion card. Always available, so it's the fallback when Gemini isn't.

import * as repo from '@/data/repository'
import * as metrics from '@/lib/metrics'
import { monthKey } from '@/lib/dates'
import { fmtAbs, fmtPercent } from '@/lib/format'
import type {
  CoachAction,
  CoachChatResult,
  CoachContext,
  CoachProvider,
  GeminiContent,
} from './types'

function lastUserText(contents: GeminiContent[]): string {
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const c = contents[i]!
    if (c.role === 'user') {
      const text = c.parts.map((p) => p.text ?? '').join(' ').trim()
      if (text) return text.toLowerCase()
    }
  }
  return ''
}

async function loadCurrentMonth() {
  const [entries, categories, budgets] = await Promise.all([
    repo.listLedgerEntries(),
    repo.listCategories(),
    repo.listBudgets(),
  ])
  const months = [...new Set(entries.map((e) => monthKey(e.date)))].sort()
  const current = months.at(-1) ?? null
  const currentEntries = current
    ? entries.filter((e) => monthKey(e.date) === current)
    : []
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized'
  return { entries, categories, budgets, currentEntries, nameOf }
}

async function answer(text: string): Promise<{ text: string; action?: CoachAction }> {
  const { entries, categories, budgets, currentEntries, nameOf } = await loadCurrentMonth()

  if (/subscri|recurring/.test(text)) {
    const subs = metrics.detectRecurring(entries)
    if (subs.length === 0) return { text: "I don't see any recurring charges yet." }
    const total = subs.reduce((s, r) => s + -r.avgAmountMinor, 0)
    const list = subs.map((s) => `• ${s.merchant} (${s.cadence}) ${fmtAbs(-s.avgAmountMinor)}`).join('\n')
    return { text: `You have ${subs.length} recurring charges, about ${fmtAbs(total)}/period:\n${list}` }
  }

  if (/save|saving/.test(text)) {
    const rate = metrics.savingsRate(currentEntries)
    return {
      text: `You're keeping ${fmtPercent(rate)} of your income this month. A simple lever: cap your largest discretionary category — ask me to "suggest a budget".`,
    }
  }

  if (/budget/.test(text)) {
    const top = metrics.spendingByCategory(currentEntries)[0]
    if (!top) return { text: 'No spending yet this month to budget against.' }
    const cat = categories.find((c) => c.id === top.categoryId)
    // Suggest ~10% under current spend as a gentle target.
    const limitMinor = Math.round((top.totalMinor * 0.9) / 100) * 100
    if (!cat) return { text: `Your top category is uncategorized (${fmtAbs(top.totalMinor)}). Categorize it first.` }
    void budgets
    return {
      text: `Your biggest category this month is ${cat.name} at ${fmtAbs(top.totalMinor)}. Here's a target to try:`,
      action: {
        kind: 'budget',
        categoryId: cat.id,
        categoryName: cat.name,
        limitMinor,
        note: 'About 10% under your current spend.',
      },
    }
  }

  // Default: a quick overview.
  const { incomeMinor, spendMinor } = metrics.totals(currentEntries)
  const byCat = metrics.spendingByCategory(currentEntries).slice(0, 3)
  const tops = byCat.map((c) => `${nameOf(c.categoryId)} (${fmtAbs(c.totalMinor)})`).join(', ')
  return {
    text: `This month you brought in ${fmtAbs(incomeMinor)} and spent ${fmtAbs(spendMinor)}. Your top categories: ${tops || 'none yet'}. Ask me about subscriptions, saving, or a budget.`,
  }
}

export const mockCoachProvider: CoachProvider = {
  name: 'Ledger Coach (offline)',

  async chat(
    contents: GeminiContent[],
    _context: CoachContext,
  ): Promise<CoachChatResult> {
    const { text, action } = await answer(lastUserText(contents))
    return {
      contents: [...contents, { role: 'model', parts: [{ text }] }],
      text,
      action,
    }
  },

  async isAvailable(): Promise<boolean> {
    return true
  },
}
