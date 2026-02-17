import { Router } from 'express'
import { eq, inArray, and, isNull, isNotNull, like, or, sql } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import archiver from 'archiver'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { db, schema, getRawDb } from '../db/index.js'
import { extractSlice, getAudioFileMetadata } from '../services/ffmpeg.js'
import {
  analyzeAudioFeatures,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
  parseFilenameTags,
} from '../services/audioAnalysis.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
const SLICES_DIR = path.join(DATA_DIR, 'slices')

const renderUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 1,
  },
})

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const AUTO_REANALYSIS_TAG_CATEGORIES = ['type', 'tempo', 'spectral', 'energy', 'instrument', 'general'] as const
type Range = { min: number | null; max: number | null }

/** Convert a frequency in Hz to the nearest note name (e.g., 440 -> "A"). */
function freqToNoteName(hz: number): string | null {
  if (!hz || hz <= 0) return null
  const midi = Math.round(12 * Math.log2(hz / 440) + 69)
  return NOTE_NAMES[((midi % 12) + 12) % 12]
}

function normalizeFolderPathValue(value: string): string {
  return value
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
}

function normalizeIdentityPathValue(value: string): string {
  return normalizeFolderPathValue(value).toLowerCase()
}

function parseScaleFromKeyEstimate(keyEstimate: string | null): string | null {
  if (!keyEstimate) return null
  const parts = keyEstimate.trim().split(/\s+/)
  if (parts.length < 2) return null
  return parts.slice(1).join(' ').toLowerCase()
}

function parseDateFilterValue(raw: string | undefined, mode: 'start' | 'end'): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const value = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${mode === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : trimmed

  const parsed = new Date(value)
  const timestamp = parsed.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function isWithinDateRange(
  value: string | null | undefined,
  fromTimestamp: number | null,
  toTimestamp: number | null
): boolean {
  if (fromTimestamp === null && toTimestamp === null) return true
  if (!value) return false

  const parsed = new Date(value).getTime()
  if (!Number.isFinite(parsed)) return false
  if (fromTimestamp !== null && parsed < fromTimestamp) return false
  if (toTimestamp !== null && parsed > toTimestamp) return false
  return true
}

function deriveRelativePathDisplay(
  folderPath: string | null,
  originalPath: string | null,
  relativePath: string | null
): string | null {
  if (relativePath && relativePath.trim()) {
    return normalizeFolderPathValue(relativePath)
  }

  if (!folderPath || !originalPath) return null

  const normalizedOriginal = normalizeFolderPathValue(originalPath)
  const normalizedFolder = normalizeFolderPathValue(folderPath)
  if (!normalizedOriginal || !normalizedFolder) return null
  if (!isPathInFolderScope(normalizedOriginal, normalizedFolder)) return null

  const relative = path.posix.relative(normalizedFolder, normalizedOriginal)
  if (!relative || relative.startsWith('..')) return null
  return normalizeFolderPathValue(relative)
}

function normalizeValue(value: number | null | undefined, range: Range): number | null {
  if (value === null || value === undefined) return null
  if (range.min === null || range.max === null) return null
  if (range.max <= range.min) return 0
  const normalized = (value - range.min) / (range.max - range.min)
  return Math.max(0, Math.min(1, normalized))
}

function isPathInFolderScope(candidatePath: string | null, scopePath: string): boolean {
  if (!candidatePath) return false
  const normalizedCandidate = normalizeFolderPathValue(candidatePath)
  const normalizedScope = normalizeFolderPathValue(scopePath)
  if (!normalizedCandidate || !normalizedScope) return false
  return (
    normalizedCandidate === normalizedScope ||
    normalizedCandidate.startsWith(`${normalizedScope}/`)
  )
}

function computeTagDiff(beforeTags: string[], afterTags: string[]) {
  const beforeSet = new Set(beforeTags)
  const afterSet = new Set(afterTags)

  const removedTags = beforeTags.filter((tag) => !afterSet.has(tag))
  const addedTags = afterTags.filter((tag) => !beforeSet.has(tag))

  return { removedTags, addedTags }
}

function sanitizeArchiveEntryBaseName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 0 ? cleaned : 'sample'
}

function createUniqueArchiveEntryName(
  baseName: string,
  extension: string,
  usedNames: Map<string, number>
): string {
  const normalizedExt = extension || '.mp3'
  const canonicalName = `${baseName}${normalizedExt}`
  const key = canonicalName.toLowerCase()
  const seen = usedNames.get(key) ?? 0
  usedNames.set(key, seen + 1)

  if (seen === 0) return canonicalName
  return `${baseName}-${seen + 1}${normalizedExt}`
}

async function getSliceTagNames(sliceId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.sliceTags)
    .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
    .where(eq(schema.sliceTags.sliceId, sliceId))

  return rows.map((row) => row.name)
}

async function ensureCoreDataDirs() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true })
  await fs.mkdir(SLICES_DIR, { recursive: true })
}

async function copyFileSafe(src: string, dest: string) {
  if (src === dest) return
  await fs.copyFile(src, dest)
}

function toFiniteDuration(value: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

// Persist rendered lab audio either as copy or overwrite
router.post('/slices/:id/render', renderUpload.single('audio'), async (req, res) => {
  const sliceId = Number.parseInt(req.params.id, 10)

  if (!Number.isInteger(sliceId) || sliceId <= 0) {
    return res.status(400).json({ error: 'Invalid slice id' })
  }

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: 'Audio file is required' })
  }

  const rawMode = String(req.body?.mode ?? '').trim().toLowerCase()
  const mode: 'copy' | 'overwrite' | null =
    rawMode === 'copy' || rawMode === 'overwrite' ? rawMode : null

  if (!mode) {
    return res.status(400).json({ error: 'mode must be either copy or overwrite' })
  }

  const requestedFileName = String(req.body?.fileName ?? '').trim()
  const hqPitchRequested = parseBooleanFlag(req.body?.hqPitchRequested)

  try {
    await ensureCoreDataDirs()

    const sliceRows = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    if (sliceRows.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    const sourceSlice = sliceRows[0]

    const trackRows = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, sourceSlice.trackId))
      .limit(1)

    if (trackRows.length === 0) {
      return res.status(404).json({ error: 'Parent track not found' })
    }

    const sourceTrack = trackRows[0]

    const fallbackDuration = Math.max(0.01, sourceSlice.endTime - sourceSlice.startTime)
    const renderedDuration = toFiniteDuration(req.body?.duration, fallbackDuration)
    const safeName = sanitizeArchiveEntryBaseName(
      requestedFileName || `${sourceSlice.name || `slice-${sourceSlice.id}`}-lab`
    )

    const uniqueStem = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const renderedFilePath = path.join(SLICES_DIR, `${uniqueStem}.wav`)
    await fs.writeFile(renderedFilePath, req.file.buffer)

    const now = new Date().toISOString()

    if (mode === 'overwrite') {
      if (sourceSlice.filePath) {
        await copyFileSafe(renderedFilePath, sourceSlice.filePath)
        await fs.unlink(renderedFilePath).catch(() => {})
      }

      const finalFilePath = sourceSlice.filePath || renderedFilePath
      const [updatedSlice] = await db
        .update(schema.slices)
        .set({
          filePath: finalFilePath,
          startTime: 0,
          endTime: renderedDuration,
          sampleModified: 1,
          sampleModifiedAt: now,
        })
        .where(eq(schema.slices.id, sourceSlice.id))
        .returning()

      return res.json({
        mode,
        sourceSliceId: sourceSlice.id,
        slice: updatedSlice,
        hqPitchRequested,
      })
    }

    // mode === 'copy'
    const originalTrackTitle = sourceTrack.title || `Sample ${sourceSlice.id}`
    const newTrackTitle = `${originalTrackTitle} (Lab)`
    const newTrackYoutubeId = `lab:${randomUUID()}`
    const trackDescription = `Lab render copy from slice ${sourceSlice.id}`

    const sourceAudioPathForCopy = sourceSlice.filePath || sourceTrack.audioPath || renderedFilePath
    const copiedTrackAudioPath = path.join(UPLOADS_DIR, `${newTrackYoutubeId.replace(':', '_')}.wav`)
    await copyFileSafe(sourceAudioPathForCopy, copiedTrackAudioPath)

    const [createdTrack] = await db
      .insert(schema.tracks)
      .values({
        youtubeId: newTrackYoutubeId,
        title: newTrackTitle,
        description: trackDescription,
        thumbnailUrl: sourceTrack.thumbnailUrl || '',
        duration: renderedDuration,
        audioPath: copiedTrackAudioPath,
        peaksPath: null,
        status: 'ready',
        artist: sourceTrack.artist,
        album: sourceTrack.album,
        year: sourceTrack.year,
        source: 'local',
        originalPath: sourceTrack.originalPath || sourceSlice.filePath || null,
        folderPath: sourceTrack.folderPath || null,
        relativePath: sourceTrack.relativePath || null,
        fullPathHint: sourceTrack.fullPathHint || sourceTrack.originalPath || sourceSlice.filePath || null,
        createdAt: now,
      })
      .returning()

    const [createdSlice] = await db
      .insert(schema.slices)
      .values({
        trackId: createdTrack.id,
        name: safeName,
        startTime: 0,
        endTime: renderedDuration,
        filePath: renderedFilePath,
        favorite: 0,
        sampleModified: 1,
        sampleModifiedAt: now,
        createdAt: now,
      })
      .returning()

    const sourceTagLinks = await db
      .select({ tagId: schema.sliceTags.tagId })
      .from(schema.sliceTags)
      .where(eq(schema.sliceTags.sliceId, sourceSlice.id))

    if (sourceTagLinks.length > 0) {
      await db
        .insert(schema.sliceTags)
        .values(sourceTagLinks.map((link) => ({ sliceId: createdSlice.id, tagId: link.tagId })))
        .onConflictDoNothing()
    }

    return res.json({
      mode,
      sourceSliceId: sourceSlice.id,
      slice: createdSlice,
      createdTrack,
      hqPitchRequested,
    })
  } catch (error) {
    console.error('Error persisting lab render:', error)
    return res.status(500).json({ error: 'Failed to persist rendered sample' })
  }
})

