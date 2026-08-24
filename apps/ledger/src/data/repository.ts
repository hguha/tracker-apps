// The single data-access boundary (principle #3): nothing but this layer touches the
// database. Screens call these functions; that one seam is what keeps sync swappable.
// Reads return promises so they drop straight into dexie-react-hooks' useLiveQuery.

import { db } from '@/db'
import { syncStamp, touch } from '@tracker-engine/local-first'
import { toLedgerEntries } from '@/lib/entries'
import type {
  Account,
  Budget,
  Category,
  Entry,
  LedgerEntry,
  Profile,
} from '@/domain/types'
import { enqueue, newId, patch } from './outbox'

export * from './outbox'
export { seedIfNeeded } from './seed'

const live = <T>(rows: T[]): T[] =>
  rows.filter((r) => (r as { deletedAt: number | null }).deletedAt === null)

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<Account[]> {
  return live(await db.accounts.toArray()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listCategories(): Promise<Category[]> {
  return live(await db.categories.toArray())
}

export async function getProfile(): Promise<Profile | undefined> {
  return db.profile.get('me')
}

export async function listBudgets(): Promise<Budget[]> {
  return live(await db.budgets.toArray())
}

export async function getEntry(id: string): Promise<Entry | undefined> {
  const entry = await db.entries.get(id)
  return entry && entry.deletedAt === null ? entry : undefined
}

/** The unified ledger: bank transactions (with overrides applied) + manual entries. */
export async function listLedgerEntries(): Promise<LedgerEntry[]> {
  const [transactions, entries, overrides] = await Promise.all([
    db.transactions.toArray(),
    db.entries.toArray(),
    db.categoryOverrides.toArray(),
  ])
  return toLedgerEntries(transactions, entries, overrides)
}

// ── Manual entries (client-authored) ───────────────────────────────────────────

export interface EntryInput {
  amountMinor: number
  date: string
  merchant: string
  categoryId: string | null
  accountId?: string | null
  note?: string
  currency?: string
}

export async function addEntry(input: EntryInput): Promise<string> {
  const id = newId()
  await db.entries.put({
    id,
    accountId: input.accountId ?? null,
    categoryId: input.categoryId,
    amountMinor: input.amountMinor,
    currency: input.currency ?? 'USD',
    date: input.date,
    merchant: input.merchant.trim(),
    note: input.note?.trim() ?? '',
    ...syncStamp(),
  })
  await enqueue('entries', id)
  return id
}

export async function updateEntry(
  id: string,
  changes: Partial<EntryInput>,
): Promise<void> {
  await patch('entries', id, changes)
}

export async function deleteEntry(id: string): Promise<void> {
  await patch('entries', id, { deletedAt: Date.now() })
}

// ── Categorization ─────────────────────────────────────────────────────────────

/**
 * Assigns a category to a ledger entry. A manual entry is edited in place; a bank
 * transaction (server-authored, pull-only) gets a client-authored override keyed by
 * its id, so the re-categorization syncs without mutating the untouchable row.
 */
export async function setEntryCategory(
  entry: LedgerEntry,
  categoryId: string | null,
): Promise<void> {
  if (entry.source === 'manual') {
    await patch('entries', entry.id, { categoryId })
    return
  }
  const existing = await db.categoryOverrides.get(entry.id)
  if (existing) {
    await patch('categoryOverrides', entry.id, { categoryId })
    return
  }
  await db.categoryOverrides.put({ id: entry.id, categoryId, ...syncStamp() })
  await enqueue('categoryOverrides', entry.id)
}

// ── Categories (client-authored) ────────────────────────────────────────────────

export async function addCategory(input: {
  name: string
  icon: string
  color: string
  isIncome?: boolean
}): Promise<string> {
  const id = newId()
  await db.categories.put({
    id,
    name: input.name.trim(),
    icon: input.icon,
    color: input.color,
    isIncome: input.isIncome ?? false,
    archived: false,
    ...syncStamp(),
  })
  await enqueue('categories', id)
  return id
}

export async function updateCategory(
  id: string,
  changes: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'archived'>>,
): Promise<void> {
  await patch('categories', id, changes)
}

// ── Budgets (client-authored) ────────────────────────────────────────────────────

/** Sets (or clears) a monthly cap for a category. `limitMinor <= 0` removes it. */
export async function setBudget(categoryId: string, limitMinor: number): Promise<void> {
  const existing = (await db.budgets.toArray()).find(
    (b) => b.categoryId === categoryId && b.deletedAt === null,
  )
  if (limitMinor <= 0) {
    if (existing) await patch('budgets', existing.id, { deletedAt: Date.now() })
    return
  }
  if (existing) {
    await patch('budgets', existing.id, { limitMinor })
    return
  }
  const id = newId()
  await db.budgets.put({ id, categoryId, limitMinor, ...syncStamp() })
  await enqueue('budgets', id)
}

// ── Profile (client-authored) ────────────────────────────────────────────────────

// Profile is device-local (not synced), so it's written directly, not through the
// outbox-backed patch(). Still stamped for a consistent row shape.
export async function updateProfile(changes: Partial<Omit<Profile, 'id'>>): Promise<void> {
  const current = await db.profile.get('me')
  if (!current) return
  await db.profile.update('me', { ...changes, ...touch(current.clientRev) })
}
