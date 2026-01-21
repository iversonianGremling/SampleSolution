import { Router } from 'express'
import { eq, inArray } from 'drizzle-orm'
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

// Helper function to auto-tag a slice using audio analysis
async function autoTagSlice(sliceId: number, audioPath: string): Promise<void> {
  try {
    console.log(`Running audio analysis on slice ${sliceId}...`)

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
  const { name, startTime, endTime } = req.body as {
    name: string
    startTime: number
    endTime: number
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
      autoTagSlice(inserted.id, slicePath).catch(err => {
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

// Download slice
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

    res.download(slice[0].filePath, `${slice[0].name}.mp3`)
  } catch (error) {
    console.error('Error downloading slice:', error)
    res.status(500).json({ error: 'Failed to download slice' })
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

export default router