// GET /api/sources/samples - Returns samples filtered by scope
// Query params:
//   scope: 'youtube' | 'youtube:{trackId}' | 'local' | 'folder:{path}' | 'my-folder:{id}' | 'folder:{id}' | 'all'
//   tags: comma-separated tag IDs (optional)
//   search: search term (optional)
//   favorites: 'true' to show only favorites (optional)
//   sortBy: 'bpm' | 'key' | 'note' | 'name' | 'duration' | 'createdAt' | 'similarity' (optional)
//   sortOrder: 'asc' | 'desc' (optional, default: 'asc', or 'desc' if similarTo is provided)
//   minBpm: minimum BPM (optional)
//   maxBpm: maximum BPM (optional)
//   keys: comma-separated key names (optional, e.g., 'C major,D minor')
//   notes: comma-separated note names for fundamental frequency filter (optional, e.g., 'C,D,E')
//   dateAddedFrom/dateAddedTo: added-date range filter in YYYY-MM-DD (optional)
//   dateCreatedFrom/dateCreatedTo: source-file creation-date range filter in YYYY-MM-DD (optional)
//   similarTo: slice ID to find similar samples (optional)
//   minSimilarity: minimum similarity threshold 0-1 (optional, default: 0.5)
router.get('/sources/samples', async (req, res) => {
  try {
    const {
      scope = 'all',
      tags,
      search,
      favorites,
      sortBy,
      sortOrder = 'asc',
      minBpm,
      maxBpm,
      keys,
      notes,
      dateAddedFrom,
      dateAddedTo,
      dateCreatedFrom,
      dateCreatedTo,
      similarTo,
      minSimilarity,
    } = req.query as {
      scope?: string
      tags?: string
      search?: string
      favorites?: string
      sortBy?: string
      sortOrder?: string
      minBpm?: string
      maxBpm?: string
      keys?: string
      notes?: string
      dateAddedFrom?: string
      dateAddedTo?: string
      dateCreatedFrom?: string
      dateCreatedTo?: string
      similarTo?: string
      minSimilarity?: string
    }

    const dateAddedFromTs = parseDateFilterValue(dateAddedFrom, 'start')
    const dateAddedToTs = parseDateFilterValue(dateAddedTo, 'end')
    const dateCreatedFromTs = parseDateFilterValue(dateCreatedFrom, 'start')
    const dateCreatedToTs = parseDateFilterValue(dateCreatedTo, 'end')

    // Build base query conditions
    const conditions: any[] = []
    const sqlite = getRawDb()
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const hasModernFolders = tables.some((t) => t.name === 'folders')
    const hasModernFolderSlices = tables.some((t) => t.name === 'folder_slices')
    const hasLegacyCollections = tables.some((t) => t.name === 'collections')
    const hasLegacyCollectionSlices = tables.some((t) => t.name === 'collection_slices')

    let hasLegacyPerspectiveId = false
    if (hasLegacyCollections) {
      const collectionColumns = sqlite.prepare('PRAGMA table_info(collections)').all() as Array<{ name: string }>
      hasLegacyPerspectiveId = collectionColumns.some((col) => col.name === 'perspective_id')
    }
    const useLegacyHierarchy = hasLegacyCollections && hasLegacyPerspectiveId && hasLegacyCollectionSlices

    // Resolve folder membership links in a schema-agnostic way.
    // Some deployments can carry legacy and modern tables at the same time.
    // We intentionally merge both sources and de-duplicate.
    const getFolderSliceIds = async (folderIds: number[]): Promise<number[]> => {
      if (folderIds.length === 0) return []

      const found = new Set<number>()

      if (hasLegacyCollectionSlices) {
        const placeholders = folderIds.map(() => '?').join(',')
        const legacyRows = sqlite
          .prepare(`SELECT slice_id as sliceId FROM collection_slices WHERE collection_id IN (${placeholders})`)
          .all(...folderIds) as Array<{ sliceId: number }>

        for (const row of legacyRows) {
          found.add(row.sliceId)
        }
      }

      if (hasModernFolderSlices) {
        const modernRows = await db
          .select({ sliceId: schema.folderSlices.sliceId })
          .from(schema.folderSlices)
          .where(inArray(schema.folderSlices.folderId, folderIds))

        for (const row of modernRows) {
          found.add(row.sliceId)
        }
      }

      return Array.from(found)
    }

    const getFolderIdsForCollection = async (collectionId: number): Promise<number[]> => {
      const ids = new Set<number>()

      // Legacy rename model: collections table stores folders and links to perspectives via perspective_id.
      if (useLegacyHierarchy) {
        const legacyFolders = sqlite
          .prepare('SELECT id FROM collections WHERE perspective_id = ?')
          .all(collectionId) as Array<{ id: number }>
        for (const row of legacyFolders) ids.add(row.id)
      }

      if (hasModernFolders) {
        const modernFolders = await db
          .select({ id: schema.folders.id })
          .from(schema.folders)
          .where(eq(schema.folders.collectionId, collectionId))
        for (const row of modernFolders) ids.add(row.id)
      }

      return Array.from(ids)
    }

    const getFolderLinksForSliceIds = async (sliceIdsToResolve: number[]): Promise<Array<{ sliceId: number; folderId: number }>> => {
      if (sliceIdsToResolve.length === 0) return []

      const links: Array<{ sliceId: number; folderId: number }> = []
      const dedupe = new Set<string>()

      if (hasLegacyCollectionSlices) {
        const placeholders = sliceIdsToResolve.map(() => '?').join(',')
        const legacyLinks = sqlite
          .prepare(`SELECT slice_id as sliceId, collection_id as folderId FROM collection_slices WHERE slice_id IN (${placeholders})`)
          .all(...sliceIdsToResolve) as Array<{ sliceId: number; folderId: number }>

        for (const row of legacyLinks) {
          const key = `${row.sliceId}:${row.folderId}`
          if (!dedupe.has(key)) {
            dedupe.add(key)
            links.push(row)
          }
        }
      }

      if (hasModernFolderSlices) {
        const modernRows = await db
          .select()
          .from(schema.folderSlices)
          .where(inArray(schema.folderSlices.sliceId, sliceIdsToResolve))

        for (const row of modernRows) {
          const link = { sliceId: row.sliceId, folderId: row.folderId }
          const key = `${link.sliceId}:${link.folderId}`
          if (!dedupe.has(key)) {
            dedupe.add(key)
            links.push(link)
          }
        }
      }

      return links
    }

    // Parse scope
    if (scope === 'youtube') {
      // All YouTube slices
      conditions.push(eq(schema.tracks.source, 'youtube'))
    } else if (scope.startsWith('youtube:')) {
      // Specific YouTube video
      const trackId = parseInt(scope.split(':')[1])
      conditions.push(eq(schema.slices.trackId, trackId))
    } else if (scope === 'local') {
      // Individual local samples (no folderPath)
      conditions.push(
        and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath)
        )
      )
    } else if (scope.startsWith('folder:') || scope.startsWith('my-folder:')) {
      // Two folder scope variants share the same prefix:
      // - folder:{path}  => imported local folder path (string)
      // - my-folder:{id} => app "My Folder" membership (numeric id)
      // - folder:{id}    => backward-compatible app "My Folder" membership
      // Only apply path-based track filtering for imported-folder scopes.
      const isMyFolderScope = scope.startsWith('my-folder:')
      const folderScopeValue = isMyFolderScope ? scope.slice('my-folder:'.length) : scope.slice('folder:'.length)
      const folderId = Number.parseInt(folderScopeValue, 10)
      const isFolderIdScope =
        isMyFolderScope || (!Number.isNaN(folderId) && String(folderId) === folderScopeValue)

      if (!isFolderIdScope) {
        conditions.push(
          and(
            eq(schema.tracks.source, 'local'),
            isNotNull(schema.tracks.folderPath)
          )
        )
      }
    } else if (scope.startsWith('collection:')) {
      // Samples across all folders in a collection - handled separately below
    }
    // 'all' has no additional conditions

    // Favorites filter
    if (favorites === 'true') {
      conditions.push(eq(schema.slices.favorite, 1))
    }

    // Search filter (case-insensitive using SQL)
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`
      conditions.push(
        sql`(lower(${schema.slices.name}) LIKE ${searchTerm} OR lower(${schema.tracks.title}) LIKE ${searchTerm})`
      )
    }

    // Build query
    let slicesQuery = db
      .select({
        id: schema.slices.id,
        trackId: schema.slices.trackId,
        name: schema.slices.name,
        startTime: schema.slices.startTime,
        endTime: schema.slices.endTime,
        filePath: schema.slices.filePath,
        favorite: schema.slices.favorite,
        sampleModified: schema.slices.sampleModified,
        sampleModifiedAt: schema.slices.sampleModifiedAt,
        createdAt: schema.slices.createdAt,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
        trackSource: schema.tracks.source,
        trackFolderPath: schema.tracks.folderPath,
        trackOriginalPath: schema.tracks.originalPath,
        trackRelativePath: schema.tracks.relativePath,
        trackFullPathHint: schema.tracks.fullPathHint,
        trackArtist: schema.tracks.artist,
        trackAlbum: schema.tracks.album,
        trackYear: schema.tracks.year,
        // Audio features
        sampleRate: schema.audioFeatures.sampleRate,
        channels: schema.audioFeatures.channels,
        fileFormat: schema.audioFeatures.fileFormat,
        sourceMtime: schema.audioFeatures.sourceMtime,
        sourceCtime: schema.audioFeatures.sourceCtime,
        bpm: schema.audioFeatures.bpm,
        keyEstimate: schema.audioFeatures.keyEstimate,
        scale: schema.audioFeatures.scale,
        fundamentalFrequency: schema.audioFeatures.fundamentalFrequency,
        polyphony: schema.audioFeatures.polyphony,
        envelopeType: schema.audioFeatures.envelopeType,
        genrePrimary: schema.audioFeatures.genrePrimary,
        instrumentType: schema.audioFeatures.instrumentType,
        brightness: schema.audioFeatures.brightness,
        warmth: schema.audioFeatures.warmth,
        hardness: schema.audioFeatures.hardness,
        sharpness: schema.audioFeatures.sharpness,
        noisiness: schema.audioFeatures.noisiness,
        loudness: schema.audioFeatures.loudness,
        roughness: schema.audioFeatures.roughness,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .leftJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    // Apply conditions
    if (conditions.length > 0) {
      slicesQuery = slicesQuery.where(and(...conditions)) as typeof slicesQuery
    }

    let slices = await slicesQuery

    // Defensive dedupe for mixed-schema deployments where join paths can duplicate rows.
    slices = Array.from(new Map(slices.map((slice) => [slice.id, slice])).values())

    // Handle folder scope (post-filter since it requires join)
    if (scope.startsWith('folder:') || scope.startsWith('my-folder:')) {
      const folderScopeValue = scope.startsWith('my-folder:')
        ? scope.slice('my-folder:'.length)
        : scope.slice('folder:'.length)
      const folderId = Number.parseInt(folderScopeValue, 10)
      const isFolderIdScope =
        scope.startsWith('my-folder:') || (!Number.isNaN(folderId) && String(folderId) === folderScopeValue)

      if (isFolderIdScope) {
        const folderSliceIds = await getFolderSliceIds([folderId])
        const sliceIdSet = new Set(folderSliceIds)
        slices = slices.filter(s => sliceIdSet.has(s.id))
      } else {
        slices = slices.filter((slice) =>
          isPathInFolderScope(slice.trackFolderPath, folderScopeValue)
        )
      }
    }

    // Handle collection scope (all samples across all folders in the collection)
    if (scope.startsWith('collection:')) {
      const collectionId = parseInt(scope.split(':')[1])

      const folderIds = await getFolderIdsForCollection(collectionId)

      if (folderIds.length > 0) {
        const collectionSliceIds = await getFolderSliceIds(folderIds)
        const sliceIdSet = new Set(collectionSliceIds)
        slices = slices.filter(s => sliceIdSet.has(s.id))
      } else {
        slices = []
      }
    }

    // Get tags for all slices
    const sliceIds = slices.map(s => s.id)
    const sliceTagsResult = sliceIds.length > 0
      ? await db
          .select()
          .from(schema.sliceTags)
          .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
          .where(inArray(schema.sliceTags.sliceId, sliceIds))
      : []

    const tagsBySlice = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of sliceTagsResult) {
      const sliceId = row.slice_tags.sliceId
      if (!tagsBySlice.has(sliceId)) {
        tagsBySlice.set(sliceId, [])
      }
      tagsBySlice.get(sliceId)!.push(row.tags)
    }

    // Tag filter (post-filter since it requires multiple tags match)
    let filteredSlices = slices
    if (tags && tags.trim()) {
      const tagIds = tags.split(',').map(t => parseInt(t.trim())).filter(t => !isNaN(t))
      if (tagIds.length > 0) {
        filteredSlices = slices.filter(slice => {
          const sliceTags = tagsBySlice.get(slice.id) || []
          const sliceTagIds = sliceTags.map(t => t.id)
          return tagIds.every(tagId => sliceTagIds.includes(tagId))
        })
      }
    }

    // BPM filter
    if (minBpm || maxBpm) {
      const minBpmNum = minBpm ? parseFloat(minBpm) : 0
      const maxBpmNum = maxBpm ? parseFloat(maxBpm) : Infinity
      filteredSlices = filteredSlices.filter(slice => {
        if (slice.bpm === null || slice.bpm === undefined) return false
        return slice.bpm >= minBpmNum && slice.bpm <= maxBpmNum
      })
    }

    // Key filter
    if (keys && keys.trim()) {
      const keyList = keys.split(',').map(k => k.trim().toLowerCase())
      filteredSlices = filteredSlices.filter(slice => {
        if (!slice.keyEstimate) return false
        return keyList.includes(slice.keyEstimate.toLowerCase())
      })
    }

    // Fundamental frequency note filter
    if (notes && notes.trim()) {
      const noteList = notes.split(',').map(n => n.trim())
      filteredSlices = filteredSlices.filter(slice => {
        if (!slice.fundamentalFrequency) return false
        const noteName = freqToNoteName(slice.fundamentalFrequency)
        return noteName !== null && noteList.includes(noteName)
      })
    }

    // Date Added range filter
    if (dateAddedFromTs !== null || dateAddedToTs !== null) {
      filteredSlices = filteredSlices.filter((slice) =>
        isWithinDateRange(slice.createdAt, dateAddedFromTs, dateAddedToTs)
      )
    }

    // Source file creation-date range filter
    if (dateCreatedFromTs !== null || dateCreatedToTs !== null) {
      filteredSlices = filteredSlices.filter((slice) =>
        isWithinDateRange(slice.sourceCtime, dateCreatedFromTs, dateCreatedToTs)
      )
    }

    // Keep payload unique by slice id after all post-filters.
    filteredSlices = Array.from(new Map(filteredSlices.map((slice) => [slice.id, slice])).values())

    // Similarity filter and calculation
    let similarityScores = new Map<number, number>()
    if (similarTo) {
      const similarToId = parseInt(similarTo, 10)
      const minSimilarityValue = minSimilarity ? parseFloat(minSimilarity) : 0.5

      if (!isNaN(similarToId)) {
        const targetFeatures = await db
          .select()
          .from(schema.audioFeatures)
          .where(eq(schema.audioFeatures.sliceId, similarToId))
          .limit(1)

        if (targetFeatures.length > 0) {
          const target = targetFeatures[0]
          const sliceIds = filteredSlices.map(s => s.id).filter(id => id !== similarToId)

          if (sliceIds.length > 0) {
            if (target.yamnetEmbeddings) {
              // Best quality: use 1024-dim YAMNet embeddings
              const targetEmbeddings = JSON.parse(target.yamnetEmbeddings) as number[]
              const embeddingsResults = await db
                .select({
                  sliceId: schema.audioFeatures.sliceId,
                  yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
                })
                .from(schema.audioFeatures)
                .where(
                  and(
                    inArray(schema.audioFeatures.sliceId, sliceIds),
                    isNotNull(schema.audioFeatures.yamnetEmbeddings)
                  )
                )
              for (const result of embeddingsResults) {
                if (result.yamnetEmbeddings) {
                  const embeddings = JSON.parse(result.yamnetEmbeddings) as number[]
                  similarityScores.set(result.sliceId, cosineSimilarity(targetEmbeddings, embeddings))
                }
              }
            } else {
              // Fallback: cosine similarity over normalised scalar audio features
              const targetVec = buildScalarFeatureVector(target)
              if (targetVec) {
                const candidateFeatures = await db
                  .select()
                  .from(schema.audioFeatures)
                  .where(inArray(schema.audioFeatures.sliceId, sliceIds))
                for (const f of candidateFeatures) {
                  const candidateVec = buildScalarFeatureVector(f)
                  if (candidateVec) {
                    similarityScores.set(f.sliceId, cosineSimilarity(targetVec, candidateVec))
                  }
                }
              }
            }

            // Filter by minimum similarity threshold
            filteredSlices = filteredSlices.filter(slice => {
              if (slice.id === similarToId) return false
              const similarity = similarityScores.get(slice.id)
              return similarity !== undefined && similarity >= minSimilarityValue
            })
          }
        }
      }
    }

    // Sorting - default to similarity DESC when in similarity mode
    const effectiveSortBy = sortBy || (similarTo ? 'similarity' : undefined)
    const effectiveSortOrder = sortOrder || (similarTo ? 'desc' : 'asc')

    if (effectiveSortBy) {
      filteredSlices.sort((a, b) => {
        let aVal: any
        let bVal: any

        switch (effectiveSortBy) {
          case 'artist':
            aVal = (a.trackArtist ?? '').toLowerCase()
            bVal = (b.trackArtist ?? '').toLowerCase()
            break
          case 'album':
            aVal = (a.trackAlbum ?? '').toLowerCase()
            bVal = (b.trackAlbum ?? '').toLowerCase()
            break
          case 'year':
            aVal = a.trackYear ?? -1
            bVal = b.trackYear ?? -1
            break
          case 'bpm':
            aVal = a.bpm ?? -1
            bVal = b.bpm ?? -1
            break
          case 'key':
            aVal = a.keyEstimate ?? ''
            bVal = b.keyEstimate ?? ''
            break
          case 'scale':
            aVal = a.scale ?? ''
            bVal = b.scale ?? ''
            break
          case 'note':
            aVal = a.fundamentalFrequency ?? -1
            bVal = b.fundamentalFrequency ?? -1
            break
          case 'polyphony':
            aVal = a.polyphony ?? -1
            bVal = b.polyphony ?? -1
            break
          case 'envelope':
            aVal = a.envelopeType ?? ''
            bVal = b.envelopeType ?? ''
            break
          case 'brightness':
            aVal = a.brightness ?? -1
            bVal = b.brightness ?? -1
            break
          case 'noisiness':
            aVal = (a.noisiness ?? a.roughness) ?? -1
            bVal = (b.noisiness ?? b.roughness) ?? -1
            break
          case 'warmth':
            aVal = a.warmth ?? -1
            bVal = b.warmth ?? -1
            break
          case 'hardness':
            aVal = a.hardness ?? -1
            bVal = b.hardness ?? -1
            break
          case 'sharpness':
            aVal = a.sharpness ?? -1
            bVal = b.sharpness ?? -1
            break
          case 'loudness':
            aVal = a.loudness ?? -1
            bVal = b.loudness ?? -1
            break
          case 'sampleRate':
            aVal = a.sampleRate ?? -1
            bVal = b.sampleRate ?? -1
            break
          case 'channels':
            aVal = a.channels ?? -1
            bVal = b.channels ?? -1
            break
          case 'format':
            aVal = a.fileFormat ?? ''
            bVal = b.fileFormat ?? ''
            break
          case 'dateModified':
            aVal = a.sourceMtime ?? ''
            bVal = b.sourceMtime ?? ''
            break
          case 'dateCreated':
            aVal = a.sourceCtime ?? ''
            bVal = b.sourceCtime ?? ''
            break
          case 'dateAdded':
            aVal = a.createdAt
            bVal = b.createdAt
            break
          case 'path':
            aVal = (
              deriveRelativePathDisplay(a.trackFolderPath, a.trackOriginalPath, a.trackRelativePath) ||
              a.trackOriginalPath ||
              a.trackFullPathHint ||
              ''
            ).toLowerCase()
            bVal = (
              deriveRelativePathDisplay(b.trackFolderPath, b.trackOriginalPath, b.trackRelativePath) ||
              b.trackOriginalPath ||
              b.trackFullPathHint ||
              ''
            ).toLowerCase()
            break
          case 'name':
            aVal = a.name.toLowerCase()
            bVal = b.name.toLowerCase()
            break
          case 'duration':
            aVal = a.endTime - a.startTime
            bVal = b.endTime - b.startTime
            break
          case 'similarity':
            aVal = similarityScores.get(a.id) ?? -1
            bVal = similarityScores.get(b.id) ?? -1
            break
          case 'createdAt':
          default:
            aVal = a.createdAt
            bVal = b.createdAt
            break
        }

        // Handle null/undefined values - always sort them last
        if (aVal === null || aVal === undefined || aVal === -1) return 1
        if (bVal === null || bVal === undefined || bVal === -1) return -1

        // Compare values
        if (aVal < bVal) return effectiveSortOrder === 'asc' ? -1 : 1
        if (aVal > bVal) return effectiveSortOrder === 'asc' ? 1 : -1
        return 0
      })
    }

    // Get folder memberships for filtered slices
    const filteredSliceIds = filteredSlices.map(s => s.id)
    const folderLinks = await getFolderLinksForSliceIds(filteredSliceIds)

    const foldersBySlice = new Map<number, Set<number>>()
    for (const row of folderLinks) {
      if (!foldersBySlice.has(row.sliceId)) {
        foldersBySlice.set(row.sliceId, new Set())
      }
      foldersBySlice.get(row.sliceId)!.add(row.folderId)
    }

    // Best-effort backfill for fields that can be derived without re-analysis.
    const derivedUpdates = filteredSlices
      .map((slice) => {
        const derivedScale = slice.scale ?? parseScaleFromKeyEstimate(slice.keyEstimate)
        const derivedNoisiness = slice.noisiness ?? slice.roughness ?? null
        const needsScale = !slice.scale && !!derivedScale
        const needsNoisiness = slice.noisiness == null && derivedNoisiness != null

        if (!needsScale && !needsNoisiness) return null
        return { sliceId: slice.id, scale: derivedScale, noisiness: derivedNoisiness }
      })
      .filter((entry): entry is { sliceId: number; scale: string | null; noisiness: number | null } => entry !== null)

    for (const update of derivedUpdates) {
      await db
        .update(schema.audioFeatures)
        .set({
          scale: update.scale,
          noisiness: update.noisiness,
        })
        .where(eq(schema.audioFeatures.sliceId, update.sliceId))
    }

    const perceptualStatsRaw = sqlite.prepare(`
      SELECT
        MIN(brightness) AS brightnessMin,
        MAX(brightness) AS brightnessMax,
        MIN(COALESCE(noisiness, roughness)) AS noisinessMin,
        MAX(COALESCE(noisiness, roughness)) AS noisinessMax,
        MIN(warmth) AS warmthMin,
        MAX(warmth) AS warmthMax,
        MIN(hardness) AS hardnessMin,
        MAX(hardness) AS hardnessMax,
        MIN(sharpness) AS sharpnessMin,
        MAX(sharpness) AS sharpnessMax
      FROM audio_features
    `).get() as Record<string, number | null>

    const perceptualRanges: Record<'brightness' | 'noisiness' | 'warmth' | 'hardness' | 'sharpness', Range> = {
      brightness: { min: perceptualStatsRaw.brightnessMin, max: perceptualStatsRaw.brightnessMax },
      noisiness: { min: perceptualStatsRaw.noisinessMin, max: perceptualStatsRaw.noisinessMax },
      warmth: { min: perceptualStatsRaw.warmthMin, max: perceptualStatsRaw.warmthMax },
      hardness: { min: perceptualStatsRaw.hardnessMin, max: perceptualStatsRaw.hardnessMax },
      sharpness: { min: perceptualStatsRaw.sharpnessMin, max: perceptualStatsRaw.sharpnessMax },
    }

    const result = filteredSlices.map(slice => ({
      ...(function () {
        const derivedScale = slice.scale ?? parseScaleFromKeyEstimate(slice.keyEstimate)
        const noisiness = slice.noisiness ?? slice.roughness ?? null
        const relativePath = deriveRelativePathDisplay(
          slice.trackFolderPath,
          slice.trackOriginalPath,
          slice.trackRelativePath
        )
        const pathDisplay = relativePath || slice.trackOriginalPath || slice.trackFullPathHint || null

        const subjectiveNormalized = {
          brightness: normalizeValue(slice.brightness, perceptualRanges.brightness),
          noisiness: normalizeValue(noisiness, perceptualRanges.noisiness),
          warmth: normalizeValue(slice.warmth, perceptualRanges.warmth),
          hardness: normalizeValue(slice.hardness, perceptualRanges.hardness),
          sharpness: normalizeValue(slice.sharpness, perceptualRanges.sharpness),
        }

        return {
          scale: derivedScale,
          sampleRate: slice.sampleRate,
          channels: slice.channels,
          format: slice.fileFormat,
          dateModified: slice.sourceMtime,
          dateCreated: slice.sourceCtime,
          warmth: slice.warmth,
          hardness: slice.hardness,
          sharpness: slice.sharpness,
          noisiness,
          polyphony: slice.polyphony,
          pathDisplay,
          subjectiveNormalized,
        }
      })(),
      id: slice.id,
      trackId: slice.trackId,
      name: slice.name,
      startTime: slice.startTime,
      endTime: slice.endTime,
      filePath: slice.filePath,
      favorite: slice.favorite === 1,
      sampleModified: slice.sampleModified === 1,
      sampleModifiedAt: slice.sampleModifiedAt,
      dateAdded: slice.createdAt,
      createdAt: slice.createdAt,
      tags: tagsBySlice.get(slice.id) || [],
      folderIds: Array.from(foldersBySlice.get(slice.id) || []),
      bpm: slice.bpm,
      keyEstimate: slice.keyEstimate,
      fundamentalFrequency: slice.fundamentalFrequency,
      envelopeType: slice.envelopeType,
      genrePrimary: slice.genrePrimary,
      instrumentType: slice.instrumentType,
      brightness: slice.brightness,
      loudness: slice.loudness,
      roughness: slice.roughness,
      similarity: similarityScores.get(slice.id),
      track: {
        title: slice.trackTitle,
        youtubeId: slice.trackYoutubeId,
        source: slice.trackSource,
        folderPath: slice.trackFolderPath,
        originalPath: slice.trackOriginalPath,
        relativePath: slice.trackRelativePath,
        fullPathHint: slice.trackFullPathHint,
        artist: slice.trackArtist,
        album: slice.trackAlbum,
        year: slice.trackYear,
      },
    }))

    res.json({
      samples: result,
      total: result.length,
    })
  } catch (error) {
    console.error('Error fetching sources samples:', error)
    res.status(500).json({ error: 'Failed to fetch samples' })
  }
})

// Helper function to auto-tag a slice using audio analysis
async function autoTagSlice(sliceId: number, audioPath: string, analysisLevel?: 'quick' | 'standard' | 'advanced'): Promise<void> {
  try {
    const level = analysisLevel || 'advanced'
    console.log(`Running audio analysis on slice ${sliceId} (level: ${level})...`)

    // Analyze audio with Python (Essentia + Librosa)
    const features = await analyzeAudioFeatures(audioPath, level)
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
    await storeAudioFeatures(sliceId, enrichedFeatures)

    // Convert features to tags
    const tagNames = featuresToTags(features)

    // Get existing tags for this slice to avoid duplicating filename-derived tags
    const existingSliceTags = await db
      .select({ name: schema.tags.name })
      .from(schema.sliceTags)
      .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
      .where(eq(schema.sliceTags.sliceId, sliceId))
    const existingTagNames = new Set(existingSliceTags.map(t => t.name.toLowerCase()))

    if (tagNames.length === 0) {
      console.log(`No tags generated for slice ${sliceId}`)
      return
    }

    console.log(`Applying ${tagNames.length} tags to slice ${sliceId}:`, tagNames.join(', '))

    // Create tags and link them to the slice
    for (const tagName of tagNames) {
      const lowerTag = tagName.toLowerCase()
      if (existingTagNames.has(lowerTag)) continue // Skip already-applied tags
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
    console.error(`Error auto-tagging slice ${sliceId}:`, error)
    // Don't throw - auto-tagging is optional
  }
}

// Get ALL slices (for Samples browser)
router.get('/slices', async (_req, res) => {
  try {
    // Get all slices with their parent track info
    const slices = await db
      .select({
        id: schema.slices.id,
        trackId: schema.slices.trackId,
        name: schema.slices.name,
        startTime: schema.slices.startTime,
        endTime: schema.slices.endTime,
        filePath: schema.slices.filePath,
        favorite: schema.slices.favorite,
        sampleModified: schema.slices.sampleModified,
        sampleModifiedAt: schema.slices.sampleModifiedAt,
        createdAt: schema.slices.createdAt,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .orderBy(schema.slices.createdAt)

    // Get tags for all slices
    const sliceIds = slices.map((s) => s.id)
    const sliceTagsResult =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.sliceTags)
            .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
            .where(inArray(schema.sliceTags.sliceId, sliceIds))
        : []

    const tagsBySlice = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of sliceTagsResult) {
      const sliceId = row.slice_tags.sliceId
      if (!tagsBySlice.has(sliceId)) {
        tagsBySlice.set(sliceId, [])
      }
      tagsBySlice.get(sliceId)!.push(row.tags)
    }

    // Get folder memberships for all slices
    const folderLinks =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.folderSlices)
            .where(inArray(schema.folderSlices.sliceId, sliceIds))
        : []

    const foldersBySlice = new Map<number, number[]>()
    for (const row of folderLinks) {
      if (!foldersBySlice.has(row.sliceId)) {
        foldersBySlice.set(row.sliceId, [])
      }
      foldersBySlice.get(row.sliceId)!.push(row.folderId)
    }

    const result = slices.map((slice) => ({
      id: slice.id,
      trackId: slice.trackId,
      name: slice.name,
      startTime: slice.startTime,
      endTime: slice.endTime,
      filePath: slice.filePath,
      favorite: slice.favorite === 1,
      sampleModified: slice.sampleModified === 1,
      sampleModifiedAt: slice.sampleModifiedAt,
      createdAt: slice.createdAt,
      tags: tagsBySlice.get(slice.id) || [],
      folderIds: foldersBySlice.get(slice.id) || [],
      track: {
        title: slice.trackTitle,
        youtubeId: slice.trackYoutubeId,
      },
    }))

    res.json(result)
  } catch (error) {
    console.error('Error fetching all slices:', error)
    res.status(500).json({ error: 'Failed to fetch slices' })
  }
})

// Get slices for a track
router.get('/tracks/:trackId/slices', async (req, res) => {
  const trackId = parseInt(req.params.trackId)

  try {
    const slices = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.trackId, trackId))
      .orderBy(schema.slices.startTime)

    // Get tags for each slice
    const sliceIds = slices.map((s) => s.id)
    const sliceTagsResult =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.sliceTags)
            .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
            .where(inArray(schema.sliceTags.sliceId, sliceIds))
        : []

    const tagsBySlice = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of sliceTagsResult) {
      const sliceId = row.slice_tags.sliceId
      if (!tagsBySlice.has(sliceId)) {
        tagsBySlice.set(sliceId, [])
      }
      tagsBySlice.get(sliceId)!.push(row.tags)
    }

    const result = slices.map((slice) => ({
      ...slice,
      tags: tagsBySlice.get(slice.id) || [],
    }))

    res.json(result)
  } catch (error) {
    console.error('Error fetching slices:', error)
    res.status(500).json({ error: 'Failed to fetch slices' })
  }
})

// Create slice
router.post('/tracks/:trackId/slices', async (req, res) => {
  const trackId = parseInt(req.params.trackId)
  const { name, startTime, endTime, analysisLevel } = req.body as {
    name: string
    startTime: number
    endTime: number
    analysisLevel?: 'quick' | 'standard' | 'advanced'
  }

  if (!name || startTime === undefined || endTime === undefined) {
    return res.status(400).json({ error: 'Name, startTime, and endTime required' })
  }

  if (startTime >= endTime) {
    return res.status(400).json({ error: 'startTime must be less than endTime' })
  }

  try {
    // Get track
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, trackId))
      .limit(1)

    if (track.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }

    if (!track[0].audioPath) {
      return res.status(400).json({ error: 'Track audio not ready' })
    }

    // Create slice directory
    const slicesDir = path.join(DATA_DIR, 'slices')
    await fs.mkdir(slicesDir, { recursive: true })

    // Insert slice record first to get ID
    const [inserted] = await db
      .insert(schema.slices)
      .values({
        trackId,
        name,
        startTime,
        endTime,
        createdAt: new Date().toISOString(),
      })
      .returning()

    // Extract slice audio
    const sliceFileName = `${track[0].youtubeId}_${inserted.id}.mp3`
    const slicePath = path.join(slicesDir, sliceFileName)

    try {
      await extractSlice(track[0].audioPath, slicePath, startTime, endTime)

      // Update slice with file path
      await db
        .update(schema.slices)
        .set({ filePath: slicePath })
        .where(eq(schema.slices.id, inserted.id))

      inserted.filePath = slicePath

      // Auto-tag the slice with YAMNet (run in background)
      autoTagSlice(inserted.id, slicePath, analysisLevel).catch(err => {
        console.error('Background auto-tagging failed:', err)
      })
    } catch (err) {
      console.error('Failed to extract slice audio:', err)
      // Slice exists but without file - that's ok
    }

    res.json({ ...inserted, tags: [] })
  } catch (error) {
    console.error('Error creating slice:', error)
    res.status(500).json({ error: 'Failed to create slice' })
  }
})

// Update slice
router.put('/slices/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, startTime, endTime } = req.body as {
    name?: string
    startTime?: number
    endTime?: number
  }

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    const updates: Partial<typeof schema.slices.$inferSelect> = {}
    if (name !== undefined) updates.name = name
    if (startTime !== undefined) updates.startTime = startTime
    if (endTime !== undefined) updates.endTime = endTime

    if (name !== undefined || startTime !== undefined || endTime !== undefined) {
      updates.sampleModified = 1
      updates.sampleModifiedAt = new Date().toISOString()
    }

    // If time changed, regenerate slice audio
    if (startTime !== undefined || endTime !== undefined) {
      const track = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.id, slice[0].trackId))
        .limit(1)

      if (track[0]?.audioPath) {
        const newStart = startTime ?? slice[0].startTime
        const newEnd = endTime ?? slice[0].endTime

        if (slice[0].filePath) {
          try {
            await extractSlice(track[0].audioPath, slice[0].filePath, newStart, newEnd)

            // Re-run audio analysis since audio changed
            autoTagSlice(slice[0].id, slice[0].filePath).catch(err => {
              console.error('Background auto-tagging failed:', err)
            })
          } catch (err) {
            console.error('Failed to re-extract slice:', err)
          }
        }
      }
    }

    const [updated] = await db
      .update(schema.slices)
      .set(updates)
      .where(eq(schema.slices.id, id))
      .returning()

    res.json(updated)
  } catch (error) {
    console.error('Error updating slice:', error)
    res.status(500).json({ error: 'Failed to update slice' })
  }
})

// Delete slice
router.delete('/slices/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const deleteSource = req.query.deleteSource === 'true'

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    // Delete file if requested and it exists
    if (deleteSource && slice[0].filePath) {
      try {
        await fs.unlink(slice[0].filePath)
      } catch (err: any) {
        // File might not exist or we don't have permission
        console.warn('Could not delete source file:', err.message)
      }
    }

    await db.delete(schema.slices).where(eq(schema.slices.id, id))

    res.json({ success: true, deletedSource: deleteSource && slice[0].filePath ? true : false })
  } catch (error) {
    console.error('Error deleting slice:', error)
    res.status(500).json({ error: 'Failed to delete slice' })
  }
})

// Batch download slices as ZIP
router.post('/slices/batch-download', async (req, res) => {
  const { sliceIds } = req.body as { sliceIds?: number[] }

  if (!Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  const uniqueSliceIds = Array.from(
    new Set(
      sliceIds
        .map((id) => Number.parseInt(String(id), 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  )

  if (uniqueSliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    const slices = await db
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
      })
      .from(schema.slices)
      .where(inArray(schema.slices.id, uniqueSliceIds))

    if (slices.length === 0) {
      return res.status(404).json({ error: 'No slices found for download' })
    }

    const orderById = new Map(uniqueSliceIds.map((id, index) => [id, index]))
    const orderedSlices = [...slices].sort(
      (a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0)
    )

    const usedNames = new Map<string, number>()
    const filesToArchive: Array<{ filePath: string; entryName: string }> = []

    for (const slice of orderedSlices) {
      if (!slice.filePath) continue

      const absolutePath = path.resolve(slice.filePath)

      try {
        await fs.access(absolutePath)
      } catch {
        continue
      }

      const extension = path.extname(slice.filePath) || '.mp3'
      const baseName = sanitizeArchiveEntryBaseName(slice.name || `slice-${slice.id}`)
      const entryName = createUniqueArchiveEntryName(baseName, extension, usedNames)
      filesToArchive.push({ filePath: absolutePath, entryName })
    }

    if (filesToArchive.length === 0) {
      return res.status(404).json({ error: 'No downloadable slice files found' })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archiveFileName = `samples-${timestamp}.zip`

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${archiveFileName}"`)

    const archive = archiver('zip', {
      zlib: { level: 9 },
    })

    archive.on('warning', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        console.warn('Archive warning (missing file):', err.message)
        return
      }

      console.error('Archive warning during batch download:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP archive' })
      } else {
        res.end()
      }
    })

    archive.on('error', (err: Error) => {
      console.error('Archive error during batch download:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP archive' })
      } else {
        res.end()
      }
    })

    archive.pipe(res)

    for (const file of filesToArchive) {
      archive.file(file.filePath, { name: file.entryName })
    }

    await archive.finalize()
  } catch (error) {
    console.error('Error batch downloading slices:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to batch download slices' })
    } else {
      res.end()
    }
  }
})

