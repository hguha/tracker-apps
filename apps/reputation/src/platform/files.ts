// Backup transport: thin REPutation wrapper over @tracker-engine/platform's
// generic file share/pick, passing the app's share-sheet title so behavior is
// unchanged. pickBackupText is re-exported as-is.
import { exportBackup as exportBackupCore, pickBackupText } from '@tracker-engine/platform'

export function exportBackup(json: string, filename: string): Promise<boolean> {
  return exportBackupCore(json, filename, 'REPutation backup')
}

export { pickBackupText }
