import { Router } from 'express'
import { eq, and, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  analyzeAudioFeatures,
  featuresToTags,
  getTagMetadata,
  storeAudioFeatures,
} from '../services/audioAnalysis.js'
import { onTagAdded, onTagRemoved } from '../services/tagFolderSync.js'

const router = Router()
const AUTO_REANALYSIS_TAG_CATEGORIES = ['type', 'tempo', 'spectral', 'energy', 'instrument', 'general'] as const

type TagCategory = 'general' | 'type' | 'tempo' | 'spectral' | 'energy' | 'instrument' | 'filename'
const TAG_CATEGORIES: TagCategory[] = ['general', 'type', 'tempo', 'spectral', 'energy', 'instrument', 'filename']

function normalizeTagCategory(category?: string): TagCategory {
  if (category && TAG_CATEGORIES.includes(category as TagCategory)) {
    return category as TagCategory
  }
  return 'general'
}

function computeTagDiff(beforeTags: string[], afterTags: string[]) {
  const beforeSet = new Set(beforeTags)
  const afterSet = new Set(afterTags)

  const removedTags = beforeTags.filter((tag) => !afterSet.has(tag))
  const addedTags = afterTags.filter((tag) => !beforeSet.has(tag))

  return { removedTags, addedTags }
}

async function getSliceTagNames(sliceId: number): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.sliceTags)
    .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
    .where(eq(schema.sliceTags.sliceId, sliceId))

  return rows.map((row) => row.name)
}

async function markSamplesModified(sliceIds: number[]) {
  if (!sliceIds.length) return

  const now = new Date().toISOString()

  if (sliceIds.length === 1) {
    await db
      .update(schema.slices)
      .set({
        sampleModified: 1,
        sampleModifiedAt: now,
      })
      .where(eq(schema.slices.id, sliceIds[0]))
    return
  }

  await db
    .update(schema.slices)
    .set({
      sampleModified: 1,
      sampleModifiedAt: now,
    })
    .where(inArray(schema.slices.id, sliceIds))
}

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
  const { name, color, category } = req.body as { name: string; color: string; category?: string }

  if (!name || !color) {
    return res.status(400).json({ error: 'Name and color required' })
  }

  try {
    const normalizedCategory = normalizeTagCategory(category)

    const [tag] = await db
      .insert(schema.tags)
      .values({ name: name.toLowerCase(), color, category: normalizedCategory })
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

// Update tag
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, color, category } = req.body as { name?: string; color?: string; category?: string }

  if (!name && !color && !category) {
    return res.status(400).json({ error: 'Nothing to update' })
  }

  try {
    const updates: any = {}
    if (name) updates.name = name.toLowerCase()
    if (color) updates.color = color
    if (category) updates.category = category

    const [updated] = await db
      .update(schema.tags)
      .set(updates)
      .where(eq(schema.tags.id, id))
      .returning()

    if (!updated) {
      return res.status(404).json({ error: 'Tag not found' })
    }

    res.json(updated)
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Tag already exists' })
    }
    console.error('Error updating tag:', error)
    res.status(500).json({ error: 'Failed to update tag' })
  }
})

// Create tag from folder (tag all slices in the folder)
router.post('/from-folder', async (req, res) => {
  const { folderId, name, color } = req.body as { folderId: number; name?: string; color?: string }

  if (!folderId) {
    return res.status(400).json({ error: 'folderId is required' })
  }

  try {
    // Get folder info
    const folder = await db
      .select()
      .from(schema.folders)
      .where(eq(schema.folders.id, folderId))
      .limit(1)

    if (folder.length === 0) {
      return res.status(404).json({ error: 'Folder not found' })
    }

    const tagName = (name || folder[0].name).toLowerCase()
    const tagColor = color || folder[0].color

    // Create the tag (or get existing)
    let tag
    try {
      const [newTag] = await db
        .insert(schema.tags)
        .values({ name: tagName, color: tagColor })
        .returning()
      tag = newTag
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const existing = await db
          .select()
          .from(schema.tags)
          .where(eq(schema.tags.name, tagName))
          .limit(1)
        tag = existing[0]
      } else {
        throw error
      }
    }

    // Get all slices in the folder
    const sliceIds = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(eq(schema.folderSlices.folderId, folderId))

    // Tag all slices
    let tagged = 0
    for (const { sliceId } of sliceIds) {
      try {
        await db
          .insert(schema.sliceTags)
          .values({ sliceId, tagId: tag.id })
          .onConflictDoNothing()
        tagged++
      } catch {
        // skip individual failures
      }
    }

    await markSamplesModified(sliceIds.map(s => s.sliceId))

    res.json({ ...tag, slicesTagged: tagged })
  } catch (error) {
    console.error('Error creating tag from folder:', error)
    res.status(500).json({ error: 'Failed to create tag from folder' })
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

    await markSamplesModified([sliceId])

    // Trigger tag-folder sync
    onTagAdded(sliceId, tagId).catch(err => console.error('Sync error (tag added):', err))

    res.json({ success: true })
  } catch (error) {
    console.error('Error adding tag to slice:', error)
    res.status(500).json({ error: 'Failed to add tag' })
  }
})

