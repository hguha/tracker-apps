// The default category taxonomy. Colors are CSS values referencing the theme
// tokens (tokens.css), so a category stays the same color across light/dark and
// every chart. Custom categories the user adds store their own color instead.

import type { CategoryKey } from './types'

export interface CategoryDefault {
  key: CategoryKey
  name: string
  icon: string
  color: string
  isIncome: boolean
}

export const DEFAULT_CATEGORIES: CategoryDefault[] = [
  { key: 'income', name: 'Income', icon: '💰', color: 'var(--cat-income)', isIncome: true },
  { key: 'groceries', name: 'Groceries', icon: '🛒', color: 'var(--cat-groceries)', isIncome: false },
  { key: 'dining', name: 'Dining', icon: '🍽️', color: 'var(--cat-dining)', isIncome: false },
  { key: 'transport', name: 'Transport', icon: '🚇', color: 'var(--cat-transport)', isIncome: false },
  { key: 'shopping', name: 'Shopping', icon: '🛍️', color: 'var(--cat-shopping)', isIncome: false },
  { key: 'subscriptions', name: 'Subscriptions', icon: '🔁', color: 'var(--cat-subscriptions)', isIncome: false },
  { key: 'housing', name: 'Housing', icon: '🏠', color: 'var(--cat-housing)', isIncome: false },
  { key: 'utilities', name: 'Utilities', icon: '💡', color: 'var(--cat-utilities)', isIncome: false },
  { key: 'health', name: 'Health', icon: '🩺', color: 'var(--cat-health)', isIncome: false },
  { key: 'entertainment', name: 'Entertainment', icon: '🎬', color: 'var(--cat-entertainment)', isIncome: false },
  { key: 'transfer', name: 'Transfer', icon: '↔️', color: 'var(--cat-transfer)', isIncome: false },
]

// Stable id for a seeded category, so re-seeding and the aggregator's category
// hints line up on the same rows across devices.
export const defaultCategoryId = (key: CategoryKey): string => `cat_${key}`

// The color a chart/badge uses when a transaction has no (or an unknown) category.
export const UNCATEGORIZED_COLOR = 'var(--cat-uncategorized)'

// Swatches offered when creating a custom category — the same theme-aware palette.
export const CATEGORY_PALETTE: string[] = DEFAULT_CATEGORIES.filter(
  (c) => !c.isIncome,
).map((c) => c.color)

// Emoji offered for a custom category.
export const CATEGORY_ICONS = ['🏷️', '☕', '✈️', '🎁', '📚', '🐾', '🚗', '🏋️', '💅', '🍺']
