// The finance coach's tools. Retrieval tools run on the client against the ledger and
// feed de-identified aggregates back to the model (no account numbers, no notes). The
// one terminal tool — suggest_budget — surfaces an interactive card the user can apply.

import * as repo from '@/data/repository'
import * as metrics from '@/lib/metrics'
import { monthKey } from '@/lib/dates'
import type { ToolDeclaration } from '@tracker-engine/ai-coach'
import type { CoachAction } from './types'

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'get_spending_by_category',
    description: "This month's spending totals per category, biggest first.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_cashflow',
    description: 'Income vs. spend per month across the whole history.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_subscriptions',
    description: 'Detected recurring charges (subscriptions/bills) with cadence.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_budgets',
    description: "Current budgets and how much of each has been spent this month.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_top_merchants',
    description: "This month's largest merchants by total spend.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'suggest_budget',
    description:
      'Propose a monthly budget for a category. Surfaces a card the user can accept.',
    parameters: {
      type: 'object',
      properties: {
        categoryName: { type: 'string', description: 'Exact category name.' },
        monthlyLimit: { type: 'number', description: 'Suggested monthly cap in dollars.' },
        note: { type: 'string', description: 'One short sentence of rationale.' },
      },
      required: ['categoryName', 'monthlyLimit'],
    },
  },
]

const ACTION_TOOLS = new Set(['suggest_budget'])
export const isActionTool = (name: string): boolean => ACTION_TOOLS.has(name)

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
  return { entries, categories, budgets, current, currentEntries, nameOf }
}

export async function executeRetrievalTool(
  name: string,
  _args: Record<string, unknown>,
): Promise<unknown> {
  const { entries, currentEntries, budgets, current, nameOf } = await loadCurrentMonth()

  switch (name) {
    case 'get_spending_by_category':
      return {
        month: current,
        categories: metrics
          .spendingByCategory(currentEntries)
          .map((c) => ({ category: nameOf(c.categoryId), spent: c.totalMinor / 100 })),
      }
    case 'get_cashflow':
      return metrics.monthlyCashflow(entries).map((m) => ({
        month: m.month,
        income: m.incomeMinor / 100,
        spend: -m.spendMinor / 100,
        net: m.netMinor / 100,
      }))
    case 'get_subscriptions':
      return metrics.detectRecurring(entries).map((s) => ({
        merchant: s.merchant,
        cadence: s.cadence,
        amount: -s.avgAmountMinor / 100,
      }))
    case 'get_budgets':
      return metrics.budgetProgress(currentEntries, budgets).map((b) => ({
        category: nameOf(b.categoryId),
        limit: b.limitMinor / 100,
        spent: b.spentMinor / 100,
        ratio: Math.round(b.ratio * 100) / 100,
      }))
    case 'get_top_merchants':
      return metrics
        .topMerchants(currentEntries)
        .map((m) => ({ merchant: m.merchant, spent: m.totalMinor / 100, count: m.count }))
    default:
      return { error: `unknown tool ${name}` }
  }
}

export async function toolToAction(
  name: string,
  args: Record<string, unknown>,
): Promise<CoachAction | null> {
  if (name !== 'suggest_budget') return null
  const categoryName = String(args.categoryName ?? '').trim()
  const dollars = Number(args.monthlyLimit)
  if (!categoryName || !Number.isFinite(dollars) || dollars <= 0) return null

  const categories = await repo.listCategories()
  const match = categories.find(
    (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
  )
  if (!match) return null

  return {
    kind: 'budget',
    categoryId: match.id,
    categoryName: match.name,
    limitMinor: Math.round(dollars * 100),
    note: String(args.note ?? ''),
  }
}

export function toolLabel(name: string): string {
  switch (name) {
    case 'get_spending_by_category':
      return 'Analyzing spending…'
    case 'get_cashflow':
      return 'Reviewing cash flow…'
    case 'get_subscriptions':
      return 'Checking subscriptions…'
    case 'get_budgets':
      return 'Checking budgets…'
    case 'get_top_merchants':
      return 'Finding top merchants…'
    default:
      return 'Thinking…'
  }
}
