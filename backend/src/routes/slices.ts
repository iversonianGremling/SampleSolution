import { Router } from 'express'
import { eq, inArray, and, isNull, like, or, sql } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema } from '../db/index.js'
import { extractSlice } from '../services/ffmpeg.js'
import {
  analyzeAudioFeatures,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
  parseFilenameTags,
} from '../services/audioAnalysis.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

// GET /api/sources/samples - Returns samples filtered by scope
// Query params:
//   scope: 'youtube' | 'youtube:{trackId}' | 'local' | 'folder:{path}' | 'collection:{id}' | 'all'
//   tags: comma-separated tag IDs (optional)
//   search: search term (optional)
//   favorites: 'true' to show only favorites (optional)
//   sortBy: 'bpm' | 'key' | 'name' | 'duration' | 'createdAt' (optional)
//   sortOrder: 'asc' | 'desc' (optional, default: 'asc')
//   minBpm: minimum BPM (optional)
//   maxBpm: maximum BPM (optional)
//   keys: comma-separated key names (optional, e.g., 'C major,D minor')
router.get('/sources/samples', async (req, res) => {
  try {
    const { scope = 'all', tags, search, favorites, sortBy, sortOrder = 'asc', minBpm, maxBpm, keys } = req.query as {
      scope?: string
      tags?: string
      search?: string
      favorites?: string
      sortBy?: string
      sortOrder?: string
      minBpm?: string
      maxBpm?: string
      keys?: string
    }

    // Build base query conditions
    const conditions: any[] = []

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
    } else if (scope.startsWith('folder:')) {
      // Samples from a specific folder (and subfolders)
      const folderPath = scope.slice(7) // Remove 'folder:' prefix
      conditions.push(
        and(
          eq(schema.tracks.source, 'local'),
          or(
            eq(schema.tracks.folderPath, folderPath),
            like(schema.tracks.folderPath, `${folderPath}/%`)
          )
        )
      )
    } else if (scope.startsWith('collection:')) {
      // Samples in a specific collection - handled separately below
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
        createdAt: schema.slices.createdAt,
        trackTitle: schema.tracks.title,
        trackYoutubeId: schema.tracks.youtubeId,
        trackSource: schema.tracks.source,
        trackFolderPath: schema.tracks.folderPath,
        trackOriginalPath: schema.tracks.originalPath,
        trackArtist: schema.tracks.artist,
        trackAlbum: schema.tracks.album,
        // Audio features
        bpm: schema.audioFeatures.bpm,
        keyEstimate: schema.audioFeatures.keyEstimate,
        envelopeType: schema.audioFeatures.envelopeType,
        genrePrimary: schema.audioFeatures.genrePrimary,
        instrumentType: schema.audioFeatures.instrumentType,
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .leftJoin(schema.audioFeatures, eq(schema.slices.id, schema.audioFeatures.sliceId))

    // Apply conditions
    if (conditions.length > 0) {
      slicesQuery = slicesQuery.where(and(...conditions)) as typeof slicesQuery
    }

    let slices = await slicesQuery

    // Handle collection scope (post-filter since it requires join)
    if (scope.startsWith('collection:')) {
      const collectionId = parseInt(scope.split(':')[1])
      const collectionSliceIds = await db
        .select({ sliceId: schema.collectionSlices.sliceId })
        .from(schema.collectionSlices)
        .where(eq(schema.collectionSlices.collectionId, collectionId))

      const sliceIdSet = new Set(collectionSliceIds.map(c => c.sliceId))
      slices = slices.filter(s => sliceIdSet.has(s.id))
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

    // Sorting
    if (sortBy) {
      filteredSlices.sort((a, b) => {
        let aVal: any
        let bVal: any

        switch (sortBy) {
          case 'bpm':
            aVal = a.bpm ?? -1
            bVal = b.bpm ?? -1
            break
          case 'key':
            aVal = a.keyEstimate ?? ''
            bVal = b.keyEstimate ?? ''
            break
          case 'name':
            aVal = a.name.toLowerCase()
            bVal = b.name.toLowerCase()
            break
          case 'duration':
            aVal = a.endTime - a.startTime
            bVal = b.endTime - b.startTime
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
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
        return 0
      })
    }

    // Get collection memberships for filtered slices
    const filteredSliceIds = filteredSlices.map(s => s.id)
    const collectionLinks = filteredSliceIds.length > 0
      ? await db
          .select()
          .from(schema.collectionSlices)
          .where(inArray(schema.collectionSlices.sliceId, filteredSliceIds))
      : []

    const collectionsBySlice = new Map<number, number[]>()
    for (const row of collectionLinks) {
      if (!collectionsBySlice.has(row.sliceId)) {
        collectionsBySlice.set(row.sliceId, [])
      }
      collectionsBySlice.get(row.sliceId)!.push(row.collectionId)
    }

    const result = filteredSlices.map(slice => ({
      id: slice.id,
      trackId: slice.trackId,
      name: slice.name,
      startTime: slice.startTime,
      endTime: slice.endTime,
      filePath: slice.filePath,
      favorite: slice.favorite === 1,
      createdAt: slice.createdAt,
      tags: tagsBySlice.get(slice.id) || [],
      collectionIds: collectionsBySlice.get(slice.id) || [],
      bpm: slice.bpm,
      keyEstimate: slice.keyEstimate,
      envelopeType: slice.envelopeType,
      genrePrimary: slice.genrePrimary,
      instrumentType: slice.instrumentType,
      track: {
        title: slice.trackTitle,
        youtubeId: slice.trackYoutubeId,
        source: slice.trackSource,
        folderPath: slice.trackFolderPath,
        originalPath: slice.trackOriginalPath,
        artist: slice.trackArtist,
        album: slice.trackAlbum,
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

    // Get collection memberships for all slices
    const collectionLinks =
      sliceIds.length > 0
        ? await db
            .select()
            .from(schema.collectionSlices)
            .where(inArray(schema.collectionSlices.sliceId, sliceIds))
        : []

    const collectionsBySlice = new Map<number, number[]>()
    for (const row of collectionLinks) {
      if (!collectionsBySlice.has(row.sliceId)) {
        collectionsBySlice.set(row.sliceId, [])
      }
      collectionsBySlice.get(row.sliceId)!.push(row.collectionId)
    }

    const result = slices.map((slice) => ({
      id: slice.id,
      trackId: slice.trackId,
      name: slice.name,
      startTime: slice.startTime,
      endTime: slice.endTime,
      filePath: slice.filePath,
      favorite: slice.favorite === 1,
      createdAt: slice.createdAt,
      tags: tagsBySlice.get(slice.id) || [],
      collectionIds: collectionsBySlice.get(slice.id) || [],
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

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, id))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    // Delete file
    if (slice[0].filePath) {
      await fs.unlink(slice[0].filePath).catch(() => {})
    }

    await db.delete(schema.slices).where(eq(schema.slices.id, id))

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting slice:', error)
    res.status(500).json({ error: 'Failed to delete slice' })
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

    const results: { sliceId: number; success: boolean; error?: string }[] = []

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
            await autoTagSlice(slice.id, slice.filePath)
            return { sliceId: slice.id, success: true }
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

    // Configurable concurrency (1-50, default 5)
    const CHUNK_SIZE = Math.max(1, Math.min(50, concurrency || 5))
    const results: Array<{ sliceId: number; success: boolean; error?: string }> = []

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

            // Re-analyze the audio
            const features = await analyzeAudioFeatures(filePath, analysisLevel)

            // Store updated features
            await storeAudioFeatures(slice.id, features)

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

              // Clear existing auto-generated tags (keep user tags)
              // For simplicity, we'll just add new tags without removing old ones
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

            results.push({ sliceId: slice.id, success: true })
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

// GET /api/slices/:id/similar - Find similar samples based on YAMNet embeddings
router.get('/slices/:id/similar', async (req, res) => {
  const sliceId = parseInt(req.params.id)
  const limit = parseInt(req.query.limit as string) || 20

  try {
    // Get target slice's audio features with embeddings
    const targetFeatures = await db
      .select()
      .from(schema.audioFeatures)
      .where(eq(schema.audioFeatures.sliceId, sliceId))
      .limit(1)

    if (targetFeatures.length === 0 || !targetFeatures[0].yamnetEmbeddings) {
      return res.status(404).json({
        error: 'No YAMNet embeddings found for this slice. Try re-analyzing with advanced level.'
      })
    }

    const targetEmbeddings = JSON.parse(targetFeatures[0].yamnetEmbeddings) as number[]

    // Get all other slices with embeddings
    const allFeatures = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        yamnetEmbeddings: schema.audioFeatures.yamnetEmbeddings,
      })
      .from(schema.audioFeatures)
      .where(sql`${schema.audioFeatures.sliceId} != ${sliceId} AND ${schema.audioFeatures.yamnetEmbeddings} IS NOT NULL`)

    // Calculate similarity scores
    const similarities = allFeatures
      .map(f => {
        const embeddings = JSON.parse(f.yamnetEmbeddings!) as number[]
        const similarity = cosineSimilarity(targetEmbeddings, embeddings)
        return { sliceId: f.sliceId, similarity }
      })
      .filter(s => s.similarity > 0.5) // Only return reasonably similar samples
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)

    // Get slice details for similar samples
    const similarSliceIds = similarities.map(s => s.sliceId)

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
    const results = slices.map(slice => {
      const sim = similarities.find(s => s.sliceId === slice.id)
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
    // Get all slices with chromaprint fingerprints
    const allFeatures = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        chromaprintFingerprint: schema.audioFeatures.chromaprintFingerprint,
      })
      .from(schema.audioFeatures)
      .where(sql`${schema.audioFeatures.chromaprintFingerprint} IS NOT NULL`)

    if (allFeatures.length === 0) {
      return res.json({ groups: [], total: 0 })
    }

    // Group by exact fingerprint match
    const exactGroups = new Map<string, number[]>()

    for (const feature of allFeatures) {
      const fp = feature.chromaprintFingerprint!
      if (!exactGroups.has(fp)) {
        exactGroups.set(fp, [])
      }
      exactGroups.get(fp)!.push(feature.sliceId)
    }

    const duplicateGroups: Array<{
      sliceIds: number[]
      matchType: 'exact'
      hashSimilarity: number
    }> = []

    for (const [_fp, sliceIds] of exactGroups.entries()) {
      if (sliceIds.length > 1) {
        duplicateGroups.push({
          sliceIds,
          matchType: 'exact',
          hashSimilarity: 1.0,
        })
      }
    }

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

    const groups = duplicateGroups.map(g => ({
      matchType: g.matchType,
      hashSimilarity: g.hashSimilarity,
      samples: g.sliceIds.map(id => sliceMap.get(id)!).filter(Boolean),
    }))

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
