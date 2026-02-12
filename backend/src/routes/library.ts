import { Router } from 'express'
import fs from 'fs/promises'
import path from 'path'
import { resetDbConnection } from '../db/index.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

const LIBRARY_DIRS = ['audio', 'slices', 'peaks', 'uploads']

async function copyIfExists(src: string, dest: string): Promise<void> {
  try {
    await fs.access(src)
    await fs.cp(src, dest, { recursive: true, force: true })
  } catch {
    // Source missing is acceptable (e.g. optional dirs/files)
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

  const sourceDb = path.join(libraryPath, 'database.sqlite')
  const manifestPath = path.join(libraryPath, 'library-manifest.json')

  try {
    await fs.access(sourceDb)
    await fs.access(manifestPath)
  } catch {
    return res.status(400).json({ error: 'Invalid library package path (missing database.sqlite or library-manifest.json)' })
  }

  try {
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
      const sourceDir = path.join(libraryPath, dirName)

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
    await copyIfExists(path.join(libraryPath, 'learned_weights.json'), path.join(DATA_DIR, 'learned_weights.json'))

    res.json({
      success: true,
      importedFrom: libraryPath,
      backupPath: backupDir,
    })
  } catch (error) {
    console.error('Error importing library:', error)
    res.status(500).json({ error: 'Failed to import library' })
  }
})

export default router
