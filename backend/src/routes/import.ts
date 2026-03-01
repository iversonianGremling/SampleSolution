import { Router, Request, Response, NextFunction, json } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { db, schema } from '../db/index.js'
import { getAudioDuration, getAudioFileMetadata, FFMPEG_BIN, type AudioFileMetadata } from '../services/ffmpeg.js'
import {
  analyzeAudioFeatures,
  buildSamplePathHint,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
  parseFilenameTagsSmart,
  postAnalyzeSampleTags,
} from '../services/audioAnalysis.js'
import { v4 as uuidv4 } from 'uuid'
import { and, eq, isNotNull, sql } from 'drizzle-orm'

const router = Router()
router.use(json())

// Simple queue to serialize audio analysis (prevents resource exhaustion)
class AnalysisQueue {
  private running = false
  private queue: Array<() => Promise<void>> = []
  private activeTaskCount = 0

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
        this.activeTaskCount += 1
        try {
          await task()
        } catch (err) {
          console.error('Task in analysis queue failed:', err)
        } finally {
          this.activeTaskCount = Math.max(0, this.activeTaskCount - 1)
        }
      }
    }

    this.running = false
  }

  getStatus() {
    return {
      running: this.running,
      activeTaskCount: this.activeTaskCount,
      queuedTaskCount: this.queue.length,
      isActive: this.running || this.queue.length > 0 || this.activeTaskCount > 0,
    }
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

router.get('/import/analysis-status', (_req, res) => {
  res.json(analysisQueue.getStatus())
})

const DATA_DIR = process.env.DATA_DIR || './data'
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
const SLICES_DIR = path.join(DATA_DIR, 'slices')
const USE_REFERENCE_IMPORTS = process.env.LOCAL_IMPORT_MODE === 'reference'
const TRACK_IMPORT_FILENAME_TAG_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.TRACK_IMPORT_FILENAME_TAG_LIMIT ?? '1', 10) || 1
)

// Supported audio formats
const SUPPORTED_FORMATS = ['.wav', '.mp3', '.flac', '.aiff', '.ogg', '.m4a']

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizeFilesystemPath(value: string): string {
  return normalizeRelativePath(value)
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = normalizeFilesystemPath(rootPath)
  const normalizedCandidate = normalizeFilesystemPath(candidatePath)
  if (!normalizedRoot || !normalizedCandidate) return false
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}

async function getImportedFolderRootsOnDisk(): Promise<string[]> {
  const rows = await db
    .select({ folderPath: schema.tracks.folderPath })
    .from(schema.tracks)
    .where(and(
      eq(schema.tracks.source, 'local'),
      isNotNull(schema.tracks.folderPath)
    ))
    .groupBy(schema.tracks.folderPath)

  const uniqueRoots = new Set<string>()
  for (const row of rows) {
    if (!row.folderPath) continue
    if (!path.isAbsolute(row.folderPath)) continue
    try {
      const realPath = await fs.realpath(row.folderPath)
      const normalized = normalizeFilesystemPath(realPath)
      if (normalized) uniqueRoots.add(normalized)
    } catch {
      // Source folder may no longer exist on disk; ignore.
    }
  }

  return Array.from(uniqueRoots)
}

function parseBrowserRelativePath(rawValue: unknown): {
  folderPath: string | null
  relativePath: string | null
} {
  const parts = parseBrowserRelativePathParts(rawValue)
  if (!parts) return { folderPath: null, relativePath: null }

  return {
    folderPath: parts[0] || null,
    relativePath: parts.slice(1).join('/') || null,
  }
}

function parseBrowserRelativePathParts(rawValue: unknown): string[] | null {
  if (typeof rawValue !== 'string') return null

  const trimmed = rawValue.trim()
  if (!trimmed) return null

  const normalized = normalizeRelativePath(trimmed)
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')

  if (!normalized) return null

  const parts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length < 2) return null
  if (parts.some((part) => part === '.' || part === '..')) return null

  return parts
}

