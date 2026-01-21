import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { db, schema } from '../db/index.js'
import { getAudioDuration } from '../services/ffmpeg.js'
import { v4 as uuidv4 } from 'uuid'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
const SLICES_DIR = path.join(DATA_DIR, 'slices')

// Supported audio formats
const SUPPORTED_FORMATS = ['.wav', '.mp3', '.flac', '.aiff', '.ogg', '.m4a']

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true })
    cb(null, UPLOADS_DIR)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const uniqueName = `${uuidv4()}${ext}`
    cb(null, uniqueName)
  },
})

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (SUPPORTED_FORMATS.includes(ext)) {
    cb(null, true)
  } else {
    cb(new Error(`Unsupported file format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
})

// Import single audio file
router.post('/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  try {
    const originalName = req.file.originalname
    const baseName = path.basename(originalName, path.extname(originalName))
    const uploadedPath = req.file.path

    // Get audio duration
    let duration = 0
    try {
      duration = await getAudioDuration(uploadedPath)
    } catch (err) {
      console.error('Failed to get audio duration:', err)
    }

    // Create a virtual track for this local import
    const localId = `local:${uuidv4()}`
    const [track] = await db
      .insert(schema.tracks)
      .values({
        youtubeId: localId,
        title: baseName,
        description: `Imported from: ${originalName}`,
        thumbnailUrl: '', // No thumbnail for local files
        duration,
        audioPath: uploadedPath,
        status: 'ready',
        source: 'local',
      })
      .returning()

    // Create a slice that spans the entire file
    await fs.mkdir(SLICES_DIR, { recursive: true })
    const sliceFileName = `${localId.replace(':', '_')}_slice.mp3`
    const slicePath = path.join(SLICES_DIR, sliceFileName)

    // Copy the file as a slice (or convert to mp3 if needed)
    const ext = path.extname(originalName).toLowerCase()
    if (ext === '.mp3') {
      await fs.copyFile(uploadedPath, slicePath)
    } else {
      // Convert to mp3 using ffmpeg
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)
      await execAsync(`ffmpeg -i "${uploadedPath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`)
    }

    const [slice] = await db
      .insert(schema.slices)
      .values({
        trackId: track.id,
        name: baseName,
        startTime: 0,
        endTime: duration,
        filePath: slicePath,
      })
      .returning()

    res.json({
      success: true,
      track: {
        id: track.id,
        title: track.title,
        duration: track.duration,
        source: 'local',
      },
      slice: {
        id: slice.id,
        name: slice.name,
        duration,
      },
    })
  } catch (error) {
    console.error('Error importing file:', error)
    // Clean up uploaded file on error
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {})
    }
    res.status(500).json({ error: 'Failed to import file' })
  }
})

