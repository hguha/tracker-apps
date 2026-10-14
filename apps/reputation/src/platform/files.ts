import { exportBackup as exportBackupCore } from '@tracker-engine/platform'

export function exportBackup(json: string, filename: string): Promise<boolean> {
  return exportBackupCore(json, filename, 'REPutation backup')
}
