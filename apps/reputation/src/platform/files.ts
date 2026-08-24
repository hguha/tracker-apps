// Backup export/import transport. The JSON and its parsing (data/backup.ts) are
// identical across platforms; only how bytes leave and enter the app differs.
// Web uses a download link and a file <input>; native uses the OS share sheet
// and document picker.
import { isNativePlatform } from '@/lib/platform'

// Hands `json` to the user as a file. On web, triggers a download of `filename`.
// On native, writes to a cache dir and opens the share sheet (Files, AirDrop,
// Drive, mail). Returns false if the user dismissed the native share sheet.
export async function exportBackup(json: string, filename: string): Promise<boolean> {
  if (!isNativePlatform()) {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    return true
  }

  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  try {
    await Share.share({ title: 'REPutation backup', url: uri })
    return true
  } catch {
    // The share sheet throws on cancel; that's a normal dismissal, not an error.
    return false
  }
}

// Returns the chosen backup file's text, or null if the user cancelled. Web uses
// the caller's <input type=file>; native opens the document picker.
export async function pickBackupText(webFile?: File): Promise<string | null> {
  if (!isNativePlatform()) {
    return webFile ? webFile.text() : null
  }

  const { Filesystem, Encoding } = await import('@capacitor/filesystem')
  // pickFiles landed in the Filesystem plugin's recent versions; guard in case.
  const picker = (
    Filesystem as unknown as {
      pickFiles?: (opts: {
        types: string[]
      }) => Promise<{ files: { path?: string; data?: string }[] }>
    }
  ).pickFiles
  if (!picker) return null

  const result = await picker({ types: ['application/json'] })
  const file = result.files[0]
  if (!file) return null
  if (typeof file.data === 'string') return atob(file.data)
  if (file.path) {
    const read = await Filesystem.readFile({ path: file.path, encoding: Encoding.UTF8 })
    return typeof read.data === 'string' ? read.data : null
  }
  return null
}