// Stream slice audio (for playback)
router.get('/slices/:id/download', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0 || !slice[0].filePath) {
      return res.status(404).json({ error: 'Slice file not found' })
    }

    // Stream audio inline for playback (not as attachment download)
    res.type('audio/mpeg')
    res.sendFile(path.resolve(slice[0].filePath), { acceptRanges: true })
  } catch (error) {
    console.error('Error streaming slice:', error)
    res.status(500).json({ error: 'Failed to stream slice' })
  }
})

// Batch generate AI tags for multiple slices
router.post('/slices/batch-ai-tags', async (req, res) => {
  const { sliceIds } = req.body as { sliceIds: number[] }

  if (!sliceIds || !Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    // Get all slices with file paths
    const slices = await db
      .select()
      .from(schema.slices)
      .where(inArray(schema.slices.id, sliceIds))

    const results: {
      sliceId: number
      success: boolean
      error?: string
      hadPotentialCustomState?: boolean
      warningMessage?: string
      removedTags?: string[]
      addedTags?: string[]
    }[] = []
    const warningMessages: string[] = []
    const warningSliceIds = new Set<number>()

    // Process slices with concurrency limit
    const CONCURRENCY = 3
    for (let i = 0; i < slices.length; i += CONCURRENCY) {
      const batch = slices.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map(async (slice) => {
          if (!slice.filePath) {
            return { sliceId: slice.id, success: false, error: 'No audio file' }
          }
          try {
            const beforeTags = await getSliceTagNames(slice.id)
            const beforeAutoTagRows = await db
              .select({ name: schema.tags.name })
              .from(schema.sliceTags)
              .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
              .where(
                and(
                  eq(schema.sliceTags.sliceId, slice.id),
                  inArray(schema.tags.category, [...AUTO_REANALYSIS_TAG_CATEGORIES])
                )
              )
            const beforeAutoTags = beforeAutoTagRows.map((row) => row.name.toLowerCase())

            await autoTagSlice(slice.id, slice.filePath)

            const afterTags = await getSliceTagNames(slice.id)
            const { removedTags, addedTags } = computeTagDiff(beforeTags, afterTags)
            const afterAutoTagRows = await db
              .select({ name: schema.tags.name })
              .from(schema.sliceTags)
              .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
              .where(
                and(
                  eq(schema.sliceTags.sliceId, slice.id),
                  inArray(schema.tags.category, [...AUTO_REANALYSIS_TAG_CATEGORIES])
                )
              )
            const afterAutoTags = afterAutoTagRows.map((row) => row.name.toLowerCase())

            const autoTagChanged =
              beforeAutoTags.length > 0 &&
              (
                beforeAutoTags.some((tag) => !afterAutoTags.includes(tag)) ||
                afterAutoTags.some((tag) => !beforeAutoTags.includes(tag))
              )

            let warningMessage: string | null = null
            if (autoTagChanged || slice.sampleModified === 1) {
              warningMessage = autoTagChanged
                ? `Slice ${slice.id} had custom/changed AI tag state before analysis. Changes detected: -${removedTags.length} +${addedTags.length}.`
                : `Slice ${slice.id} was manually modified before analysis.`
            }

            await db.insert(schema.reanalysisLogs).values({
              sliceId: slice.id,
              beforeTags: JSON.stringify(beforeTags),
              afterTags: JSON.stringify(afterTags),
              removedTags: JSON.stringify(removedTags),
              addedTags: JSON.stringify(addedTags),
              hadPotentialCustomState: warningMessage ? 1 : 0,
              warningMessage,
            })

            if (warningMessage) {
              warningMessages.push(warningMessage)
              warningSliceIds.add(slice.id)
            }

            return {
              sliceId: slice.id,
              success: true,
              hadPotentialCustomState: Boolean(warningMessage),
              warningMessage: warningMessage ?? undefined,
              removedTags,
              addedTags,
            }
          } catch (error) {
            return {
              sliceId: slice.id,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        })
      )
      results.push(...batchResults)
    }

    res.json({
      total: sliceIds.length,
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      warnings: {
        totalWithWarnings: warningSliceIds.size,
        sliceIds: Array.from(warningSliceIds),
        messages: warningMessages,
      },
      results,
    })
  } catch (error) {
    console.error('Error batch generating AI tags:', error)
    res.status(500).json({ error: 'Failed to batch generate AI tags' })
  }
})

// Get all slices with audio features for Sample Space visualization
router.get('/slices/features', async (_req, res) => {
  try {
    const results = await db
      .select({
        // Slice info
        id: schema.slices.id,
        name: schema.slices.name,
        trackId: schema.slices.trackId,
        filePath: schema.slices.filePath,
        // Audio features
        duration: schema.audioFeatures.duration,
        bpm: schema.audioFeatures.bpm,
        onsetCount: schema.audioFeatures.onsetCount,
        spectralCentroid: schema.audioFeatures.spectralCentroid,
        spectralRolloff: schema.audioFeatures.spectralRolloff,
        spectralBandwidth: schema.audioFeatures.spectralBandwidth,
        spectralContrast: schema.audioFeatures.spectralContrast,
        zeroCrossingRate: schema.audioFeatures.zeroCrossingRate,
        mfccMean: schema.audioFeatures.mfccMean,
        rmsEnergy: schema.audioFeatures.rmsEnergy,
        loudness: schema.audioFeatures.loudness,
        dynamicRange: schema.audioFeatures.dynamicRange,
        keyEstimate: schema.audioFeatures.keyEstimate,
        keyStrength: schema.audioFeatures.keyStrength,
        attackTime: schema.audioFeatures.attackTime,
        spectralFlux: schema.audioFeatures.spectralFlux,
        spectralFlatness: schema.audioFeatures.spectralFlatness,
        kurtosis: schema.audioFeatures.kurtosis,
        temporalCentroid: schema.audioFeatures.temporalCentroid,
        crestFactor: schema.audioFeatures.crestFactor,
        transientSpectralCentroid: schema.audioFeatures.transientSpectralCentroid,
        transientSpectralFlatness: schema.audioFeatures.transientSpectralFlatness,
        sampleTypeConfidence: schema.audioFeatures.sampleTypeConfidence,
        polyphony: schema.audioFeatures.polyphony,
      })
      .from(schema.slices)
      .innerJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    // Parse mfccMean JSON strings
    const parsed = results.map((r) => ({
      ...r,
      mfccMean: r.mfccMean ? JSON.parse(r.mfccMean) : null,
    }))

    res.json(parsed)
  } catch (error) {
    console.error('Error fetching slice features:', error)
    res.status(500).json({ error: 'Failed to fetch slice features' })
  }
})

// GET /api/slices/:id/features - Get audio features for a specific slice
router.get('/slices/:id/features', async (req, res) => {
  const sliceId = parseInt(req.params.id)

  try {
    // Get the slice info
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    // Get audio features
    const features = await db
      .select()
      .from(schema.audioFeatures)
      .where(eq(schema.audioFeatures.sliceId, sliceId))
      .limit(1)

    if (features.length === 0) {
      return res.status(404).json({ error: 'Audio features not found for this slice' })
    }

    const feature = features[0]

    // Parse JSON fields
    const mfccMean = feature.mfccMean ? JSON.parse(feature.mfccMean) : null
    const tristimulus = feature.tristimulus ? JSON.parse(feature.tristimulus) : null
    const melBandsMean = feature.melBandsMean ? JSON.parse(feature.melBandsMean) : null
    const melBandsStd = feature.melBandsStd ? JSON.parse(feature.melBandsStd) : null
    const yamnetEmbeddings = feature.yamnetEmbeddings ? JSON.parse(feature.yamnetEmbeddings) : null
    const instrumentClasses = feature.instrumentClasses ? JSON.parse(feature.instrumentClasses) : null
    const genreClasses = feature.genreClasses ? JSON.parse(feature.genreClasses) : null
    const moodClasses = feature.moodClasses ? JSON.parse(feature.moodClasses) : null

    // Return all features
    res.json({
      id: slice[0].id,
      name: slice[0].name,
      trackId: slice[0].trackId,
      filePath: slice[0].filePath,
      sampleRate: feature.sampleRate,
      channels: feature.channels,
      format: feature.fileFormat,
      dateModified: feature.sourceMtime,
      dateCreated: feature.sourceCtime,
      dateAdded: slice[0].createdAt,
      isOneShot: feature.isOneShot,
      isLoop: feature.isLoop,
      fundamentalFrequency: feature.fundamentalFrequency,
      polyphony: feature.polyphony,
      duration: feature.duration,
      bpm: feature.bpm,
      onsetCount: feature.onsetCount,
      spectralCentroid: feature.spectralCentroid,
      spectralRolloff: feature.spectralRolloff,
      spectralBandwidth: feature.spectralBandwidth,
      spectralContrast: feature.spectralContrast,
      zeroCrossingRate: feature.zeroCrossingRate,
      mfccMean,
      rmsEnergy: feature.rmsEnergy,
      loudness: feature.loudness,
      dynamicRange: feature.dynamicRange,
      keyEstimate: feature.keyEstimate,
      scale: feature.scale,
      keyStrength: feature.keyStrength,
      attackTime: feature.attackTime,
      spectralFlux: feature.spectralFlux,
      spectralFlatness: feature.spectralFlatness,
      kurtosis: feature.kurtosis,
      dissonance: feature.dissonance,
      inharmonicity: feature.inharmonicity,
      tristimulus,
      spectralComplexity: feature.spectralComplexity,
      spectralCrest: feature.spectralCrest,
      brightness: feature.brightness,
      warmth: feature.warmth,
      hardness: feature.hardness,
      noisiness: feature.noisiness,
      roughness: feature.roughness,
      sharpness: feature.sharpness,
      melBandsMean,
      melBandsStd,
      stereoWidth: feature.stereoWidth,
      panningCenter: feature.panningCenter,
      stereoImbalance: feature.stereoImbalance,
      harmonicPercussiveRatio: feature.harmonicPercussiveRatio,
      harmonicEnergy: feature.harmonicEnergy,
      percussiveEnergy: feature.percussiveEnergy,
      harmonicCentroid: feature.harmonicCentroid,
      percussiveCentroid: feature.percussiveCentroid,
      onsetRate: feature.onsetRate,
      beatStrength: feature.beatStrength,
      rhythmicRegularity: feature.rhythmicRegularity,
      danceability: feature.danceability,
      decayTime: feature.decayTime,
      sustainLevel: feature.sustainLevel,
      releaseTime: feature.releaseTime,
      envelopeType: feature.envelopeType,
      instrumentClasses,
      genreClasses,
      genrePrimary: feature.genrePrimary,
      yamnetEmbeddings,
      moodClasses,
      loudnessIntegrated: feature.loudnessIntegrated,
      loudnessRange: feature.loudnessRange,
      loudnessMomentaryMax: feature.loudnessMomentaryMax,
      truePeak: feature.truePeak,
      eventCount: feature.eventCount,
      eventDensity: feature.eventDensity,
      chromaprintFingerprint: feature.chromaprintFingerprint,
      temporalCentroid: feature.temporalCentroid,
      crestFactor: feature.crestFactor,
      transientSpectralCentroid: feature.transientSpectralCentroid,
      transientSpectralFlatness: feature.transientSpectralFlatness,
      sampleTypeConfidence: feature.sampleTypeConfidence,
      analysisLevel: feature.analysisLevel,
    })
  } catch (error) {
    console.error('Error fetching audio features for slice:', error)
    res.status(500).json({ error: 'Failed to fetch audio features' })
  }
})

// Toggle favorite status
router.post('/slices/:id/favorite', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    const newFavorite = slice[0].favorite === 1 ? 0 : 1

    await db
      .update(schema.slices)
      .set({ favorite: newFavorite })
      .where(eq(schema.slices.id, id))

    res.json({ favorite: newFavorite === 1 })
  } catch (error) {
    console.error('Error toggling favorite:', error)
    res.status(500).json({ error: 'Failed to toggle favorite' })
  }
})

