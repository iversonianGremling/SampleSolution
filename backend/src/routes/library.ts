import { Router } from 'express'
import fs from 'fs/promises'
import path from 'path'
import { spawn } from 'child_process'
import { resetDbConnection } from '../db/index.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

const LIBRARY_DIRS = ['audio', 'slices', 'peaks', 'uploads']
const LIBRARY_DB_FILE = 'database.sqlite'
const LIBRARY_MANIFEST_FILE = 'library-manifest.json'

class LibraryImportValidationError extends Error {}
class LibraryImportRuntimeError extends Error {}

async function copyIfExists(src: string, dest: string): Promise<void> {
  try {
    await fs.access(src)
    await fs.cp(src, dest, { recursive: true, force: true })
  } catch {
    // Source missing is acceptable (e.g. optional dirs/files)
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const details = stderr.trim()
      reject(new Error(details || `${command} exited with code ${code ?? -1}`))
    })
  })
}

async function extractZipArchive(zipPath: string, destinationDir: string): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true })

  if (process.platform === 'win32') {
    const escapedZipPath = zipPath.replace(/'/g, "''")
    const escapedDestinationDir = destinationDir.replace(/'/g, "''")
    const command = `Expand-Archive -LiteralPath '${escapedZipPath}' -DestinationPath '${escapedDestinationDir}' -Force`

    try {
      await runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') {
        throw new LibraryImportRuntimeError('ZIP import is unavailable: powershell is not installed on this server.')
      }
      throw new LibraryImportValidationError(`Failed to extract ZIP archive: ${getErrorMessage(error)}`)
    }
  }

  try {
    await runCommand('unzip', ['-o', zipPath, '-d', destinationDir])
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      throw new LibraryImportRuntimeError('ZIP import is unavailable: unzip is not installed on this server.')
    }
    throw new LibraryImportValidationError(`Failed to extract ZIP archive: ${getErrorMessage(error)}`)
  }
}

async function hasLibraryPackageFiles(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(candidatePath, LIBRARY_DB_FILE))
    await fs.access(path.join(candidatePath, LIBRARY_MANIFEST_FILE))
    return true
  } catch {
    return false
  }
}

async function detectLibraryRoot(inputPath: string): Promise<string | null> {
  const resolvedInputPath = path.resolve(inputPath)

  if (await hasLibraryPackageFiles(resolvedInputPath)) {
    return resolvedInputPath
  }

  try {
    const entries = await fs.readdir(resolvedInputPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidatePath = path.join(resolvedInputPath, entry.name)
      if (await hasLibraryPackageFiles(candidatePath)) {
        return candidatePath
      }
    }
  } catch {
    return null
  }

  return null
}