function parseAbsolutePathHint(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null
  const trimmed = rawValue.trim()
  if (!trimmed) return null
  if (!path.isAbsolute(trimmed)) return null
  return path.resolve(trimmed)
}

function parseBodyStringArray(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue.map((value) => String(value ?? ''))
  }
  if (typeof rawValue === 'string') {
    return [rawValue]
  }
  return []
}

async function resolveReferenceFilePath(absolutePathHint: unknown): Promise<string | null> {
  const resolvedHint = parseAbsolutePathHint(absolutePathHint)
  if (!resolvedHint) return null

  try {
    const stat = await fs.stat(resolvedHint)
    if (!stat.isFile()) return null
    return resolvedHint
  } catch {
    return null
  }
}

function resolveImportType(rawValue: unknown): 'sample' | 'track' {
  if (typeof rawValue !== 'string') return 'sample'
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'track') return 'track'
  return 'sample'
}

function logIgnoredAllowAiTagging(rawValue: unknown, routePath: string): void {
  if (rawValue === undefined || rawValue === null) return
  console.warn(
    `[import] Ignoring allowAiTagging override on ${routePath}; ` +
      'import tagging always runs deterministic fallbacks with AI as final fallback.'
  )
}

async function resolveImportSourcePath(
  uploadedPath: string,
  absolutePathHint: unknown,
): Promise<{ sourcePath: string; usingReferencePath: boolean; shouldDeleteUploadedCopy: boolean }> {
  if (!USE_REFERENCE_IMPORTS) {
    return { sourcePath: uploadedPath, usingReferencePath: false, shouldDeleteUploadedCopy: false }
  }

  const resolvedHint = await resolveReferenceFilePath(absolutePathHint)
  if (!resolvedHint) {
    return { sourcePath: uploadedPath, usingReferencePath: false, shouldDeleteUploadedCopy: false }
  }

  const uploadedResolved = path.resolve(uploadedPath)
  return {
    sourcePath: resolvedHint,
    usingReferencePath: true,
    shouldDeleteUploadedCopy: uploadedResolved !== resolvedHint,
  }
}

function resolveImportPathMetadata(
  rawRelativePath: unknown,
  sourcePath: string,
  usingReferencePath: boolean,
): { folderPath: string | null; relativePath: string | null } {
  const fallback = parseBrowserRelativePath(rawRelativePath)

  if (!usingReferencePath) {
    return fallback
  }

  const parts = parseBrowserRelativePathParts(rawRelativePath)
  if (!parts) {
    return {
      folderPath: null,
      relativePath: null,
    }
  }

  const relativePath = parts.slice(1).join('/')
  if (!relativePath) {
    return {
      folderPath: null,
      relativePath: null,
    }
  }

  const levelsToRoot = Math.max(parts.length - 2, 0)
  const parentParts = levelsToRoot > 0 ? new Array(levelsToRoot).fill('..') : []
  const rootCandidate = path.resolve(path.dirname(sourcePath), ...parentParts)

  return {
    folderPath: normalizeFilesystemPath(rootCandidate),
    relativePath: normalizeRelativePath(relativePath),
  }
}

