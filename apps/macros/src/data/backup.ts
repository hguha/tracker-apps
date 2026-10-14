import {
  BackupParseError,
  backupRows,
  importBackupRows,
  parseBackupObject,
  syncStamp,
} from '@tracker-engine/local-first'
import { db } from '@/db'
import { enqueue } from '@/data/outbox'
import { checkInIdFor, migrateSavedMeals, weightIdFor, waterIdFor } from '@/data/repository'
import { activeUserId } from '@/data/repository/internal'
import type {
  BodyWeightRow,
  CheckIn,
  CustomFood,
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
  customFoods: CustomFood[]
  bodyWeights: BodyWeightRow[]
  /** Absent in a v1 file written before water existed, which is what `?? []` on read is for. */
  waterLogs: WaterRow[]
  recipes: Recipe[]
  mealTemplates: MealTemplate[]
  programs: Program[]
  checkIns: CheckIn[]
}

export { BackupParseError }

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
    customFoods: await db.customFoods.toArray(),
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
  const notOurs = "That doesn't look like a MACROcosm backup."
  const backup = parseBackupObject(text, notOurs)
  if (backup.format !== BACKUP_FORMAT) throw new BackupParseError(notOurs)
  return {
    format: BACKUP_FORMAT,
    exportedAt: typeof backup.exportedAt === 'number' ? backup.exportedAt : Date.now(),
    profiles: backupRows(backup.profiles),
    logEntries: backupRows(backup.logEntries),
    customFoods: backupRows(backup.customFoods),
    bodyWeights: backupRows(backup.bodyWeights),
    waterLogs: backupRows(backup.waterLogs),
    recipes: backupRows(backup.recipes),
    mealTemplates: backupRows(backup.mealTemplates),
    programs: backupRows(backup.programs),
    checkIns: backupRows(backup.checkIns),
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
  const userId = activeUserId
  const owned = <T extends { deletedAt?: number | null }>(rows: T[]) =>
    rows.map((row) => ({ ...row, userId, ...syncStamp(), deletedAt: row.deletedAt ?? null }))
  const rekeyed = <T extends { id?: unknown; deletedAt?: number | null }>(
    rows: T[],
    idFor: (owner: string, row: T) => string,
  ) =>
    owned(rows.filter((row) => typeof row.id === 'string')).map((row) => ({
      ...row,
      id: idFor(userId, row),
    }))

  await importBackupRows({
    tables: [
      { table: 'customFoods', store: db.customFoods, rows: owned(backup.customFoods) },
      { table: 'logEntries', store: db.logEntries, rows: owned(backup.logEntries) },
      {
        table: 'bodyWeights',
        store: db.bodyWeights,
        rows: rekeyed(backup.bodyWeights, (owner, row) => weightIdFor(owner, row.day)),
      },
      {
        table: 'waterLogs',
        store: db.waterLogs,
        rows: rekeyed(backup.waterLogs, (owner, row) => waterIdFor(owner, row.day)),
      },
      { table: 'recipes', store: db.recipes, rows: owned(backup.recipes) },
      { table: 'mealTemplates', store: db.mealTemplates, rows: owned(backup.mealTemplates) },
      { table: 'programs', store: db.programs, rows: owned(backup.programs) },
      {
        table: 'checkIns',
        store: db.checkIns,
        rows: rekeyed(backup.checkIns, (owner, row) => checkInIdFor(owner, row.weekStart)),
      },
    ],
    inTransaction: (work) => db.transaction('rw', db.tables, work),
    enqueue,
  })
  await migrateSavedMeals()
}