async function resolveLibraryImportSource(libraryPath: string): Promise<{ libraryRoot: string; cleanupDir: string | null; extractedFromZip: boolean }> {
  const resolvedInputPath = path.resolve(libraryPath)

  let inputStat: Awaited<ReturnType<typeof fs.stat>>
  try {
    inputStat = await fs.stat(resolvedInputPath)
  } catch {
    throw new LibraryImportValidationError('Library path does not exist or cannot be accessed.')
  }

  if (inputStat.isDirectory()) {
    const libraryRoot = await detectLibraryRoot(resolvedInputPath)
    if (!libraryRoot) {
      throw new LibraryImportValidationError(`Invalid library package path (missing ${LIBRARY_DB_FILE} or ${LIBRARY_MANIFEST_FILE}).`)
    }

    return {
      libraryRoot,
      cleanupDir: null,
      extractedFromZip: false,
    }
  }

  if (!inputStat.isFile()) {
    throw new LibraryImportValidationError('libraryPath must point to a folder or .zip file.')
  }

  if (path.extname(resolvedInputPath).toLowerCase() !== '.zip') {
    throw new LibraryImportValidationError('libraryPath must point to a folder or .zip file.')
  }

  const extractRoot = path.join(
    DATA_DIR,
    'library_imports',
    `import_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`
  )

  try {
    await extractZipArchive(resolvedInputPath, extractRoot)

    const libraryRoot = await detectLibraryRoot(extractRoot)
    if (!libraryRoot) {
      throw new LibraryImportValidationError(`Invalid backup ZIP (missing ${LIBRARY_DB_FILE} or ${LIBRARY_MANIFEST_FILE}).`)
    }

    return {
      libraryRoot,
      cleanupDir: extractRoot,
      extractedFromZip: true,
    }
  } catch (error) {
    await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

router.post('/library/export', async (req, res) => {
  const { exportPath } = req.body as { exportPath?: string }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const targetDir = exportPath || path.join(DATA_DIR, 'library_exports', `library_${timestamp}`)

    await fs.mkdir(targetDir, { recursive: true })

    const dbSource = path.join(DATA_DIR, 'database.sqlite')
    await copyIfExists(dbSource, path.join(targetDir, 'database.sqlite'))

    for (const dirName of LIBRARY_DIRS) {
      await copyIfExists(path.join(DATA_DIR, dirName), path.join(targetDir, dirName))
    }

    await copyIfExists(path.join(DATA_DIR, 'learned_weights.json'), path.join(targetDir, 'learned_weights.json'))

    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      includes: {
        database: 'database.sqlite',
        directories: LIBRARY_DIRS,
        optionalFiles: ['learned_weights.json'],
      },
    }

    await fs.writeFile(path.join(targetDir, 'library-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

    res.json({
      success: true,
      exportPath: targetDir,
      manifest,
    })
  } catch (error) {
    console.error('Error exporting library:', error)
    res.status(500).json({ error: 'Failed to export library' })
  }
})

router.post('/library/import', async (req, res) => {
  const { libraryPath } = req.body as { libraryPath?: string }

  if (!libraryPath) {
    return res.status(400).json({ error: 'libraryPath is required' })
  }

  let cleanupExtractedDir: string | null = null

  try {
    const resolvedSource = await resolveLibraryImportSource(libraryPath)
    const sourceRoot = resolvedSource.libraryRoot
    cleanupExtractedDir = resolvedSource.cleanupDir
    const sourceDb = path.join(sourceRoot, LIBRARY_DB_FILE)

    const backupDir = path.join(DATA_DIR, 'library_backups', `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`)
    await fs.mkdir(backupDir, { recursive: true })

    // Close active DB connection before replacing SQLite file
    resetDbConnection()

    await copyIfExists(path.join(DATA_DIR, 'database.sqlite'), path.join(backupDir, 'database.sqlite'))
    for (const dirName of LIBRARY_DIRS) {
      await copyIfExists(path.join(DATA_DIR, dirName), path.join(backupDir, dirName))
    }
    await copyIfExists(path.join(DATA_DIR, 'learned_weights.json'), path.join(backupDir, 'learned_weights.json'))

    // Replace database
    await fs.copyFile(sourceDb, path.join(DATA_DIR, 'database.sqlite'))

    // Replace media folders
    for (const dirName of LIBRARY_DIRS) {
      const currentDir = path.join(DATA_DIR, dirName)
      const sourceDir = path.join(sourceRoot, dirName)

      await fs.rm(currentDir, { recursive: true, force: true })

      try {
        await fs.access(sourceDir)
        await fs.cp(sourceDir, currentDir, { recursive: true, force: true })
      } catch {
        await fs.mkdir(currentDir, { recursive: true })
      }
    }

    // Optional file
    await fs.rm(path.join(DATA_DIR, 'learned_weights.json'), { force: true })
    await copyIfExists(path.join(sourceRoot, 'learned_weights.json'), path.join(DATA_DIR, 'learned_weights.json'))

    res.json({
      success: true,
      importedFrom: libraryPath,
      resolvedLibraryPath: sourceRoot,
      extractedFromZip: resolvedSource.extractedFromZip,
      backupPath: backupDir,
    })
  } catch (error) {
    console.error('Error importing library:', error)
    if (error instanceof LibraryImportValidationError) {
      return res.status(400).json({ error: error.message })
    }
    if (error instanceof LibraryImportRuntimeError) {
      return res.status(500).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to import library' })
  } finally {
    if (cleanupExtractedDir) {
      await fs.rm(cleanupExtractedDir, { recursive: true, force: true }).catch(() => {})
    }
  }
})

export default router