async function collectAudioFilesRecursively(rootDir: string): Promise<string[]> {
  const files: string[] = []

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (!entry.isFile()) continue

      const ext = path.extname(entry.name).toLowerCase()
      if (SUPPORTED_FORMATS.includes(ext)) {
        files.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  files.sort((a, b) => a.localeCompare(b))
  return files
}

function toTrackMetadata(sourceMetadata: AudioFileMetadata | null) {
  return {
    title: sourceMetadata?.title ?? null,
    artist: sourceMetadata?.artist ?? null,
    album: sourceMetadata?.album ?? null,
    year: sourceMetadata?.year ?? null,
    albumArtist: sourceMetadata?.albumArtist ?? null,
    genre: sourceMetadata?.genre ?? null,
    composer: sourceMetadata?.composer ?? null,
    trackNumber: sourceMetadata?.trackNumber ?? null,
    discNumber: sourceMetadata?.discNumber ?? null,
    trackComment: sourceMetadata?.trackComment ?? null,
    musicalKey: sourceMetadata?.musicalKey ?? null,
    tagBpm: sourceMetadata?.tagBpm ?? null,
    isrc: sourceMetadata?.isrc ?? null,
    metadataRaw: sourceMetadata?.metadataRaw ?? null,
  }
}

async function replaceInstrumentTagsForSlice(
  sliceId: number,
  reviewedTags: Array<{ name: string; category: 'instrument' }>
): Promise<void> {
  await db.run(sql`
    DELETE FROM slice_tags WHERE slice_id = ${sliceId}
    AND tag_id IN (
      SELECT id FROM tags WHERE category = 'instrument'
    )
  `)

  if (reviewedTags.length === 0) return

  for (const reviewedTag of reviewedTags) {
    const lowerTag = reviewedTag.name.toLowerCase()
    const { color, category } = getTagMetadata(lowerTag, reviewedTag.category)

    let tag = await db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.name, lowerTag))
      .limit(1)

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
    } else if (tag[0].category === 'filename' && category !== 'filename') {
      await db
        .update(schema.tags)
        .set({
          color,
          category,
        })
        .where(eq(schema.tags.id, tag[0].id))
    }

    await db
      .insert(schema.sliceTags)
      .values({ sliceId, tagId: tag[0].id })
      .onConflictDoNothing()
  }
}

async function seedFilenameTagsForSlice(options: {
  sliceId: number
  filename: string
  folderPath: string | null
  relativePath?: string | null
}): Promise<void> {
  if (TRACK_IMPORT_FILENAME_TAG_LIMIT <= 0) return

  const pathHint = buildSamplePathHint({
    folderPath: options.folderPath,
    relativePath: options.relativePath,
    filename: options.filename,
  })
  const filenameTags = await parseFilenameTagsSmart(options.filename, pathHint)
  const conciseTags = filenameTags.slice(0, TRACK_IMPORT_FILENAME_TAG_LIMIT)

  for (const filenameTag of conciseTags) {
    const lowerTag = filenameTag.tag.toLowerCase()
    const metadata = getTagMetadata(lowerTag, filenameTag.category)
    let tag = await db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.name, lowerTag))
      .limit(1)

    if (tag.length === 0) {
      const [newTag] = await db
        .insert(schema.tags)
        .values({
          name: lowerTag,
          color: metadata.color,
          category: metadata.category,
        })
        .returning()
      tag = [newTag]
    } else if (tag[0].category === 'filename' && metadata.category !== 'filename') {
      await db
        .update(schema.tags)
        .set({
          color: metadata.color,
          category: metadata.category,
        })
        .where(eq(schema.tags.id, tag[0].id))
    }

    await db
      .insert(schema.sliceTags)
      .values({ sliceId: options.sliceId, tagId: tag[0].id })
      .onConflictDoNothing()
  }

  if (filenameTags.length > conciseTags.length) {
    console.log(
      `[import] trimmed filename tag seed for slice ${options.sliceId}: ` +
        `${filenameTags.length} -> ${conciseTags.length}`
    )
  }
}

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
  },
})

