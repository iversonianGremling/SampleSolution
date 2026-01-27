import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { db, schema } from '../db/index.js'
import { getAudioDuration } from '../services/ffmpeg.js'
import {
  analyzeAudioFeatures,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
} from '../services/audioAnalysis.js'
import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'

const router = Router()

// Simple queue to serialize audio analysis (prevents resource exhaustion)
class AnalysisQueue {
  private running = false
  private queue: Array<() => Promise<void>> = []

  async add(task: () => Promise<void>): Promise<void> {
    this.queue.push(task)
    if (!this.running) {
      await this.processQueue()
    }
  }

  private async processQueue(): Promise<void> {
    if (this.running || this.queue.length === 0) return
    this.running = true

    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (task) {
        try {
          await task()
        } catch (err) {
          console.error('Task in analysis queue failed:', err)
        }
      }
    }

    this.running = false
  }
}

const analysisQueue = new AnalysisQueue()

// Debug middleware to log incoming requests
router.use((req, _res, next) => {
  if (req.path.includes('import')) {
    console.log(`[import debug] ${req.method} ${req.path}`)
    console.log(`[import debug] Headers:`, req.headers)
  }
  next()
})

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
  console.log(`[multer] Received field: "${file.fieldname}", filename: "${file.originalname}"`)
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
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max per file
    files: 100, // Max 100 files
  },
})

// Helper function to auto-tag a slice using audio analysis
async function autoTagSlice(sliceId: number, audioPath: string): Promise<void> {
  try {
    console.log(`Analyzing audio features for slice ${sliceId} from: ${audioPath}`)

    // Verify file exists before analysis
    try {
      await fs.stat(audioPath)
    } catch {
      throw new Error(`Audio file not found: ${audioPath}`)
    }

    // Analyze audio with Python (Essentia + Librosa)
    const features = await analyzeAudioFeatures(audioPath)

    console.log(`Analysis complete for slice ${sliceId}:`, {
      isOneShot: features.isOneShot,
      isLoop: features.isLoop,
      bpm: features.bpm,
      spectralCentroid: features.spectralCentroid.toFixed(1),
      analysisDurationMs: features.analysisDurationMs,
    })

    // Store raw features in database
    await storeAudioFeatures(sliceId, features)

    // Convert features to tags
    const tagNames = featuresToTags(features)

    if (tagNames.length === 0) {
      console.log(`No tags generated for slice ${sliceId}`)
      return
    }

    console.log(`Applying ${tagNames.length} tags to slice ${sliceId}:`, tagNames.join(', '))

    // Create tags and link them to the slice
    for (const tagName of tagNames) {
      const lowerTag = tagName.toLowerCase()
      const { color, category } = getTagMetadata(lowerTag)

      try {
        // Check if tag exists
        let tag = await db
          .select()
          .from(schema.tags)
          .where(eq(schema.tags.name, lowerTag))
          .limit(1)

        // Create tag if it doesn't exist
        if (tag.length === 0) {
          const [newTag] = await db
            .insert(schema.tags)
            .values({
              name: lowerTag,
              color,
              category,
            })
            .returning()
          tag = [newTag]
        }

        // Link tag to slice
        await db
          .insert(schema.sliceTags)
          .values({ sliceId, tagId: tag[0].id })
          .onConflictDoNothing()
      } catch (error) {
        console.error(`Failed to add tag ${lowerTag} to slice ${sliceId}:`, error)
      }
    }

    console.log(`Successfully auto-tagged slice ${sliceId}`)
  } catch (error) {
    console.error(`Error analyzing slice ${sliceId}:`, error)
    // Don't throw - audio analysis is optional
  }
}

// Import single audio file
router.post('/import/file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  try {
    const originalName = req.file.originalname
    const baseName = path.basename(originalName, path.extname(originalName))
    const uploadedPath = req.file.path
    const importType = req.query?.importType as 'sample' | 'track' | undefined

    console.log('[import/file] importType from query:', importType)

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
        originalPath: originalName, // Store original filename for individual imports
        folderPath: null, // No folder for individual file imports
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
      try {
        await execAsync(`ffmpeg -i "${uploadedPath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`, {
          timeout: 30000,
        })
      } catch (ffErr) {
        // Clean up partial file
        await fs.unlink(slicePath).catch(() => {})
        throw new Error(`Audio conversion failed: ${ffErr instanceof Error ? ffErr.message : String(ffErr)}`)
      }
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

    // If importing as sample, automatically analyze audio features (queued)
    if (importType === 'sample') {
      analysisQueue.add(async () => {
        try {
          await autoTagSlice(slice.id, slicePath)
        } catch (err) {
          console.error('Background audio analysis failed:', err)
        }
      })
    }

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
router.post('/import/files', upload.array('files', 100), async (req, res) => {
  console.log('[import/files] Request query:', req.query)
  console.log('[import/files] Request files:', req.files)
  const files = req.files as Express.Multer.File[]
  const importType = req.query?.importType as 'sample' | 'track' | undefined

  console.log('[import/files] importType from query:', importType)

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
          originalPath: originalName, // Store original filename for individual imports
          folderPath: null, // No folder for batch file imports
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
        try {
          await execAsync(`ffmpeg -i "${uploadedPath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`, {
            timeout: 30000,
          })
        } catch (ffErr) {
          // Clean up partial file
          await fs.unlink(slicePath).catch(() => {})
          throw new Error(`Audio conversion failed: ${ffErr instanceof Error ? ffErr.message : String(ffErr)}`)
        }
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

      // If importing as sample, automatically analyze audio features (queued)
      if (importType === 'sample') {
        analysisQueue.add(async () => {
          try {
            await autoTagSlice(slice.id, slicePath)
          } catch (err) {
            console.error('Background audio analysis failed:', err)
          }
        })
      }

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
  const { folderPath, importType } = req.body as { folderPath: string; importType?: 'sample' | 'track' }

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
            originalPath: filePath, // Store full original file path
            folderPath: folderPath, // Store the folder used for import
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
          try {
            await execAsync(`ffmpeg -i "${filePath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`, {
              timeout: 30000,
            })
          } catch (ffErr) {
            // Clean up partial file
            await fs.unlink(slicePath).catch(() => {})
            throw new Error(`Audio conversion failed: ${ffErr instanceof Error ? ffErr.message : String(ffErr)}`)
          }
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

        // If importing as sample, automatically analyze audio features (queued)
        if (importType === 'sample') {
          analysisQueue.add(async () => {
            try {
              await autoTagSlice(slice.id, slicePath)
            } catch (err) {
              console.error('Background audio analysis failed:', err)
            }
          })
        }

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

// Error handling middleware for multer
router.use(
  (
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err)
      if (err.code === 'LIMIT_FILE_COUNT') {
        res.status(400).json({ error: 'Too many files. Maximum is 100 files.' })
        return
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File too large. Maximum is 500MB per file.' })
        return
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        res.status(400).json({ error: 'Unexpected field in request' })
        return
      }
      res.status(400).json({ error: `Upload error: ${err.message}` })
      return
    }
    if (err) {
      console.error('Upload error:', err)
      res.status(500).json({ error: 'Upload failed' })
      return
    }
  }
)

export default router
