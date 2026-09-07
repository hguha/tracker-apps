/**
 * camelCase (domain / IndexedDB) ↔ snake_case (Postgres columns).
 *
 * The domain types use camelCase and Postgres uses snake_case, so exactly one
 * layer translates between them: this one, at the sync boundary. Keeping it in a
 * single tested module means no chart, repo function, or screen ever has to know
 * two names for the same field.
 */

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
}

export function keysToSnake(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[camelToSnake(key)] = value
  return out
}

export function keysToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[snakeToCamel(key)] = value
  return out
}

/** The Postgres table name for a synced Dexie store (both are otherwise identical). */
export function tableToPostgres(table: string): string {
  return camelToSnake(table)
}

/**
 * Timestamps: IndexedDB stores epoch ms (numbers); Postgres stores timestamptz.
 * These columns convert on the way in and out so both sides stay in their native
 * representation. NOTE: this set is currently REPutation-flavored; make it
 * The defaults cover created_at/updated_at/deleted_at, which are universal, plus the columns
 * the first app happened to need. Any app with its own timestamp columns passes them to
 * SupabaseBackend — a column missing from this set is sent to Postgres as epoch milliseconds,
 * which `timestamptz` rejects with a "date/time field value out of range" 400.
 */
export const DEFAULT_TIMESTAMP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'deleted_at',
  'started_at',
  'ended_at',
  'completed_at',
  'measured_at',
  'achieved_at',
  'last_used_at',
  'onboarded_at',
])

/** @deprecated Pass the set explicitly; kept so existing importers keep compiling. */
export const TIMESTAMP_COLUMNS = DEFAULT_TIMESTAMP_COLUMNS

export function msToIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

export function isoToMs(iso: string | null): number | null {
  return iso === null ? null : new Date(iso).getTime()
}