// Batch delete slices
router.post('/slices/batch-delete', async (req, res) => {
  const { sliceIds } = req.body as { sliceIds: number[] }

  if (!sliceIds || !Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    // Get all slices to delete (to get file paths)
    const slices = await db
      .select()
      .from(schema.slices)
      .where(inArray(schema.slices.id, sliceIds))

    const results: { sliceId: number; success: boolean; error?: string }[] = []

    // Delete each slice and its file
    for (const slice of slices) {
      try {
        // Delete file if it exists
        if (slice.filePath) {
          await fs.unlink(slice.filePath).catch(() => {})
        }

        // Delete from database
        await db.delete(schema.slices).where(eq(schema.slices.id, slice.id))
        results.push({ sliceId: slice.id, success: true })
      } catch (error) {
        results.push({
          sliceId: slice.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      total: sliceIds.length,
      deleted: results.filter((r) => r.success).length,
      results,
    })
  } catch (error) {
    console.error('Error batch deleting slices:', error)
    res.status(500).json({ error: 'Failed to batch delete slices' })
  }
})

// POST /api/slices/batch-reanalyze - Re-analyze all or selected slices
router.post('/slices/batch-reanalyze', async (req, res) => {
  try {
    const { sliceIds, analysisLevel, concurrency, includeFilenameTags } = req.body as {
      sliceIds?: number[]
      analysisLevel?: 'quick' | 'standard' | 'advanced'
      concurrency?: number
      includeFilenameTags?: boolean
    }

    // Get slices to re-analyze (join with tracks to get folderPath for filename tagging)
    const slicesToAnalyze = sliceIds && sliceIds.length > 0
      ? await db
          .select({
            id: schema.slices.id,
            name: schema.slices.name,
            filePath: schema.slices.filePath,
            trackId: schema.slices.trackId,
            sampleModified: schema.slices.sampleModified,
            folderPath: schema.tracks.folderPath,
          })
          .from(schema.slices)
          .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
          .where(inArray(schema.slices.id, sliceIds))
      : await db
          .select({
            id: schema.slices.id,
            name: schema.slices.name,
            filePath: schema.slices.filePath,
            trackId: schema.slices.trackId,
            sampleModified: schema.slices.sampleModified,
            folderPath: schema.tracks.folderPath,
          })
          .from(schema.slices)
          .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))

    if (slicesToAnalyze.length === 0) {
      return res.json({
        total: 0,
        analyzed: 0,
        failed: 0,
        results: [],
      })
    }

    // Clean up bad tags (AudioSet ontology labels that leaked through)
    const badTags = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(like(schema.tags.name, '%/m/%'))
    if (badTags.length > 0) {
      const badTagIds = badTags.map(t => t.id)
      await db.delete(schema.sliceTags).where(inArray(schema.sliceTags.tagId, badTagIds))
      await db.delete(schema.tags).where(inArray(schema.tags.id, badTagIds))
      console.log(`Cleaned up ${badTags.length} bad AudioSet ontology tags`)
    }

    // Configurable concurrency (1-10, default 2 to avoid OOM with heavy Python processes)
    const CHUNK_SIZE = Math.max(1, Math.min(10, concurrency || 2))
    const results: Array<{
      sliceId: number
      success: boolean
      error?: string
      hadPotentialCustomState?: boolean
      warningMessage?: string
      removedTags?: string[]
      addedTags?: string[]
    }> = []
    const warningMessages: string[] = []
    const warningSliceIds = new Set<number>()

    // Process in chunks
    for (let i = 0; i < slicesToAnalyze.length; i += CHUNK_SIZE) {
      const chunk = slicesToAnalyze.slice(i, i + CHUNK_SIZE)

      await Promise.all(
        chunk.map(async (slice) => {
          try {
            if (!slice.filePath) {
              results.push({
                sliceId: slice.id,
                success: false,
                error: 'No file path',
              })
              return
            }

            // Check if file exists
            // Handle both absolute paths and relative paths (strip leading 'data/' if present)
            let filePath = slice.filePath
            if (!path.isAbsolute(filePath)) {
              // Remove 'data/' prefix if present to avoid duplication with DATA_DIR
              if (filePath.startsWith('data/')) {
                filePath = filePath.substring(5) // Remove 'data/'
              }
              filePath = path.join(DATA_DIR, filePath)
            }

            try {
              await fs.access(filePath)
            } catch {
              results.push({
                sliceId: slice.id,
                success: false,
                error: 'File not found',
              })
              return
            }

            const beforeTags = await getSliceTagNames(slice.id)
            const beforeAutoTagRows = await db
              .select({ name: schema.tags.name })
              .from(schema.sliceTags)
              .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
              .where(
                and(
                  eq(schema.sliceTags.sliceId, slice.id),
                  inArray(schema.tags.category, [...AUTO_REANALYSIS_TAG_CATEGORIES])
                )
              )
            const beforeAutoTags = beforeAutoTagRows.map((row) => row.name.toLowerCase())

            // Re-analyze the audio
            const features = await analyzeAudioFeatures(filePath, analysisLevel)
            const fileMetadata = await getAudioFileMetadata(filePath).catch(() => null)
            const enrichedFeatures = {
              ...features,
              sampleRate: fileMetadata?.sampleRate ?? features.sampleRate,
              channels: fileMetadata?.channels ?? undefined,
              fileFormat: fileMetadata?.format ?? undefined,
              sourceMtime: fileMetadata?.modifiedAt ?? undefined,
              sourceCtime: fileMetadata?.createdAt ?? undefined,
            }
            const suggestedAutoTags = Array.from(
              new Set((features.suggestedTags || []).map((tag: string) => tag.toLowerCase()))
            )

            // Store updated features
            await storeAudioFeatures(slice.id, enrichedFeatures)

            // Clear existing auto-generated tags before adding new ones
            // Keep only filename-category tags (user-created from filenames)
            await db.run(sql`
              DELETE FROM slice_tags WHERE slice_id = ${slice.id}
              AND tag_id IN (
                SELECT id FROM tags WHERE category IN (${AUTO_REANALYSIS_TAG_CATEGORIES[0]}, ${AUTO_REANALYSIS_TAG_CATEGORIES[1]}, ${AUTO_REANALYSIS_TAG_CATEGORIES[2]}, ${AUTO_REANALYSIS_TAG_CATEGORIES[3]}, ${AUTO_REANALYSIS_TAG_CATEGORIES[4]}, ${AUTO_REANALYSIS_TAG_CATEGORIES[5]})
              )
            `)

            // Update tags if suggestedTags exist
            if (features.suggestedTags && features.suggestedTags.length > 0) {
              // Get or create tags
              const tagPromises = features.suggestedTags.map(async (tagName: string) => {
                const existingTag = await db
                  .select()
                  .from(schema.tags)
                  .where(eq(schema.tags.name, tagName))
                  .get()

                if (existingTag) {
                  return existingTag
                }

                // Create new tag
                const metadata = getTagMetadata(tagName)
                const result = await db
                  .insert(schema.tags)
                  .values({
                    name: tagName,
                    color: metadata.color,
                    category: metadata.category,
                  })
                  .returning()

                return result[0]
              })

              const tags = await Promise.all(tagPromises)

              // Link tags to slice
              for (const tag of tags) {
                await db
                  .insert(schema.sliceTags)
                  .values({
                    sliceId: slice.id,
                    tagId: tag.id,
                  })
                  .onConflictDoNothing()
              }
            }

            // Apply filename-derived tags if enabled
            if (includeFilenameTags && slice.name) {
              const filenameTags = parseFilenameTags(slice.name, slice.folderPath ?? null)
              for (const ft of filenameTags) {
                const lowerTag = ft.tag.toLowerCase()
                try {
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
                        color: '#f472b6',
                        category: 'filename',
                      })
                      .returning()
                    tag = [newTag]
                  }

                  await db
                    .insert(schema.sliceTags)
                    .values({ sliceId: slice.id, tagId: tag[0].id })
                    .onConflictDoNothing()
                } catch {
                  // Ignore duplicate tag errors
                }
              }
            }

            const afterTags = await getSliceTagNames(slice.id)
            const { removedTags, addedTags } = computeTagDiff(beforeTags, afterTags)

            const beforeAutoSet = new Set(beforeAutoTags)
            const suggestedAutoSet = new Set(suggestedAutoTags)
            const autoTagStateChanged =
              beforeAutoTags.some((tag) => !suggestedAutoSet.has(tag)) ||
              suggestedAutoTags.some((tag) => !beforeAutoSet.has(tag))

            let warningMessage: string | null = null
            if (autoTagStateChanged || slice.sampleModified === 1) {
              warningMessage = autoTagStateChanged
                ? `Slice ${slice.id} had custom/changed AI tag state before re-analysis. Changes detected: -${removedTags.length} +${addedTags.length}.`
                : `Slice ${slice.id} was manually modified before re-analysis.`
            }

            await db.insert(schema.reanalysisLogs).values({
              sliceId: slice.id,
              beforeTags: JSON.stringify(beforeTags),
              afterTags: JSON.stringify(afterTags),
              removedTags: JSON.stringify(removedTags),
              addedTags: JSON.stringify(addedTags),
              hadPotentialCustomState: warningMessage ? 1 : 0,
              warningMessage,
            })

            if (warningMessage) {
              warningMessages.push(warningMessage)
              warningSliceIds.add(slice.id)
            }

            results.push({
              sliceId: slice.id,
              success: true,
              hadPotentialCustomState: Boolean(warningMessage),
              warningMessage: warningMessage ?? undefined,
              removedTags,
              addedTags,
            })

            await db
              .update(schema.slices)
              .set({
                sampleModified: 0,
                sampleModifiedAt: null,
              })
              .where(eq(schema.slices.id, slice.id))
          } catch (error) {
            console.error(`Error re-analyzing slice ${slice.id}:`, error)
            results.push({
              sliceId: slice.id,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        })
      )

      // Small delay between chunks to avoid overwhelming the system
      if (i + CHUNK_SIZE < slicesToAnalyze.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    const analyzed = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    res.json({
      total: slicesToAnalyze.length,
      analyzed,
      failed,
      warnings: {
        totalWithWarnings: warningSliceIds.size,
        sliceIds: Array.from(warningSliceIds),
        messages: warningMessages,
      },
      results,
    })
  } catch (error) {
    console.error('Error batch re-analyzing slices:', error)
    res.status(500).json({ error: 'Failed to batch re-analyze slices' })
  }
})

// Phase 6: Similarity Detection Endpoints

// Helper function to calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))

  if (magA === 0 || magB === 0) return 0
  return dotProduct / (magA * magB)
}

// Build a normalized feature vector from scalar audio features.
// Used as fallback when YAMNet embeddings are unavailable.
function buildScalarFeatureVector(f: Record<string, any>): number[] | null {
  const vec: number[] = []
  let populated = 0

  const push = (val: any, scale: number, weight = 1) => {
    const n = typeof val === 'number' && Number.isFinite(val) ? val : null
    vec.push(n !== null ? Math.min(Math.max(n / scale, -2), 2) * weight : 0)
    if (n !== null) populated++
  }

  // Core spectral features – present at every analysis level
  push(f.spectralCentroid, 8000, 2)
  push(f.spectralRolloff, 12000, 1.5)
  push(f.spectralBandwidth, 4000, 1)
  push(f.spectralFlux, 1, 1)
  push(f.spectralFlatness, 1, 1)
  push(f.zeroCrossingRate, 1, 1.5)
  push(f.rmsEnergy, 1, 1.5)
  push(f.attackTime, 1, 1)
  push(f.kurtosis, 50, 0.5)

  // Perceptual / Phase-1 features (0-1 normalised, present after standard analysis)
  push(f.brightness, 1, 2)
  push(f.warmth, 1, 2)
  push(f.hardness, 1, 1.5)
  push(f.sharpness, 1, 1)

  // Rhythmic / pitch
  push(f.bpm, 200, 1.5)
  push(f.fundamentalFrequency, 2000, 1)

  // MFCC coefficients 1-12 (skip 0 – encodes loudness, already covered)
  if (f.mfccMean) {
    try {
      const mfcc = JSON.parse(f.mfccMean) as number[]
      for (let i = 1; i <= 12; i++) {
        const v = mfcc[i]
        vec.push(typeof v === 'number' && Number.isFinite(v) ? v / 30 : 0)
        if (typeof v === 'number' && Number.isFinite(v)) populated++
      }
    } catch {
      for (let k = 0; k < 12; k++) vec.push(0)
    }
  } else {
    for (let k = 0; k < 12; k++) vec.push(0)
  }

  return populated >= 3 ? vec : null
}

// GET /api/slices/:id/similar - Find similar samples based on YAMNet embeddings
router.get('/slices/:id/similar', async (req, res) => {
  const sliceId = Number.parseInt(req.params.id, 10)
  const limit = parseInt(req.query.limit as string) || 20

  if (Number.isNaN(sliceId)) {
    return res.status(400).json({ error: 'Invalid slice id' })
  }

  try {
    // Get target slice's audio features with embeddings
    const targetFeatures = await db
      .select()
      .from(schema.audioFeatures)
      .where(eq(schema.audioFeatures.sliceId, sliceId))
      .limit(1)
      

    if (targetFeatures.length === 0) {
      return res.json([])
    }

    const target = targetFeatures[0]
    let similarities: { sliceId: number; similarity: number }[] = []

    if (target.yamnetEmbeddings) {
      // Best quality: use 1024-dim YAMNet embeddings
      const targetEmbeddings = JSON.parse(target.yamnetEmbeddings) as number[]
      const allFeatures = await db
        .select({
          sliceId: schema.audioFeatures.sliceId,
          yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
        })
        .from(schema.audioFeatures)
        .where(sql`${schema.audioFeatures.sliceId} != ${sliceId} AND ${schema.audioFeatures.yamnetEmbeddings} IS NOT NULL`)

      similarities = allFeatures
        .map(f => {
          const candidateSliceId = Number(f.sliceId)
          if (Number.isNaN(candidateSliceId)) return null
          const embeddings = JSON.parse(f.yamnetEmbeddings!) as number[]
          return { sliceId: candidateSliceId, similarity: cosineSimilarity(targetEmbeddings, embeddings) }
        })
        .filter((s): s is { sliceId: number; similarity: number } => Boolean(s))
        .filter(s => s.sliceId !== sliceId && s.similarity > 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
    } else {
      // Fallback: cosine similarity over normalised scalar audio features
      const targetVec = buildScalarFeatureVector(target)
      if (targetVec) {
        const allFeatures = await db
          .select()
          .from(schema.audioFeatures)
          .where(sql`${schema.audioFeatures.sliceId} != ${sliceId}`)

        similarities = allFeatures
          .map(f => {
            const candidateSliceId = Number(f.sliceId)
            if (Number.isNaN(candidateSliceId)) return null
            const candidateVec = buildScalarFeatureVector(f)
            if (!candidateVec) return null
            return { sliceId: candidateSliceId, similarity: cosineSimilarity(targetVec, candidateVec) }
          })
          .filter((s): s is { sliceId: number; similarity: number } => Boolean(s))
          .filter(s => s.sliceId !== sliceId && s.similarity > 0.5)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit)
      }
    }

    // Get slice details for similar samples
    const similarSliceIds = Array.from(new Set(similarities.map(s => s.sliceId)))
      .filter(id => id !== sliceId)

    if (similarSliceIds.length === 0) {
      return res.json([])
    }

    const slices = await db
      .select({
        id: schema.slices.id,
        trackId: schema.slices.trackId,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(inArray(schema.slices.id, similarSliceIds))

    // Map similarity scores to slices
    const results = slices
      .filter(slice => Number(slice.id) !== sliceId) // Final safeguard against self-inclusion
      .map(slice => {
      const sim = similarities.find(s => Number(s.sliceId) === Number(slice.id))
      return {
        ...slice,
        similarity: sim?.similarity || 0,
        track: {
          title: slice.trackTitle,
          youtubeId: slice.trackYoutubeId,
        },
      }
    }).sort((a, b) => b.similarity - a.similarity)

    res.json(results)
  } catch (error) {
    console.error('Error finding similar slices:', error)
    res.status(500).json({ error: 'Failed to find similar slices' })
  }
})

// GET /api/slices/duplicates - Find potential duplicate samples based on chromaprint fingerprint
router.get('/slices/duplicates', async (_req, res) => {
  try {
    // Collect fingerprint + path identity data so we can catch both true audio dupes
    // and obvious duplicated imports when fingerprint is missing.
    const allRows = await db
      .select({
        sliceId: schema.slices.id,
        chromaprintFingerprint: schema.audioFeatures.chromaprintFingerprint,
        filePath: schema.slices.filePath,
        startTime: schema.slices.startTime,
        endTime: schema.slices.endTime,
        trackOriginalPath: schema.tracks.originalPath,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .leftJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    if (allRows.length === 0) {
      return res.json({ groups: [], total: 0 })
    }

    const exactGroups = new Map<string, Set<number>>()
    const fileIdentityGroups = new Map<string, Set<number>>()

    for (const row of allRows) {
      if (row.chromaprintFingerprint) {
        if (!exactGroups.has(row.chromaprintFingerprint)) {
          exactGroups.set(row.chromaprintFingerprint, new Set<number>())
        }
        exactGroups.get(row.chromaprintFingerprint)!.add(row.sliceId)
      }

      const identityPath = row.trackOriginalPath || row.filePath
      if (identityPath) {
        const identityKey = [
          normalizeIdentityPathValue(identityPath),
          Math.round(row.startTime * 1000),
          Math.round(row.endTime * 1000),
        ].join('|')

        if (!fileIdentityGroups.has(identityKey)) {
          fileIdentityGroups.set(identityKey, new Set<number>())
        }
        fileIdentityGroups.get(identityKey)!.add(row.sliceId)
      }
    }

    const dedupedGroups = new Map<string, {
      sliceIds: number[]
      matchType: 'exact' | 'file'
      hashSimilarity: number
    }>()

    const addGroup = (sliceIdSet: Set<number>, matchType: 'exact' | 'file') => {
      const sliceIds = Array.from(sliceIdSet).sort((a, b) => a - b)
      if (sliceIds.length <= 1) return

      const signature = sliceIds.join(',')
      const existing = dedupedGroups.get(signature)

      // Prefer exact fingerprint classification when both strategies match same ids.
      if (!existing || (existing.matchType !== 'exact' && matchType === 'exact')) {
        dedupedGroups.set(signature, {
          sliceIds,
          matchType,
          hashSimilarity: 1.0,
        })
      }
    }

    for (const set of exactGroups.values()) addGroup(set, 'exact')
    for (const set of fileIdentityGroups.values()) addGroup(set, 'file')

    const duplicateGroups = Array.from(dedupedGroups.values())

    // Get slice details for all duplicates
    const allDuplicateIds = new Set<number>()
    duplicateGroups.forEach(g => g.sliceIds.forEach(id => allDuplicateIds.add(id)))

    if (allDuplicateIds.size === 0) {
      return res.json({ groups: [], total: 0 })
    }

    const slices = await db
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        trackTitle: schema.tracks.title,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(inArray(schema.slices.id, Array.from(allDuplicateIds)))

    const sliceMap = new Map(slices.map(s => [s.id, s]))

    const groups = duplicateGroups
      .map(g => ({
        matchType: g.matchType,
        hashSimilarity: g.hashSimilarity,
        samples: g.sliceIds.map(id => sliceMap.get(id)!).filter(Boolean),
      }))
      .sort((a, b) => b.samples.length - a.samples.length)

    res.json({
      groups,
      total: groups.length,
    })
  } catch (error) {
    console.error('Error finding duplicate slices:', error)
    res.status(500).json({ error: 'Failed to find duplicate slices' })
  }
})

// GET /api/slices/hierarchy - Build similarity-based hierarchy using clustering
router.get('/slices/hierarchy', async (_req, res) => {
  try {
    // Get all slices with YAMNet embeddings
    const allFeatures = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
      })
      .from(schema.audioFeatures)
      .where(sql`${schema.audioFeatures.yamnetEmbeddings} IS NOT NULL`)

    if (allFeatures.length === 0) {
      return res.json({ hierarchy: null, message: 'No embeddings available for clustering' })
    }

    // Parse embeddings
    const samples = allFeatures.map(f => ({
      sliceId: f.sliceId,
      embeddings: JSON.parse(f.yamnetEmbeddings!) as number[],
    }))

    // Simple agglomerative clustering
    // Start with each sample as its own cluster
    interface Cluster {
      id: string
      sliceIds: number[]
      centroid: number[]
      children?: Cluster[]
    }

    let clusters: Cluster[] = samples.map((s, i) => ({
      id: `sample_${s.sliceId}`,
      sliceIds: [s.sliceId],
      centroid: s.embeddings,
    }))

    // Merge clusters until we have a reasonable number of top-level groups (e.g., 5-10)
    const TARGET_CLUSTERS = Math.min(10, Math.max(5, Math.floor(samples.length / 20)))

    while (clusters.length > TARGET_CLUSTERS) {
      // Find two closest clusters
      let minDist = Infinity
      let mergeI = 0
      let mergeJ = 1

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const dist = 1 - cosineSimilarity(clusters[i].centroid, clusters[j].centroid)
          if (dist < minDist) {
            minDist = dist
            mergeI = i
            mergeJ = j
          }
        }
      }

      // Merge clusters
      const merged: Cluster = {
        id: `cluster_${clusters[mergeI].id}_${clusters[mergeJ].id}`,
        sliceIds: [...clusters[mergeI].sliceIds, ...clusters[mergeJ].sliceIds],
        centroid: clusters[mergeI].centroid.map((v, i) =>
          (v + clusters[mergeJ].centroid[i]) / 2
        ),
        children: [clusters[mergeI], clusters[mergeJ]],
      }

      // Replace with merged cluster
      clusters = [
        ...clusters.slice(0, mergeI),
        ...clusters.slice(mergeI + 1, mergeJ),
        ...clusters.slice(mergeJ + 1),
        merged,
      ]
    }

    // Get slice details
    const allSliceIds = samples.map(s => s.sliceId)
    const slices = await db
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        trackTitle: schema.tracks.title,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(inArray(schema.slices.id, allSliceIds))

    const sliceMap = new Map(slices.map(s => [s.id, s]))

    // Build hierarchy response
    const buildNode = (cluster: Cluster): any => {
      if (cluster.children) {
        return {
          type: 'cluster',
          id: cluster.id,
          size: cluster.sliceIds.length,
          children: cluster.children.map(buildNode),
        }
      } else {
        const slice = sliceMap.get(cluster.sliceIds[0])
        return {
          type: 'sample',
          id: cluster.id,
          sliceId: cluster.sliceIds[0],
          name: slice?.name,
          trackTitle: slice?.trackTitle,
        }
      }
    }

    const hierarchy = clusters.map(buildNode)

    res.json({
      hierarchy,
      totalClusters: TARGET_CLUSTERS,
      totalSamples: samples.length,
    })
  } catch (error) {
    console.error('Error building hierarchy:', error)
    res.status(500).json({ error: 'Failed to build hierarchy' })
  }
})

// Phase 5: LMNN Weight Learning Endpoints

// POST /api/weights/learn - Learn optimal feature weights from labeled samples
router.post('/weights/learn', async (_req, res) => {
  try {
    const { spawn } = await import('child_process')
    const pathMod = await import('path')
    const fsMod = await import('fs/promises')
    const { fileURLToPath } = await import('url')

    const __fn = fileURLToPath(import.meta.url)
    const __dn = pathMod.dirname(__fn)

    // Get all samples with filename-derived tags
    const samplesWithTags = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        spectralCentroid: schema.audioFeatures.spectralCentroid,
        spectralRolloff: schema.audioFeatures.spectralRolloff,
        spectralBandwidth: schema.audioFeatures.spectralBandwidth,
        spectralContrast: schema.audioFeatures.spectralContrast,
        spectralFlux: schema.audioFeatures.spectralFlux,
        spectralFlatness: schema.audioFeatures.spectralFlatness,
        rmsEnergy: schema.audioFeatures.rmsEnergy,
        loudness: schema.audioFeatures.loudness,
        dynamicRange: schema.audioFeatures.dynamicRange,
        attackTime: schema.audioFeatures.attackTime,
        brightness: schema.audioFeatures.brightness,
        warmth: schema.audioFeatures.warmth,
        hardness: schema.audioFeatures.hardness,
        roughness: schema.audioFeatures.roughness,
        sharpness: schema.audioFeatures.sharpness,
        harmonicPercussiveRatio: schema.audioFeatures.harmonicPercussiveRatio,
        temporalCentroid: schema.audioFeatures.temporalCentroid,
        crestFactor: schema.audioFeatures.crestFactor,
        transientSpectralCentroid: schema.audioFeatures.transientSpectralCentroid,
        transientSpectralFlatness: schema.audioFeatures.transientSpectralFlatness,
        stereoWidth: schema.audioFeatures.stereoWidth,
        zeroCrossingRate: schema.audioFeatures.zeroCrossingRate,
        bpm: schema.audioFeatures.bpm,
        tagName: schema.tags.name,
      })
      .from(schema.audioFeatures)
      .innerJoin(schema.sliceTags, eq(schema.audioFeatures.sliceId, schema.sliceTags.sliceId))
      .innerJoin(schema.tags, and(eq(schema.sliceTags.tagId, schema.tags.id), eq(schema.tags.category, 'filename')))

    if (samplesWithTags.length < 20) {
      return res.status(400).json({
        error: 'Need at least 20 labeled samples for weight learning',
        current: samplesWithTags.length
      })
    }

    // Group by sliceId, pick primary tag
    const sampleMap = new Map<number, { features: number[], label: string }>()
    const featureNames = [
      'spectralCentroid', 'spectralRolloff', 'spectralBandwidth', 'spectralContrast',
      'spectralFlux', 'spectralFlatness', 'rmsEnergy', 'loudness', 'dynamicRange',
      'attackTime', 'brightness', 'warmth', 'hardness', 'roughness', 'sharpness',
      'harmonicPercussiveRatio', 'temporalCentroid', 'crestFactor',
      'transientSpectralCentroid', 'transientSpectralFlatness', 'stereoWidth',
      'zeroCrossingRate', 'bpm',
    ]

    for (const row of samplesWithTags) {
      if (sampleMap.has(row.sliceId)) continue
      const featureValues = featureNames.map(f => (row as any)[f] ?? 0)
      sampleMap.set(row.sliceId, { features: featureValues, label: row.tagName })
    }

    const samples = Array.from(sampleMap.values())
    const inputData = {
      features: samples.map(s => s.features),
      labels: samples.map(s => s.label),
      feature_names: featureNames,
    }

    const PYTHON_SCRIPT = pathMod.join(__dn, '../python/learn_weights.py')
    const VENV_PYTHON = pathMod.join(__dn, '../../venv/bin/python')
    const PYTHON_EXECUTABLE = process.env.PYTHON_PATH || VENV_PYTHON

    const proc = spawn(PYTHON_EXECUTABLE, [PYTHON_SCRIPT], {
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.stdin.write(JSON.stringify(inputData))
    proc.stdin.end()

    proc.on('close', async (code: number | null) => {
      if (code !== 0) {
        console.error('Weight learning failed:', stderr)
        return res.status(500).json({ error: 'Weight learning failed', details: stderr.substring(0, 500) })
      }

      try {
        const result = JSON.parse(stdout)
        const DATA_DIR = process.env.DATA_DIR || './data'
        const weightsPath = pathMod.join(DATA_DIR, 'learned_weights.json')
        await fsMod.mkdir(DATA_DIR, { recursive: true })
        await fsMod.writeFile(weightsPath, JSON.stringify(result, null, 2))
        res.json(result)
      } catch {
        res.status(500).json({ error: 'Failed to parse weight learning results' })
      }
    })

    proc.on('error', (err: Error) => {
      res.status(500).json({ error: `Failed to spawn Python process: ${err.message}` })
    })
  } catch (error) {
    console.error('Error in weight learning:', error)
    res.status(500).json({ error: 'Failed to run weight learning' })
  }
})

// GET /api/weights/learned - Get stored learned weights
router.get('/weights/learned', async (_req, res) => {
  try {
    const pathMod = await import('path')
    const fsMod = await import('fs/promises')

    const DATA_DIR = process.env.DATA_DIR || './data'
    const weightsPath = pathMod.join(DATA_DIR, 'learned_weights.json')

    try {
      const data = await fsMod.readFile(weightsPath, 'utf-8')
      res.json(JSON.parse(data))
    } catch {
      res.status(404).json({ error: 'No learned weights found. Import labeled samples and run weight learning first.' })
    }
  } catch (error) {
    console.error('Error fetching learned weights:', error)
    res.status(500).json({ error: 'Failed to fetch learned weights' })
  }
})

export default router
