// Ledger's domain. Money is stored in integer minor units (see @tracker-engine/core),
// outflows negative, income positive. Every synced row carries the standard sync stamp.
//
// Authorship (mirrors the sync schema, principle #6):
//   • Bank feed  — `Account`, `Transaction`: SERVER-AUTHORED. The aggregation server
//     (Plaid) holds the token and writes these; the client only pulls them. It can
//     never invent a bank row, which is the security boundary.
//   • User-owned — `Entry` (manual log), `Category`, `Budget`, `CategoryOverride`,
//     `Profile`: CLIENT-AUTHORED. Created on-device, pushed to the user's own backend.

export interface Stamped {
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  clientRev: number
}

export type AccountType = 'depository' | 'credit' | 'investment' | 'loan' | 'cash'

// Server-authored: the aggregated bank/card/investment account.
export interface Account extends Stamped {
  id: string
  name: string
  institution: string | null
  mask: string
  type: AccountType
  currentBalanceMinor: number
  currency: string
}

// Server-authored: one settled or pending charge from the bank feed.
export interface Transaction extends Stamped {
  id: string
  accountId: string
  /** The aggregator's suggested category; the user can override it (see CategoryOverride). */
  categoryId: string | null
  amountMinor: number
  currency: string
  date: string // ISO yyyy-mm-dd
  merchant: string
  pending: boolean
}

// Client-authored: a manually logged transaction (cash, splitting, an account we
// don't aggregate). `accountId` is null when it isn't tied to a tracked account.
export interface Entry extends Stamped {
  id: string
  accountId: string | null
  categoryId: string | null
  amountMinor: number
  currency: string
  date: string
  merchant: string
  note: string
}

// Client-authored: the user's re-categorization of a (server-authored) bank
// transaction. Keyed by the transaction id, so it rides sync without mutating the
// pull-only row. `categoryId` null means "explicitly uncategorized".
export interface CategoryOverride extends Stamped {
  id: string // == Transaction.id
  categoryId: string | null
}

// Fixed palette keys map to the --cat-* theme tokens; a custom category stores any
// CSS color string. `color` is therefore a raw CSS value ('var(--cat-dining)' or '#aabbcc').
export type CategoryKey =
  | 'income'
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'shopping'
  | 'subscriptions'
  | 'housing'
  | 'utilities'
  | 'health'
  | 'entertainment'
  | 'transfer'
  | 'uncategorized'

// Client-authored: a spending category. Defaults are seeded; the user adds their own.
export interface Category extends Stamped {
  id: string
  name: string
  icon: string
  color: string
  /** Income categories are excluded from spend totals and budgets. */
  isIncome: boolean
  archived: boolean
}

// Client-authored: a monthly spend cap for a category.
export interface Budget extends Stamped {
  id: string
  categoryId: string
  limitMinor: number // positive
}

export type ColorSchemePreference = 'system' | 'light' | 'dark'
export type ThemePreset = 'default' | 'slate' | 'mono'

// Client-authored, single row (id 'me'). Appearance + identity, so it syncs across
// devices exactly like REPutation's profile.
export interface Profile extends Stamped {
  id: 'me'
  displayName: string
  currency: string
  theme: ThemePreset
  colorScheme: ColorSchemePreference
  onboardedAt: number | null
}

// The unified read model: a bank Transaction (with any override applied) or a
// manual Entry, flattened so every screen and metric works on one shape.
export interface LedgerEntry {
  id: string
  source: 'bank' | 'manual'
  accountId: string | null
  categoryId: string | null
  amountMinor: number
  currency: string
  date: string
  merchant: string
  note: string
  pending: boolean
}
