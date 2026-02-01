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
        // Audio features
        bpm: schema.audioFeatures.bpm,
        keyEstimate: schema.audioFeatures.keyEstimate,
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
      track: {
        title: slice.trackTitle,
        youtubeId: slice.trackYoutubeId,
        source: slice.trackSource,
        folderPath: slice.trackFolderPath,
        originalPath: slice.trackOriginalPath,
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
    const level = analysisLevel || 'standard'
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
    const { sliceIds, analysisLevel } = req.body as {
      sliceIds?: number[]
      analysisLevel?: 'quick' | 'standard' | 'advanced'
    }

    // Get slices to re-analyze
    const slicesToAnalyze = sliceIds && sliceIds.length > 0
      ? await db
          .select()
          .from(schema.slices)
          .where(inArray(schema.slices.id, sliceIds))
      : await db.select().from(schema.slices).all()

    if (slicesToAnalyze.length === 0) {
      return res.json({
        total: 0,
        analyzed: 0,
        failed: 0,
        results: [],
      })
    }

    // Start background re-analysis
    // We'll process in chunks to avoid overwhelming the system
    const CHUNK_SIZE = 5
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
            const filePath = path.isAbsolute(slice.filePath)
              ? slice.filePath
              : path.join(DATA_DIR, slice.filePath)

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

export default router
