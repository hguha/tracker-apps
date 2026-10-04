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
  WaterRow,
} from '@/domain/types'

/**
 * A full JSON export of everything the user authored. `foods` is excluded: it's reference data
 * anyone can re-fetch, and including ~2M rows would make a backup unusable.
 */
const BACKUP_FORMAT = 'macrocosm.backup.v1'

export interface Backup {
  format: typeof BACKUP_FORMAT
  exportedAt: number
  profiles: Profile[]
  logEntries: LogEntry[]
  bodyWeights: BodyWeightRow[]
  /** Absent in a v1 file written before water existed, which is what `?? []` on read is for. */
  waterLogs: WaterRow[]
  recipes: Recipe[]
  mealTemplates: MealTemplate[]
  programs: Program[]
  checkIns: CheckIn[]
}

export class BackupParseError extends Error {}

/**
 * A spreadsheet of the log: one row per entry, with the food's name and every macro.
 *
 * Deliberately not the backup format. A backup has to round-trip, so it keeps ids and integer
 * milligrams; a CSV is for reading, so it carries names and grams and can't be imported back.
 * Saying which is which matters — a "CSV backup" nobody can restore is worse than none.
 */
export async function exportToCsv(): Promise<string> {
  const entries = (await db.logEntries.filter((row) => row.deletedAt === null).toArray()).sort(
    (a, b) => a.eatenAt - b.eatenAt,
  )
  const foods = new Map(
    [...(await db.foods.bulkGet(ids(entries))), ...(await db.customFoods.bulkGet(ids(entries)))]
      .filter((food) => food !== undefined)
      .map((food) => [food.id, food.description]),
  )

  const header = [
    'day',
    'time',
    'meal',
    'item',
    'grams',
    'kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'fibre_g',
    'source',
  ]
  const rows = entries.map((entry) => [
    entry.day,
    new Date(entry.eatenAt).toTimeString().slice(0, 5),
    entry.meal,
    (entry.foodId ? foods.get(entry.foodId) : null) ?? (entry.note || 'Calories only'),
    round(entry.grams),
    entry.nutrients.kcal,
    grams(entry.nutrients.proteinMg),
    grams(entry.nutrients.carbsMg),
    grams(entry.nutrients.fatMg),
    entry.nutrients.fiberMg === null ? '' : grams(entry.nutrients.fiberMg),
    entry.source,
  ])

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

const ids = (entries: readonly LogEntry[]): string[] =>
  entries.map((entry) => entry.foodId).filter((id): id is string => id !== null)

const round = (value: number): number => Math.round(value * 10) / 10
const grams = (mg: number): number => Math.round(mg / 100) / 10

/** Quote anything with a comma, quote or newline in it — food names have all three. */
function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function exportToJson(): Promise<string> {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    profiles: await db.profiles.toArray(),
    logEntries: await db.logEntries.toArray(),
    bodyWeights: await db.bodyWeights.toArray(),
    waterLogs: await db.waterLogs.toArray(),
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
    waterLogs: backup.waterLogs ?? [],
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
    ['waterLogs', db.waterLogs, backup.waterLogs],
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
