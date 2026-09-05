import { syncStamp } from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue } from '@/data/outbox'
import type {
  BodyWeightRow,
  CheckIn,
  LogEntry,
  MealTemplate,
  Profile,
  Program,
  Recipe,
} from '@/domain/types'

/**
 * A full JSON export of everything the user authored. `foods` is excluded: it's reference data
 * anyone can re-fetch, and including ~2M rows would make a backup unusable.
 */
export const BACKUP_FORMAT = 'macrocosm.backup.v1'

export interface Backup {
  format: typeof BACKUP_FORMAT
  exportedAt: number
  profiles: Profile[]
  logEntries: LogEntry[]
  bodyWeights: BodyWeightRow[]
  recipes: Recipe[]
  mealTemplates: MealTemplate[]
  programs: Program[]
  checkIns: CheckIn[]
}

export class BackupParseError extends Error {}

export async function exportToJson(): Promise<string> {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    profiles: await db.profiles.toArray(),
    logEntries: await db.logEntries.toArray(),
    bodyWeights: await db.bodyWeights.toArray(),
    recipes: await db.recipes.toArray(),
    mealTemplates: await db.mealTemplates.toArray(),
    programs: await db.programs.toArray(),
    checkIns: await db.checkIns.toArray(),
  }
  return JSON.stringify(backup, null, 2)
}

export function parseBackup(text: string): Backup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupParseError("That file isn't valid JSON.")
  }
  const backup = parsed as Partial<Backup>
  if (backup.format !== BACKUP_FORMAT) {
    throw new BackupParseError("That doesn't look like a MACROcosm backup.")
  }
  return {
    format: BACKUP_FORMAT,
    exportedAt: backup.exportedAt ?? Date.now(),
    profiles: backup.profiles ?? [],
    logEntries: backup.logEntries ?? [],
    bodyWeights: backup.bodyWeights ?? [],
    recipes: backup.recipes ?? [],
    mealTemplates: backup.mealTemplates ?? [],
    programs: backup.programs ?? [],
    checkIns: backup.checkIns ?? [],
  }
}

export function countsOf(backup: Backup) {
  return {
    days: new Set(backup.logEntries.map((e) => e.day)).size,
    entries: backup.logEntries.length,
    weights: backup.bodyWeights.length,
    recipes: backup.recipes.length,
  }
}

/**
 * Merges a backup in. Rows keep their ids, so re-importing the same file is idempotent and
 * nothing is deleted — an import must never be able to lose data the user still has.
 */
export async function importBackup(backup: Backup): Promise<void> {
  const owner = (await db.profiles.toArray())[0]?.id
  const tables = [
    ['logEntries', db.logEntries, backup.logEntries],
    ['bodyWeights', db.bodyWeights, backup.bodyWeights],
    ['recipes', db.recipes, backup.recipes],
    ['mealTemplates', db.mealTemplates, backup.mealTemplates],
    ['programs', db.programs, backup.programs],
    ['checkIns', db.checkIns, backup.checkIns],
  ] as const

  for (const [name, store, rows] of tables) {
    for (const row of rows) {
      // Re-owned to whoever is signed in here, or the rows would be invisible under RLS.
      const owned = { ...row, ...(owner ? { userId: owner } : {}), ...syncStamp() }
      await (store as unknown as { put(row: unknown): Promise<unknown> }).put(owned)
      await enqueue(name, row.id)
    }
  }
}