// Helper function to auto-tag a slice using audio analysis
async function autoTagSlice(sliceId: number, audioPath: string): Promise<void> {
  try {
    const level: 'advanced' = 'advanced'
    console.log(`Analyzing audio features for slice ${sliceId} from: ${audioPath} (level: ${level})`)

    const sliceContext = await db
      .select({
        name: schema.slices.name,
        folderPath: schema.tracks.folderPath,
        relativePath: schema.tracks.relativePath,
      })
      .from(schema.slices)
      .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    const pathHint = buildSamplePathHint({
      folderPath: sliceContext[0]?.folderPath ?? null,
      relativePath: sliceContext[0]?.relativePath ?? null,
      filename: sliceContext[0]?.name ?? null,
    })

    // Verify file exists before analysis
    try {
      await fs.stat(audioPath)
    } catch {
      throw new Error(`Audio file not found: ${audioPath}`)
    }

    // Analyze audio with Python (Essentia + Librosa)
    const features = await analyzeAudioFeatures(audioPath, level, {
      filename: sliceContext[0]?.name ?? undefined,
    })
    const fileMetadata = await getAudioFileMetadata(audioPath).catch(() => null)

    const enrichedFeatures = {
      ...features,
      sampleRate: fileMetadata?.sampleRate ?? features.sampleRate,
      channels: fileMetadata?.channels ?? undefined,
      fileFormat: fileMetadata?.format ?? undefined,
      sourceMtime: fileMetadata?.modifiedAt ?? undefined,
      sourceCtime: fileMetadata?.createdAt ?? undefined,
    }

    console.log(`Analysis complete for slice ${sliceId}:`, {
      isOneShot: features.isOneShot,
      isLoop: features.isLoop,
      bpm: features.bpm,
      spectralCentroid: features.spectralCentroid.toFixed(1),
      analysisDurationMs: features.analysisDurationMs,
    })

    // Store raw features in database
    await storeAudioFeatures(sliceId, enrichedFeatures, {
      sampleName: sliceContext[0]?.name ?? null,
      pathHint,
      preferPathHint: true,
    })

    const reviewedTags = await postAnalyzeSampleTags({
      features,
      sampleName: sliceContext[0]?.name ?? null,
      folderPath: pathHint,
      modelTags: featuresToTags(features),
    })

    if (reviewedTags.length === 0) {
      console.log(`No tags generated for slice ${sliceId}`)
    } else {
      console.log(
        `Applying ${reviewedTags.length} reviewed tags to slice ${sliceId}:`,
        reviewedTags.map((tag) => tag.name).join(', ')
      )
    }

    await replaceInstrumentTagsForSlice(sliceId, reviewedTags)
    console.log(`Successfully auto-tagged slice ${sliceId}`)
  } catch (error) {
    console.error(`Error analyzing slice ${sliceId}:`, error)
    // Don't throw - audio analysis is optional
  }
}

