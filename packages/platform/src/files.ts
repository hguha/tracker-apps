import { isNativePlatform } from './detect'

// Hands `json` to the user as a file. On web, triggers a download of `filename`.
// On native, writes to a cache dir and opens the share sheet (Files, AirDrop,
// Drive, mail). Returns false if the user dismissed the native share sheet.
export async function exportBackup(
  json: string,
  filename: string,
  shareTitle = 'Backup',
): Promise<boolean> {
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
    await Share.share({ title: shareTitle, url: uri })
    return true
  } catch {
    // The share sheet throws on cancel; that's a normal dismissal, not an error.
    return false
  }
}

export async function pickBackupText(file?: File): Promise<string | null> {
  return file ? file.text() : null
}
