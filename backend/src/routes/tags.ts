import { Router } from 'express'
import { eq, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  analyzeAudioFeatures,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
} from '../services/audioAnalysis.js'
import { onTagAdded, onTagRemoved } from '../services/tagCollectionSync.js'

const router = Router()

// Get all tags
router.get('/', async (req, res) => {
  try {
    const tags = await db.select().from(schema.tags).orderBy(schema.tags.name)
    res.json(tags)
  } catch (error) {
    console.error('Error fetching tags:', error)
    res.status(500).json({ error: 'Failed to fetch tags' })
  }
})

// Create tag
router.post('/', async (req, res) => {
  const { name, color } = req.body as { name: string; color: string }

  if (!name || !color) {
    return res.status(400).json({ error: 'Name and color required' })
  }

  try {
    const [tag] = await db
      .insert(schema.tags)
      .values({ name: name.toLowerCase(), color })
      .returning()

    res.json(tag)
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Tag already exists' })
    }
    console.error('Error creating tag:', error)
    res.status(500).json({ error: 'Failed to create tag' })
  }
})

// Delete tag
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    await db.delete(schema.tags).where(eq(schema.tags.id, id))
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting tag:', error)
    res.status(500).json({ error: 'Failed to delete tag' })
  }
})

// Add tag to track
router.post('/tracks/:trackId/tags', async (req, res) => {
  const trackId = parseInt(req.params.trackId)
  const { tagId } = req.body as { tagId: number }

  if (!tagId) {
    return res.status(400).json({ error: 'tagId required' })
  }

  try {
    await db
      .insert(schema.trackTags)
      .values({ trackId, tagId })
      .onConflictDoNothing()

    res.json({ success: true })
  } catch (error) {
    console.error('Error adding tag to track:', error)
    res.status(500).json({ error: 'Failed to add tag' })
  }
})

// Remove tag from track
router.delete('/tracks/:trackId/tags/:tagId', async (req, res) => {
  const trackId = parseInt(req.params.trackId)
  const tagId = parseInt(req.params.tagId)

  try {
    await db
      .delete(schema.trackTags)
      .where(
        and(
          eq(schema.trackTags.trackId, trackId),
          eq(schema.trackTags.tagId, tagId)
        )
      )

    res.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from track:', error)
    res.status(500).json({ error: 'Failed to remove tag' })
  }
})

// Add tag to slice
router.post('/slices/:sliceId/tags', async (req, res) => {
  const sliceId = parseInt(req.params.sliceId)
  const { tagId } = req.body as { tagId: number }

  if (!tagId) {
    return res.status(400).json({ error: 'tagId required' })
  }

  try {
    await db
      .insert(schema.sliceTags)
      .values({ sliceId, tagId })
      .onConflictDoNothing()

    // Trigger tag-collection sync
    onTagAdded(sliceId, tagId).catch(err => console.error('Sync error (tag added):', err))

    res.json({ success: true })
  } catch (error) {
    console.error('Error adding tag to slice:', error)
    res.status(500).json({ error: 'Failed to add tag' })
  }
})

// Remove tag from slice
router.delete('/slices/:sliceId/tags/:tagId', async (req, res) => {
  const sliceId = parseInt(req.params.sliceId)
  const tagId = parseInt(req.params.tagId)

  try {
    await db
      .delete(schema.sliceTags)
      .where(
        and(
          eq(schema.sliceTags.sliceId, sliceId),
          eq(schema.sliceTags.tagId, tagId)
        )
      )

    // Trigger tag-collection sync
    onTagRemoved(sliceId, tagId).catch(err => console.error('Sync error (tag removed):', err))

    res.json({ success: true })
  } catch (error) {
    console.error('Error removing tag from slice:', error)
    res.status(500).json({ error: 'Failed to remove tag' })
  }
})

// Generate AI tags for slice (using Essentia + Librosa audio analysis)
router.post('/slices/:sliceId/ai-tags', async (req, res) => {
  const sliceId = parseInt(req.params.sliceId)

  try {
    const slice = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    if (!slice[0].filePath) {
      return res.status(400).json({ error: 'Slice audio file not found' })
    }

    // Analyze audio with Python (Essentia + Librosa)
    const features = await analyzeAudioFeatures(slice[0].filePath)

    // Store raw features in database
    await storeAudioFeatures(sliceId, features)

    // Convert features to tags
    const tagNames = featuresToTags(features)

    if (tagNames.length === 0) {
      return res.json({ tags: [], features })
    }

    // Create tags that don't exist and link them to the slice
    const addedTags: string[] = []

    for (const tagName of tagNames) {
      const lowerTag = tagName.toLowerCase()

      try {
        // Get tag metadata (color and category)
        const { color, category } = getTagMetadata(lowerTag)

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

        addedTags.push(lowerTag)
      } catch (error) {
        console.error(`Failed to add tag ${lowerTag}:`, error)
      }
    }

    res.json({
      tags: addedTags,
      features: {
        isOneShot: features.isOneShot,
        isLoop: features.isLoop,
        bpm: features.bpm,
        spectralCentroid: features.spectralCentroid,
        analysisDurationMs: features.analysisDurationMs,
      },
    })
  } catch (error) {
    console.error('Error generating audio analysis tags:', error)
    res.status(500).json({ error: 'Failed to generate tags' })
  }
})

export default router
