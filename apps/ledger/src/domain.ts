// Ledger's domain. Money is stored in integer minor units (see @tracker-engine/core),
// outflows negative. Every synced row carries the standard sync stamp fields.

export interface Stamped {
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  clientRev: number
}

// Server-authored (pulled from the bank via aggregation; the client never writes these).
export interface Account extends Stamped {
  id: string
  name: string
  mask: string
  type: 'depository' | 'credit'
  currentBalanceMinor: number
  currency: string
}

export interface Transaction extends Stamped {
  id: string
  accountId: string
  categoryId: string | null
  amountMinor: number // outflow negative, income positive
  currency: string
  date: string // ISO yyyy-mm-dd
  merchant: string
  pending: boolean
}

// Client-authored (the user owns these; they push to the server like REPutation's rows).
export interface Category extends Stamped {
  id: string
  name: string
  icon: string
}
