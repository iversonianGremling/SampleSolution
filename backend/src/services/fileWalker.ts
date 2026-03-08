import fs from 'fs/promises'
import path from 'path'

const SUPPORTED_FORMATS = ['.wav', '.mp3', '.flac', '.aiff', '.ogg', '.m4a']

/**
 * Async generator that walks a directory tree and yields audio file paths
 * one at a time, without buffering the full list in memory.
 * Files are sorted within each directory level (not globally).
 */
export async function* walkAudioFiles(rootDir: string): AsyncGenerator<string> {
  const stack: string[] = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()!
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch (err) {
      console.warn(`[fileWalker] Skipping unreadable directory: ${currentDir}`, err)
      continue
    }

    // Sort entries within this directory for deterministic ordering
    entries.sort((a, b) => a.name.localeCompare(b.name))

    const subdirs: string[] = []

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        subdirs.push(fullPath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_FORMATS.includes(ext)) {
          yield fullPath
        }
      }
    }

    // Push subdirectories in reverse order so they're processed in sorted order
    for (let i = subdirs.length - 1; i >= 0; i--) {
      stack.push(subdirs[i])
    }
  }
}