// Import single audio file
router.post('/import/file', upload.single('file'), async (req, res) => {
  const uploadedFile = req.file
  const directReferencePath = !uploadedFile
    ? await resolveReferenceFilePath(req.body?.absolutePath)
    : null

  if (!uploadedFile && req.body?.absolutePath !== undefined && !directReferencePath) {
    return res.status(400).json({ error: 'absolutePath must be an existing absolute file path' })
  }

  if (!uploadedFile && !directReferencePath) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  try {
    const importType = resolveImportType(req.query?.importType)
    logIgnoredAllowAiTagging(req.query?.allowAiTagging, '/import/file')
    let originalName = ''
    let baseName = ''
    let sourcePath = ''
    let usingReferencePath = false
    let shouldDeleteUploadedCopy = false
    let uploadedPath: string | null = null

    if (uploadedFile) {
      originalName = uploadedFile.originalname
      baseName = path.basename(originalName, path.extname(originalName))
      uploadedPath = uploadedFile.path
      const resolvedSourcePath = await resolveImportSourcePath(uploadedPath, req.body?.absolutePath)
      sourcePath = resolvedSourcePath.sourcePath
      usingReferencePath = resolvedSourcePath.usingReferencePath
      shouldDeleteUploadedCopy = resolvedSourcePath.shouldDeleteUploadedCopy
    } else {
      sourcePath = directReferencePath as string
      originalName = path.basename(sourcePath)
      baseName = path.basename(originalName, path.extname(originalName))
      usingReferencePath = true
    }

    const { folderPath: browserFolderPath, relativePath: browserRelativePath } =
      resolveImportPathMetadata(req.body?.relativePath, sourcePath, usingReferencePath)

    console.log('[import/file] importType from query:', importType)

    // Get audio duration
    let duration = 0
    try {
      duration = await getAudioDuration(sourcePath)
    } catch (err) {
      console.error('Failed to get audio duration:', err)
    }
    const sourceMetadata = await getAudioFileMetadata(sourcePath).catch(() => null)
    const trackMetadata = toTrackMetadata(sourceMetadata)
    const trackTitle = trackMetadata.title ?? baseName

    // Create a virtual track for this local import
    const localId = `local:${uuidv4()}`
    const [track] = await db
      .insert(schema.tracks)
      .values({
        youtubeId: localId,
        title: trackTitle,
        description: `Imported from: ${originalName}`,
        thumbnailUrl: '', // No thumbnail for local files
        duration,
        audioPath: sourcePath,
        status: 'ready',
        artist: trackMetadata.artist,
        album: trackMetadata.album,
        year: trackMetadata.year,
        albumArtist: trackMetadata.albumArtist,
        genre: trackMetadata.genre,
        composer: trackMetadata.composer,
        trackNumber: trackMetadata.trackNumber,
        discNumber: trackMetadata.discNumber,
        trackComment: trackMetadata.trackComment,
        musicalKey: trackMetadata.musicalKey,
        tagBpm: trackMetadata.tagBpm,
        isrc: trackMetadata.isrc,
        metadataRaw: trackMetadata.metadataRaw,
        source: 'local',
        originalPath: usingReferencePath ? sourcePath : (browserRelativePath || originalName),
        folderPath: browserFolderPath,
        relativePath: browserRelativePath,
        fullPathHint: usingReferencePath ? sourcePath : null,
      })
      .returning()

    let slicePath = sourcePath
    if (!usingReferencePath) {
      // Browser uploads without trusted absolute paths are copied into the managed slice storage.
      await fs.mkdir(SLICES_DIR, { recursive: true })
      const sliceFileName = `${localId.replace(':', '_')}_slice.mp3`
      slicePath = path.join(SLICES_DIR, sliceFileName)

      const ext = path.extname(originalName).toLowerCase()
      if (ext === '.mp3') {
        await fs.copyFile(sourcePath, slicePath)
      } else {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        try {
          await execAsync(`"${FFMPEG_BIN}" -i "${sourcePath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`, {
            timeout: 30000,
          })
        } catch (ffErr) {
          // Clean up partial file
          await fs.unlink(slicePath).catch(() => {})
          throw new Error(`Audio conversion failed: ${ffErr instanceof Error ? ffErr.message : String(ffErr)}`)
        }
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

    // For sample imports, defer to full analysis + reviewed-tag replacement so the
    // tag outcome matches batch re-analysis behavior.
    if (importType !== 'sample') {
      try {
        await seedFilenameTagsForSlice({
          sliceId: slice.id,
          filename: originalName,
          folderPath: browserFolderPath,
          relativePath: browserRelativePath,
        })
      } catch (err) {
        console.error('Filename tagging failed:', err)
      }
    }

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

    if (shouldDeleteUploadedCopy && uploadedPath) {
      await fs.unlink(uploadedPath).catch(() => {})
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
    if (uploadedFile?.path) {
      await fs.unlink(uploadedFile.path).catch(() => {})
    }
    res.status(500).json({ error: 'Failed to import file' })
  }
})

router.get('/import/files', (_req, res) => {
  res.status(405).json({
    error: 'Method not allowed. Use POST /api/import/files with multipart/form-data.',
  })
})

// Import multiple files
router.post('/import/files', upload.array('files'), async (req, res) => {
  console.log('[import/files] Request query:', req.query)
  console.log('[import/files] Request files:', req.files)
  const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : []
  const relativePaths = parseBodyStringArray(req.body?.relativePaths)
  const absolutePaths = parseBodyStringArray(req.body?.absolutePaths)
  const referencePaths = parseBodyStringArray(req.body?.referencePaths)
  const importType = resolveImportType(req.query?.importType)
  logIgnoredAllowAiTagging(req.query?.allowAiTagging, '/import/files')

  console.log('[import/files] importType from query:', importType)

  const useUploadedFiles = files.length > 0
  const useReferencePaths = !useUploadedFiles && referencePaths.length > 0

  if (!useUploadedFiles && !useReferencePaths) {
    return res.status(400).json({ error: 'No files uploaded' })
  }

  type ImportFileEntry =
    | { kind: 'uploaded'; file: Express.Multer.File; index: number }
    | { kind: 'reference'; absolutePath: string; index: number }

  const importEntries: ImportFileEntry[] = useUploadedFiles
    ? files.map((file, index) => ({ kind: 'uploaded', file, index }))
    : referencePaths.map((absolutePath, index) => ({ kind: 'reference', absolutePath, index }))

  const results: { filename: string; success: boolean; sliceId?: number; error?: string }[] = []

  for (const entry of importEntries) {
    try {
      let originalName = ''
      let baseName = ''
      let sourcePath = ''
      let usingReferencePath = false
      let shouldDeleteUploadedCopy = false
      let uploadedPath: string | null = null

      if (entry.kind === 'uploaded') {
        originalName = entry.file.originalname
        baseName = path.basename(originalName, path.extname(originalName))
        uploadedPath = entry.file.path
        const resolvedSourcePath = await resolveImportSourcePath(uploadedPath, absolutePaths[entry.index])
        sourcePath = resolvedSourcePath.sourcePath
        usingReferencePath = resolvedSourcePath.usingReferencePath
        shouldDeleteUploadedCopy = resolvedSourcePath.shouldDeleteUploadedCopy
      } else {
        const resolvedReferencePath = await resolveReferenceFilePath(entry.absolutePath)
        if (!resolvedReferencePath) {
          throw new Error('absolutePath must be an existing absolute file path')
        }
        sourcePath = resolvedReferencePath
        originalName = path.basename(sourcePath)
        baseName = path.basename(originalName, path.extname(originalName))
        usingReferencePath = true
      }

      const { folderPath: browserFolderPath, relativePath: browserRelativePath } =
        resolveImportPathMetadata(relativePaths[entry.index], sourcePath, usingReferencePath)

      // Get audio duration
      let duration = 0
      try {
        duration = await getAudioDuration(sourcePath)
      } catch (err) {
        console.error('Failed to get audio duration:', err)
      }
      const sourceMetadata = await getAudioFileMetadata(sourcePath).catch(() => null)
      const trackMetadata = toTrackMetadata(sourceMetadata)
      const trackTitle = trackMetadata.title ?? baseName

      // Create a virtual track
      const localId = `local:${uuidv4()}`
      const [track] = await db
        .insert(schema.tracks)
        .values({
          youtubeId: localId,
          title: trackTitle,
          description: `Imported from: ${originalName}`,
          thumbnailUrl: '',
          duration,
          audioPath: sourcePath,
          status: 'ready',
          artist: trackMetadata.artist,
          album: trackMetadata.album,
          year: trackMetadata.year,
          albumArtist: trackMetadata.albumArtist,
          genre: trackMetadata.genre,
          composer: trackMetadata.composer,
          trackNumber: trackMetadata.trackNumber,
          discNumber: trackMetadata.discNumber,
          trackComment: trackMetadata.trackComment,
          musicalKey: trackMetadata.musicalKey,
          tagBpm: trackMetadata.tagBpm,
          isrc: trackMetadata.isrc,
          metadataRaw: trackMetadata.metadataRaw,
          source: 'local',
          originalPath: usingReferencePath ? sourcePath : (browserRelativePath || originalName),
          folderPath: browserFolderPath,
          relativePath: browserRelativePath,
          fullPathHint: usingReferencePath ? sourcePath : null,
        })
        .returning()

      let slicePath = sourcePath
      if (!usingReferencePath) {
        await fs.mkdir(SLICES_DIR, { recursive: true })
        const sliceFileName = `${localId.replace(':', '_')}_slice.mp3`
        slicePath = path.join(SLICES_DIR, sliceFileName)

        const ext = path.extname(originalName).toLowerCase()
        if (ext === '.mp3') {
          await fs.copyFile(sourcePath, slicePath)
        } else {
          const { exec } = await import('child_process')
          const { promisify } = await import('util')
          const execAsync = promisify(exec)
          try {
            await execAsync(`"${FFMPEG_BIN}" -i "${sourcePath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`, {
              timeout: 30000,
            })
          } catch (ffErr) {
            // Clean up partial file
            await fs.unlink(slicePath).catch(() => {})
            throw new Error(`Audio conversion failed: ${ffErr instanceof Error ? ffErr.message : String(ffErr)}`)
          }
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

      if (importType !== 'sample') {
        // For sample imports, defer to full analysis + reviewed-tag replacement so the
        // tag outcome matches batch re-analysis behavior.
        try {
          await seedFilenameTagsForSlice({
            sliceId: slice.id,
            filename: originalName,
            folderPath: browserFolderPath,
            relativePath: browserRelativePath,
          })
        } catch (err) {
          console.error('Filename tagging failed:', err)
        }
      }

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

      if (shouldDeleteUploadedCopy && uploadedPath) {
        await fs.unlink(uploadedPath).catch(() => {})
      }

      results.push({ filename: originalName, success: true, sliceId: slice.id })
    } catch (error) {
      const failedFilename = entry.kind === 'uploaded'
        ? entry.file.originalname
        : path.basename(entry.absolutePath || `reference-${entry.index + 1}`)
      console.error(`Error importing ${failedFilename}:`, error)
      results.push({
        filename: failedFilename,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      // Clean up on error
      if (entry.kind === 'uploaded') {
        await fs.unlink(entry.file.path).catch(() => {})
      }
    }
  }

  res.json({
    total: importEntries.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  })
})

// Import from folder path (server-side)
router.post('/import/folder', async (req, res) => {
  const { folderPath } = req.body as {
    folderPath: string
    importType?: 'sample' | 'track'
  }
  const importType = resolveImportType(req.body?.importType)
  logIgnoredAllowAiTagging(req.body?.allowAiTagging, '/import/folder')

  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath required' })
  }

  try {
    // Check if folder exists
    const stat = await fs.stat(folderPath)
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' })
    }

    const folderRootPath = path.resolve(folderPath)

    // Scan folder recursively for audio files and preserve subdirectories.
    const audioFiles = await collectAudioFilesRecursively(folderRootPath)

    if (audioFiles.length === 0) {
      return res.status(400).json({ error: 'No supported audio files found in folder' })
    }

    const results: { filename: string; success: boolean; sliceId?: number; error?: string }[] = []

    for (const filePath of audioFiles) {
      try {
        const originalName = path.basename(filePath)
        const relativePath = normalizeRelativePath(path.relative(folderRootPath, filePath))
        const baseName = path.basename(originalName, path.extname(originalName))

        // Get audio duration
        let duration = 0
        try {
          duration = await getAudioDuration(filePath)
        } catch (err) {
          console.error('Failed to get audio duration:', err)
        }

        const sourceMetadata = await getAudioFileMetadata(filePath).catch(() => null)
        const trackMetadata = toTrackMetadata(sourceMetadata)
        const trackTitle = trackMetadata.title ?? baseName

        // Create virtual track
        const localId = `local:${uuidv4()}`
        const [track] = await db
          .insert(schema.tracks)
          .values({
            youtubeId: localId,
            title: trackTitle,
            description: `Imported from folder: ${folderRootPath}`,
            thumbnailUrl: '',
            duration,
            audioPath: filePath, // Keep original path
            status: 'ready',
            artist: trackMetadata.artist,
            album: trackMetadata.album,
            year: trackMetadata.year,
            albumArtist: trackMetadata.albumArtist,
            genre: trackMetadata.genre,
            composer: trackMetadata.composer,
            trackNumber: trackMetadata.trackNumber,
            discNumber: trackMetadata.discNumber,
            trackComment: trackMetadata.trackComment,
            musicalKey: trackMetadata.musicalKey,
            tagBpm: trackMetadata.tagBpm,
            isrc: trackMetadata.isrc,
            metadataRaw: trackMetadata.metadataRaw,
            source: 'local',
            originalPath: filePath, // Store full original file path
            folderPath: folderRootPath, // Store the folder used for import
            relativePath, // Preserve structure relative to imported folder root
            fullPathHint: filePath,
          })
          .returning()

        let slicePath = filePath
        if (!USE_REFERENCE_IMPORTS) {
          await fs.mkdir(SLICES_DIR, { recursive: true })
          const sliceFileName = `${localId.replace(':', '_')}_slice.mp3`
          slicePath = path.join(SLICES_DIR, sliceFileName)

          const ext = path.extname(originalName).toLowerCase()
          if (ext === '.mp3') {
            await fs.copyFile(filePath, slicePath)
          } else {
            const { exec } = await import('child_process')
            const { promisify } = await import('util')
            const execAsync = promisify(exec)
            try {
              await execAsync(`"${FFMPEG_BIN}" -i "${filePath}" -acodec libmp3lame -q:a 2 "${slicePath}" -y`, {
                timeout: 30000,
              })
            } catch (ffErr) {
              // Clean up partial file
              await fs.unlink(slicePath).catch(() => {})
              throw new Error(`Audio conversion failed: ${ffErr instanceof Error ? ffErr.message : String(ffErr)}`)
            }
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

        if (importType !== 'sample') {
          // For sample imports, defer to full analysis + reviewed-tag replacement so the
          // tag outcome matches batch re-analysis behavior.
          try {
            await seedFilenameTagsForSlice({
              sliceId: slice.id,
              filename: originalName,
              folderPath: folderRootPath,
              relativePath,
            })
          } catch (err) {
            console.error('Filename tagging failed:', err)
          }
        }

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

        results.push({ filename: relativePath || originalName, success: true, sliceId: slice.id })
      } catch (error) {
        console.error(`Error importing ${filePath}:`, error)
        results.push({
          filename: normalizeRelativePath(path.relative(folderRootPath, filePath)) || path.basename(filePath),
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      folderPath: folderRootPath,
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

// Create a real subfolder under an imported source folder.
router.post('/import/folders', async (req, res) => {
  const { parentPath, name } = req.body as { parentPath?: string; name?: string }

  const trimmedParentPath = typeof parentPath === 'string' ? parentPath.trim() : ''
  const trimmedName = typeof name === 'string' ? name.trim() : ''

  if (!trimmedParentPath) {
    return res.status(400).json({ error: 'parentPath required' })
  }

  if (!trimmedName) {
    return res.status(400).json({ error: 'name required' })
  }

  if (
    trimmedName === '.' ||
    trimmedName === '..' ||
    trimmedName.includes('/') ||
    trimmedName.includes('\\')
  ) {
    return res.status(400).json({ error: 'Invalid folder name' })
  }

  try {
    const importedRoots = await getImportedFolderRootsOnDisk()
    if (importedRoots.length === 0) {
      return res.status(400).json({ error: 'No imported source folders available' })
    }

    const parentRealPath = await fs.realpath(trimmedParentPath)
    const parentStats = await fs.stat(parentRealPath)
    if (!parentStats.isDirectory()) {
      return res.status(400).json({ error: 'parentPath is not a directory' })
    }

    const normalizedParentPath = normalizeFilesystemPath(parentRealPath)
    const matchingRoot = importedRoots.find((rootPath) => isPathWithin(rootPath, normalizedParentPath))
    if (!matchingRoot) {
      return res.status(403).json({ error: 'parentPath must be inside an imported source folder' })
    }

    const createdPath = path.join(parentRealPath, trimmedName)
    const normalizedCreatedPath = normalizeFilesystemPath(createdPath)
    if (!isPathWithin(matchingRoot, normalizedCreatedPath)) {
      return res.status(400).json({ error: 'Invalid folder path' })
    }

    await fs.mkdir(createdPath, { recursive: false })

    res.json({
      success: true,
      path: normalizedCreatedPath,
      parentPath: normalizedParentPath,
      name: trimmedName,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      return res.status(409).json({ error: 'Folder already exists' })
    }
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return res.status(404).json({ error: 'parentPath not found' })
    }
    console.error('Error creating imported folder:', error)
    res.status(500).json({ error: 'Failed to create folder' })
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
        res.status(400).json({ error: 'Too many files in request.' })
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
