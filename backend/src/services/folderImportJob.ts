import path from 'path'
import fs from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { walkAudioFiles } from './fileWalker.js'
import {
  generatePeaks,
  getAudioDuration,
  getAudioFileMetadata,
  FFMPEG_BIN,
  type AudioFileMetadata,
} from './ffmpeg.js'
import {
  analyzeAudioFeatures,
  buildSamplePathHint,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
  parseFilenameTagsSmart,
  postAnalyzeSampleTags,
} from './audioAnalysis.js'

const DATA_DIR = process.env.DATA_DIR || './data'
const SLICES_DIR = path.join(DATA_DIR, 'slices')
const PEAKS_DIR = path.join(DATA_DIR, 'peaks')
const USE_REFERENCE_IMPORTS = process.env.LOCAL_IMPORT_MODE === 'reference'
const TRACK_IMPORT_FILENAME_TAG_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.TRACK_IMPORT_FILENAME_TAG_LIMIT ?? '1', 10) || 1
)

const CHUNK_SIZE = 100
const DISCOVERY_UPDATE_INTERVAL = 500

/** In-memory map of active jobs for cancellation signaling */
const activeJobs = new Map<string, { cancelled: boolean }>()

export interface ImportJobStatus {
  id: string
  folderPath: string
  importType: 'sample' | 'track'
  phase: string
  discoveredCount: number
  registeredCount: number
  analyzedCount: number
  failedCount: number
  totalCount: number | null
  lastProcessedPath: string | null
  error: string | null
  createdAt: number | null
  updatedAt: number | null
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
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

async function buildTrackPeaks(audioPath: string, trackKey: string): Promise<string | null> {
  try {
    await fs.mkdir(PEAKS_DIR, { recursive: true })
    const sanitizedKey = trackKey.replace(/[^a-zA-Z0-9_-]/g, '_')
    const peaksPath = path.join(PEAKS_DIR, `${sanitizedKey}.json`)
    await generatePeaks(audioPath, peaksPath)
    return peaksPath
  } catch (error) {
    console.error(`[importJob] Failed to generate peaks for ${trackKey}:`, error)
    return null
  }
}

async function replaceInstrumentTagsForSlice(
  sliceId: number,
  reviewedTags: Array<{ name: string; category: 'instrument' }>
): Promise<void> {
  db.run(sql`
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
        .values({ name: lowerTag, color, category })
        .returning()
      tag = [newTag]
    } else if (tag[0].category === 'filename' && category !== 'filename') {
      await db
        .update(schema.tags)
        .set({ color, category })
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
        .set({ color: metadata.color, category: metadata.category })
        .where(eq(schema.tags.id, tag[0].id))
    }

    await db
      .insert(schema.sliceTags)
      .values({ sliceId: options.sliceId, tagId: tag[0].id })
      .onConflictDoNothing()
  }
}

async function autoTagSlice(sliceId: number, audioPath: string): Promise<void> {
  try {
    const level: 'advanced' = 'advanced'

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

    try {
      await fs.stat(audioPath)
    } catch {
      throw new Error(`Audio file not found: ${audioPath}`)
    }

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

    if (reviewedTags.length > 0) {
      await replaceInstrumentTagsForSlice(sliceId, reviewedTags)
    }
  } catch (error) {
    console.error(`[importJob] Error analyzing slice ${sliceId}:`, error)
  }
}

type ImportJobPhase = 'scanning' | 'importing' | 'analyzing' | 'done' | 'cancelled' | 'error'

function updateJobRow(jobId: string, updates: Partial<{
  phase: ImportJobPhase
  discoveredCount: number
  registeredCount: number
  analyzedCount: number
  failedCount: number
  totalCount: number | null
  lastProcessedPath: string | null
  error: string | null
}>) {
  const now = Date.now()
  db.update(schema.importJobs)
    .set({ ...updates, updatedAt: now })
    .where(eq(schema.importJobs.id, jobId))
    .run()
}

async function importSingleFile(
  filePath: string,
  folderRootPath: string,
  importType: 'sample' | 'track',
): Promise<{ sliceId: number; slicePath: string }> {
  const originalName = path.basename(filePath)
  const relativePath = normalizeRelativePath(path.relative(folderRootPath, filePath))
  const baseName = path.basename(originalName, path.extname(originalName))

  let duration = 0
  try {
    duration = await getAudioDuration(filePath)
  } catch (err) {
    console.error('[importJob] Failed to get audio duration:', err)
  }

  const sourceMetadata = await getAudioFileMetadata(filePath).catch(() => null)
  const trackMetadata = toTrackMetadata(sourceMetadata)
  const trackTitle = trackMetadata.title ?? baseName

  const localId = `local:${uuidv4()}`
  const peaksPath = await buildTrackPeaks(filePath, localId)
  const [track] = await db
    .insert(schema.tracks)
    .values({
      youtubeId: localId,
      title: trackTitle,
      description: `Imported from folder: ${folderRootPath}`,
      thumbnailUrl: '',
      duration,
      audioPath: filePath,
      peaksPath,
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
      originalPath: filePath,
      folderPath: folderRootPath,
      relativePath,
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
    try {
      await seedFilenameTagsForSlice({
        sliceId: slice.id,
        filename: originalName,
        folderPath: folderRootPath,
        relativePath,
      })
    } catch (err) {
      console.error('[importJob] Filename tagging failed:', err)
    }
  }

  return { sliceId: slice.id, slicePath }
}

/**
 * Check if a file is already imported by its originalPath.
 */
async function isAlreadyImported(filePath: string): Promise<boolean> {
  const existing = await db
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(eq(schema.tracks.originalPath, filePath))
    .limit(1)
  return existing.length > 0
}

/**
 * Create and start a folder import job. Returns the job ID immediately.
 * The import runs asynchronously in the background.
 */
export function startFolderImportJob(
  folderPath: string,
  importType: 'sample' | 'track',
  resumeFromPath?: string | null,
): string {
  const jobId = uuidv4()
  const now = Date.now()

  db.insert(schema.importJobs)
    .values({
      id: jobId,
      folderPath,
      importType,
      phase: 'scanning',
      discoveredCount: 0,
      registeredCount: 0,
      analyzedCount: 0,
      failedCount: 0,
      totalCount: null,
      lastProcessedPath: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const signal = { cancelled: false }
  activeJobs.set(jobId, signal)

  // Run async — don't await
  runImportJob(jobId, folderPath, importType, signal, resumeFromPath ?? null)
    .catch((err) => {
      console.error(`[importJob] Fatal error in job ${jobId}:`, err)
      updateJobRow(jobId, {
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => {
      activeJobs.delete(jobId)
    })

  return jobId
}

async function runImportJob(
  jobId: string,
  folderPath: string,
  importType: 'sample' | 'track',
  signal: { cancelled: boolean },
  resumeFromPath: string | null,
): Promise<void> {
  const folderRootPath = path.resolve(folderPath)

  // Phase 1: DISCOVERY — walk directory, collect all file paths
  console.log(`[importJob] ${jobId} Starting discovery phase for: ${folderRootPath}`)
  const allFiles: string[] = []
  let discoveredCount = 0
  let pastResumePath = resumeFromPath === null

  for await (const filePath of walkAudioFiles(folderRootPath)) {
    if (signal.cancelled) {
      updateJobRow(jobId, { phase: 'cancelled' })
      console.log(`[importJob] ${jobId} Cancelled during discovery`)
      return
    }

    allFiles.push(filePath)
    discoveredCount++

    if (discoveredCount % DISCOVERY_UPDATE_INTERVAL === 0) {
      updateJobRow(jobId, { discoveredCount })
    }
  }

  const totalCount = allFiles.length
  updateJobRow(jobId, {
    phase: 'importing',
    discoveredCount: totalCount,
    totalCount,
  })

  if (totalCount === 0) {
    updateJobRow(jobId, { phase: 'done' })
    console.log(`[importJob] ${jobId} No audio files found`)
    return
  }

  console.log(`[importJob] ${jobId} Discovered ${totalCount} files, starting registration`)

  // Phase 2: REGISTRATION — process files in chunks
  let registeredCount = 0
  let failedCount = 0
  const analysisQueue: Array<{ sliceId: number; slicePath: string }> = []

  for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
    if (signal.cancelled) {
      updateJobRow(jobId, { phase: 'cancelled', registeredCount, failedCount })
      console.log(`[importJob] ${jobId} Cancelled during registration`)
      return
    }

    const chunk = allFiles.slice(i, i + CHUNK_SIZE)

    for (const filePath of chunk) {
      if (signal.cancelled) {
        updateJobRow(jobId, { phase: 'cancelled', registeredCount, failedCount })
        return
      }

      // Skip files before resume point
      if (!pastResumePath) {
        if (filePath === resumeFromPath) {
          pastResumePath = true
        }
        continue
      }

      try {
        // Deduplication: skip already-imported files
        if (await isAlreadyImported(filePath)) {
          registeredCount++
          continue
        }

        const result = await importSingleFile(filePath, folderRootPath, importType)
        registeredCount++

        if (importType === 'sample') {
          analysisQueue.push(result)
        }
      } catch (err) {
        failedCount++
        console.error(`[importJob] ${jobId} Failed to import ${filePath}:`, err)
      }

      updateJobRow(jobId, {
        registeredCount,
        failedCount,
        lastProcessedPath: filePath,
      })
    }
  }

  // Phase 3: ANALYSIS — process queued analysis tasks serially
  if (analysisQueue.length > 0) {
    updateJobRow(jobId, { phase: 'analyzing' })
    console.log(`[importJob] ${jobId} Starting analysis of ${analysisQueue.length} files`)

    let analyzedCount = 0
    for (const { sliceId, slicePath } of analysisQueue) {
      if (signal.cancelled) {
        updateJobRow(jobId, { phase: 'cancelled', analyzedCount })
        console.log(`[importJob] ${jobId} Cancelled during analysis`)
        return
      }

      try {
        await autoTagSlice(sliceId, slicePath)
      } catch (err) {
        console.error(`[importJob] ${jobId} Analysis failed for slice ${sliceId}:`, err)
      }
      analyzedCount++
      updateJobRow(jobId, { analyzedCount })
    }
  }

  updateJobRow(jobId, { phase: 'done' })
  console.log(`[importJob] ${jobId} Complete: ${registeredCount} registered, ${failedCount} failed`)
}

/**
 * Cancel an active import job.
 */
export function cancelImportJob(jobId: string): boolean {
  const signal = activeJobs.get(jobId)
  if (signal) {
    signal.cancelled = true
    return true
  }

  // Job may not be in memory but still in DB
  const job = db
    .select({ phase: schema.importJobs.phase })
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .get()

  if (job && !['done', 'cancelled', 'error'].includes(job.phase)) {
    updateJobRow(jobId, { phase: 'cancelled' })
    return true
  }

  return false
}

/**
 * Resume a failed or cancelled job from where it left off.
 */
export function resumeImportJob(jobId: string): string | null {
  const job = db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .get()

  if (!job) return null
  if (!['error', 'cancelled'].includes(job.phase)) return null

  // Create a new job that resumes from the last processed path
  return startFolderImportJob(
    job.folderPath,
    job.importType as 'sample' | 'track',
    job.lastProcessedPath,
  )
}

/**
 * Get status of a specific import job.
 */
export function getImportJobStatus(jobId: string): ImportJobStatus | null {
  const job = db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .get()

  if (!job) return null

  return {
    id: job.id,
    folderPath: job.folderPath,
    importType: job.importType as 'sample' | 'track',
    phase: job.phase,
    discoveredCount: job.discoveredCount,
    registeredCount: job.registeredCount,
    analyzedCount: job.analyzedCount,
    failedCount: job.failedCount,
    totalCount: job.totalCount,
    lastProcessedPath: job.lastProcessedPath,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

/**
 * List import jobs, optionally filtering by active status.
 */
export function listImportJobs(activeOnly = false): ImportJobStatus[] {
  let query = db.select().from(schema.importJobs)

  const jobs = query.all()

  return jobs
    .filter((job) => {
      if (activeOnly) {
        return ['scanning', 'importing', 'analyzing'].includes(job.phase)
      }
      return true
    })
    .map((job) => ({
      id: job.id,
      folderPath: job.folderPath,
      importType: job.importType as 'sample' | 'track',
      phase: job.phase,
      discoveredCount: job.discoveredCount,
      registeredCount: job.registeredCount,
      analyzedCount: job.analyzedCount,
      failedCount: job.failedCount,
      totalCount: job.totalCount,
      lastProcessedPath: job.lastProcessedPath,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}