// Import multiple files
router.post('/import/files', upload.array('files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[]

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' })
  }

  const results: { filename: string; success: boolean; sliceId?: number; error?: string }[] = []

  for (const file of files) {
    try {
      const originalName = file.originalname
      const baseName = path.basename(originalName, path.extname(originalName))
      const uploadedPath = file.path

      // Get audio duration
      let duration = 0
      try {
        duration = await getAudioDuration(uploadedPath)
      } catch (err) {
        console.error('Failed to get audio duration:', err)
      }

      // Create a virtual track
      const localId = `local:${uuidv4()}`
      const [track] = await db
        .insert(schema.tracks)
        .values({
          youtubeId: localId,
          title: baseName,
          description: `Imported from: ${originalName}`,
          thumbnailUrl: '',
          duration,
          audioPath: uploadedPath,
          status: 'ready',
          source: 'local',
        })
        .returning()

      // Create slice
      await fs.mkdir(SLICES_DIR, { recursive: true })
      const sliceFileName = `${localId.replace(':', '_')}_slice.mp3`
      const slicePath = path.join(SLICES_DIR, sliceFileName)

      const ext = path.extname(originalName).toLowerCase()
      if (ext === '.mp3') {
        await fs.copyFile(uploadedPath, slicePath)
      } else {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        await execAsync(`ffmpeg -i "${uploadedPath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`)
      }

      const [slice] = await db
        .insert(schema.slices)
        .values({
          trackId: track.id,
          name: baseName,
          startTime: 0,
          endTime: duration,
          filePath: slicePath,
        })
        .returning()

      results.push({ filename: originalName, success: true, sliceId: slice.id })
    } catch (error) {
      console.error(`Error importing ${file.originalname}:`, error)
      results.push({
        filename: file.originalname,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      // Clean up on error
      await fs.unlink(file.path).catch(() => {})
    }
  }

  res.json({
    total: files.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  })
})

// Import from folder path (server-side)
router.post('/import/folder', async (req, res) => {
  const { folderPath } = req.body as { folderPath: string }

  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath required' })
  }

  try {
    // Check if folder exists
    const stat = await fs.stat(folderPath)
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' })
    }

    // Scan folder for audio files
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    const audioFiles = entries
      .filter((entry) => {
        if (!entry.isFile()) return false
        const ext = path.extname(entry.name).toLowerCase()
        return SUPPORTED_FORMATS.includes(ext)
      })
      .map((entry) => path.join(folderPath, entry.name))

    if (audioFiles.length === 0) {
      return res.status(400).json({ error: 'No supported audio files found in folder' })
    }

    const results: { filename: string; success: boolean; sliceId?: number; error?: string }[] = []

    for (const filePath of audioFiles) {
      try {
        const originalName = path.basename(filePath)
        const baseName = path.basename(originalName, path.extname(originalName))

        // Get audio duration
        let duration = 0
        try {
          duration = await getAudioDuration(filePath)
        } catch (err) {
          console.error('Failed to get audio duration:', err)
        }

        // Create virtual track
        const localId = `local:${uuidv4()}`
        const [track] = await db
          .insert(schema.tracks)
          .values({
            youtubeId: localId,
            title: baseName,
            description: `Imported from folder: ${folderPath}`,
            thumbnailUrl: '',
            duration,
            audioPath: filePath, // Keep original path
            status: 'ready',
            source: 'local',
          })
          .returning()

        // Create slice
        await fs.mkdir(SLICES_DIR, { recursive: true })
        const sliceFileName = `${localId.replace(':', '_')}_slice.mp3`
        const slicePath = path.join(SLICES_DIR, sliceFileName)

        const ext = path.extname(originalName).toLowerCase()
        if (ext === '.mp3') {
          await fs.copyFile(filePath, slicePath)
        } else {
          const { exec } = await import('child_process')
          const { promisify } = await import('util')
          const execAsync = promisify(exec)
          await execAsync(`ffmpeg -i "${filePath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`)
        }

        const [slice] = await db
          .insert(schema.slices)
          .values({
            trackId: track.id,
            name: baseName,
            startTime: 0,
            endTime: duration,
            filePath: slicePath,
          })
          .returning()

        results.push({ filename: originalName, success: true, sliceId: slice.id })
      } catch (error) {
        console.error(`Error importing ${filePath}:`, error)
        results.push({
          filename: path.basename(filePath),
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      folderPath,
      total: audioFiles.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    })
  } catch (error) {
    console.error('Error importing folder:', error)
    res.status(500).json({ error: 'Failed to import folder' })
  }
})

// Browse directories (server-side)
router.get('/browse', async (req, res) => {
  const { path: browsePath } = req.query as { path?: string }
  const targetPath = browsePath || process.env.HOME || '/'

  try {
    const stat = await fs.stat(targetPath)
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' })
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true })

    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        path: path.join(targetPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const audioFileCount = entries.filter((entry) => {
      if (!entry.isFile()) return false
      const ext = path.extname(entry.name).toLowerCase()
      return SUPPORTED_FORMATS.includes(ext)
    }).length

    // Get parent directory (if not at root)
    const parentPath = path.dirname(targetPath)
    const hasParent = parentPath !== targetPath

    res.json({
      currentPath: targetPath,
      parentPath: hasParent ? parentPath : null,
      directories,
      audioFileCount,
    })
  } catch (error) {
    console.error('Error browsing directory:', error)
    res.status(500).json({ error: 'Failed to browse directory' })
  }
})

export default router