// Batch add tag to slices (create tag if needed)
router.post('/batch-apply', async (req, res) => {
  const { tagId, name, color, sliceIds } = req.body as {
    tagId?: number
    name?: string
    color?: string
    sliceIds: number[]
  }

  if (!sliceIds || !Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array required' })
  }

  try {
    let tag
    if (tagId) {
      const existing = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.id, tagId))
        .limit(1)
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Tag not found' })
      }
      tag = existing[0]
    } else {
      if (!name) {
        return res.status(400).json({ error: 'name or tagId required' })
      }
      const tagName = name.toLowerCase()
      const tagColor = color || '#6366f1'
      try {
        const [newTag] = await db
          .insert(schema.tags)
          .values({ name: tagName, color: tagColor })
          .returning()
        tag = newTag
      } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          const existing = await db
            .select()
            .from(schema.tags)
            .where(eq(schema.tags.name, tagName))
            .limit(1)
          tag = existing[0]
        } else {
          throw error
        }
      }
    }

    const BATCH_SIZE = 500
    let tagged = 0
    for (let i = 0; i < sliceIds.length; i += BATCH_SIZE) {
      const batch = sliceIds.slice(i, i + BATCH_SIZE)
      await db
        .insert(schema.sliceTags)
        .values(batch.map(sliceId => ({ sliceId, tagId: tag.id })))
        .onConflictDoNothing()
      tagged += batch.length
    }

    await markSamplesModified(sliceIds)

    for (const sliceId of sliceIds) {
      onTagAdded(sliceId, tag.id).catch(err => console.error('Sync error (tag added):', err))
    }

    res.json({ tag, slicesTagged: tagged })
  } catch (error) {
    console.error('Error batch applying tag:', error)
    res.status(500).json({ error: 'Failed to batch apply tag' })
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

    await markSamplesModified([sliceId])

    // Trigger tag-folder sync
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

    const beforeTags = await getSliceTagNames(sliceId)
    const beforeAutoTagRows = await db
      .select({ name: schema.tags.name })
      .from(schema.sliceTags)
      .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
      .where(
        and(
          eq(schema.sliceTags.sliceId, sliceId),
          inArray(schema.tags.category, [...AUTO_REANALYSIS_TAG_CATEGORIES])
        )
      )
    const beforeAutoTags = beforeAutoTagRows.map((row) => row.name.toLowerCase())

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
    const createdOrLinkedTags: string[] = []

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

        createdOrLinkedTags.push(lowerTag)
      } catch (error) {
        console.error(`Failed to add tag ${lowerTag}:`, error)
      }
    }

    const afterTags = await getSliceTagNames(sliceId)
    const { removedTags, addedTags } = computeTagDiff(beforeTags, afterTags)
    const afterAutoTagRows = await db
      .select({ name: schema.tags.name })
      .from(schema.sliceTags)
      .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
      .where(
        and(
          eq(schema.sliceTags.sliceId, sliceId),
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
    if (autoTagChanged || slice[0].sampleModified === 1) {
      warningMessage = autoTagChanged
        ? `Slice ${sliceId} had custom/changed AI tag state before analysis. Changes detected: -${removedTags.length} +${addedTags.length}.`
        : `Slice ${sliceId} was manually modified before analysis.`
    }

    await db.insert(schema.reanalysisLogs).values({
      sliceId,
      beforeTags: JSON.stringify(beforeTags),
      afterTags: JSON.stringify(afterTags),
      removedTags: JSON.stringify(removedTags),
      addedTags: JSON.stringify(addedTags),
      hadPotentialCustomState: warningMessage ? 1 : 0,
      warningMessage,
    })

    res.json({
      tags: createdOrLinkedTags,
      warning: warningMessage
        ? {
            hadPotentialCustomState: true,
            message: warningMessage,
            removedTags,
            addedTags,
          }
        : {
            hadPotentialCustomState: false,
            message: null,
            removedTags,
            addedTags,
          },
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
