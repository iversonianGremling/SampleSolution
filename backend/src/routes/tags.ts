import { Router } from 'express'
import { eq, and, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  analyzeAudioFeatures,
  buildSamplePathHint,
  featuresToTags,
  getTagMetadata,
  parseFilenameTagsSmart,
  postAnalyzeSampleTags,
  storeAudioFeatures,
} from '../services/audioAnalysis.js'
import { getAudioFileMetadata } from '../services/ffmpeg.js'
import { onTagAdded, onTagRemoved } from '../services/tagFolderSync.js'
import { isReducibleDimensionTag } from '../constants/reducibleTags.js'
import { AI_MANAGED_INSTRUMENT_TAG_NAMES, resolveTag } from '../constants/tagRegistry.js'

const router = Router()
const AI_MANAGED_INSTRUMENT_TAG_NAME_SET = new Set(AI_MANAGED_INSTRUMENT_TAG_NAMES)

type TagCategory = 'instrument' | 'filename'
const TAG_CATEGORIES: TagCategory[] = ['instrument', 'filename']

function normalizeTagCategory(category?: string): TagCategory {
  const normalized = category?.trim().toLowerCase()
  if (!normalized) return 'instrument'
  if (TAG_CATEGORIES.includes(normalized as TagCategory)) {
    return normalized as TagCategory
  }
  return 'instrument'
}

function normalizeTagName(rawName: string): string {
  return rawName.trim().toLowerCase()
}

function isInstrumentTagRecord(tag: Pick<typeof schema.tags.$inferSelect, 'name' | 'category'>): boolean {
  const normalizedCategory = (tag.category ?? '').trim().toLowerCase()
  if (normalizedCategory === 'instrument') return true

  const resolved = resolveTag(tag.name)
  return resolved.isKnown
}

function isAiManagedInstrumentTagRecord(tag: Pick<typeof schema.tags.$inferSelect, 'name' | 'category'>): boolean {
  const normalizedCategory = (tag.category ?? '').trim().toLowerCase()
  if (normalizedCategory !== 'instrument') return false
  return AI_MANAGED_INSTRUMENT_TAG_NAME_SET.has(tag.name.trim().toLowerCase())
}

async function getSliceAiManagedTagNames(sliceId: number): Promise<string[]> {
  const rows = await db
    .select({
      name: schema.tags.name,
      category: schema.tags.category,
    })
    .from(schema.sliceTags)
    .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
    .where(
      and(
        eq(schema.sliceTags.sliceId, sliceId),
        eq(schema.tags.category, 'instrument'),
        inArray(schema.tags.name, [...AI_MANAGED_INSTRUMENT_TAG_NAMES]),
      )
    )

  return rows
    .filter((row) => isAiManagedInstrumentTagRecord(row))
    .map((row) => row.name.toLowerCase())
}

async function removeSliceAiManagedTags(sliceId: number): Promise<void> {
  const aiManagedTagRows = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(
      and(
        eq(schema.tags.category, 'instrument'),
        inArray(schema.tags.name, [...AI_MANAGED_INSTRUMENT_TAG_NAMES]),
      )
    )

  const aiManagedTagIds = aiManagedTagRows.map((row) => row.id)
  if (aiManagedTagIds.length === 0) return

  await db
    .delete(schema.sliceTags)
    .where(
      and(
        eq(schema.sliceTags.sliceId, sliceId),
        inArray(schema.sliceTags.tagId, aiManagedTagIds),
      )
    )
}

function getReducibleTagError(tagName: string): string | null {
  return isReducibleDimensionTag(tagName)
    ? `Tag "${tagName}" is dimension-derived and cannot be created manually`
    : null
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
    res.json(tags.filter((tag) => isInstrumentTagRecord(tag)))
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
    const normalizedName = normalizeTagName(name)
    if (!normalizedName) {
      return res.status(400).json({ error: 'Name required' })
    }
    const reducibleError = getReducibleTagError(normalizedName)
    if (reducibleError) {
      return res.status(400).json({ error: reducibleError })
    }

    const normalizedCategory = normalizeTagCategory(category)

    const [tag] = await db
      .insert(schema.tags)
      .values({ name: normalizedName, color, category: normalizedCategory })
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
    if (name) {
      const normalizedName = normalizeTagName(name)
      if (!normalizedName) {
        return res.status(400).json({ error: 'Name required' })
      }
      const reducibleError = getReducibleTagError(normalizedName)
      if (reducibleError) {
        return res.status(400).json({ error: reducibleError })
      }
      updates.name = normalizedName
    }
    if (color) updates.color = color
    if (category) updates.category = normalizeTagCategory(category)

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

// Merge tags: copy all links from source tag into target tag, optionally delete source.
router.post('/merge', async (req, res) => {
  const {
    sourceTagId,
    targetTagId,
    deleteSourceTag,
  } = req.body as { sourceTagId: number; targetTagId: number; deleteSourceTag?: boolean }

  const sourceId = Number(sourceTagId)
  const targetId = Number(targetTagId)
  const shouldDeleteSourceTag = Boolean(deleteSourceTag)

  if (!Number.isInteger(sourceId) || sourceId <= 0 || !Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'sourceTagId and targetTagId are required' })
  }

  if (sourceId === targetId) {
    return res.status(400).json({ error: 'sourceTagId and targetTagId must be different' })
  }

  try {
    const tags = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(inArray(schema.tags.id, [sourceId, targetId]))

    if (tags.length !== 2) {
      return res.status(404).json({ error: 'Source or target tag not found' })
    }

    const sourceSliceRows = await db
      .select({ sliceId: schema.sliceTags.sliceId })
      .from(schema.sliceTags)
      .where(eq(schema.sliceTags.tagId, sourceId))

    const sourceTrackRows = await db
      .select({ trackId: schema.trackTags.trackId })
      .from(schema.trackTags)
      .where(eq(schema.trackTags.tagId, sourceId))

    const sourceSliceIds = Array.from(new Set(sourceSliceRows.map((row) => row.sliceId)))
    const sourceTrackIds = Array.from(new Set(sourceTrackRows.map((row) => row.trackId)))

    const BATCH_SIZE = 500

    for (let i = 0; i < sourceSliceIds.length; i += BATCH_SIZE) {
      const batch = sourceSliceIds.slice(i, i + BATCH_SIZE)
      await db
        .insert(schema.sliceTags)
        .values(batch.map((sliceId) => ({ sliceId, tagId: targetId })))
        .onConflictDoNothing()
    }

    for (let i = 0; i < sourceTrackIds.length; i += BATCH_SIZE) {
      const batch = sourceTrackIds.slice(i, i + BATCH_SIZE)
      await db
        .insert(schema.trackTags)
        .values(batch.map((trackId) => ({ trackId, tagId: targetId })))
        .onConflictDoNothing()
    }

    if (sourceSliceIds.length > 0) {
      await markSamplesModified(sourceSliceIds)
    }

    if (shouldDeleteSourceTag) {
      const sourceSyncConfigs = await db
        .select({
          folderId: schema.syncConfigs.folderId,
          syncDirection: schema.syncConfigs.syncDirection,
          enabled: schema.syncConfigs.enabled,
        })
        .from(schema.syncConfigs)
        .where(eq(schema.syncConfigs.tagId, sourceId))

      if (sourceSyncConfigs.length > 0) {
        const targetSyncConfigs = await db
          .select({
            folderId: schema.syncConfigs.folderId,
            syncDirection: schema.syncConfigs.syncDirection,
          })
          .from(schema.syncConfigs)
          .where(eq(schema.syncConfigs.tagId, targetId))

        const existingTargetConfigKeys = new Set(
          targetSyncConfigs.map((config) => `${config.folderId}:${config.syncDirection}`),
        )

        const now = new Date().toISOString()
        const syncConfigsToInsert = sourceSyncConfigs
          .filter((config) => !existingTargetConfigKeys.has(`${config.folderId}:${config.syncDirection}`))
          .map((config) => ({
            tagId: targetId,
            folderId: config.folderId,
            syncDirection: config.syncDirection,
            enabled: config.enabled,
            createdAt: now,
          }))

        for (let i = 0; i < syncConfigsToInsert.length; i += BATCH_SIZE) {
          const batch = syncConfigsToInsert.slice(i, i + BATCH_SIZE)
          await db
            .insert(schema.syncConfigs)
            .values(batch)
            .onConflictDoNothing()
        }
      }

      await db.delete(schema.tags).where(eq(schema.tags.id, sourceId))
    }

    res.json({
      success: true,
      sourceTagId: sourceId,
      targetTagId: targetId,
      mergedSlices: sourceSliceIds.length,
      mergedTracks: sourceTrackIds.length,
      deletedSourceTag: shouldDeleteSourceTag,
    })
  } catch (error) {
    console.error('Error merging tags:', error)
    res.status(500).json({ error: 'Failed to merge tags' })
  }
})

// Create tag from folder (tag all slices in the folder)
router.post('/from-folder', async (req, res) => {
  const { folderId: rawFolderId, name, color } = req.body as { folderId: number | string; name?: string; color?: string }
  const folderId = Number(rawFolderId)

  if (!Number.isInteger(folderId) || folderId <= 0) {
    return res.status(400).json({ error: 'Valid folderId is required' })
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

    const tagName = normalizeTagName(name || folder[0].name)
    const tagColor = color || folder[0].color
    if (!tagName) {
      return res.status(400).json({ error: 'Name required' })
    }
    const reducibleError = getReducibleTagError(tagName)
    if (reducibleError) {
      return res.status(400).json({ error: reducibleError })
    }

    // Create the tag (or get existing)
    let tag
    try {
      const [newTag] = await db
        .insert(schema.tags)
        .values({ name: tagName, color: tagColor, category: 'instrument' })
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

    // Include descendants so converting a parent folder captures all nested samples.
    const folderRows = await db
      .select({ id: schema.folders.id, parentId: schema.folders.parentId })
      .from(schema.folders)

    const childFolderIdsByParent = new Map<number, number[]>()
    for (const row of folderRows) {
      if (row.parentId === null) continue
      const children = childFolderIdsByParent.get(row.parentId) || []
      children.push(row.id)
      childFolderIdsByParent.set(row.parentId, children)
    }

    const targetFolderIds = new Set<number>([folderId])
    const pendingFolderIds = [folderId]
    while (pendingFolderIds.length > 0) {
      const parentId = pendingFolderIds.pop() as number
      const childIds = childFolderIdsByParent.get(parentId) || []
      for (const childId of childIds) {
        if (targetFolderIds.has(childId)) continue
        targetFolderIds.add(childId)
        pendingFolderIds.push(childId)
      }
    }

    const sliceRows = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(inArray(schema.folderSlices.folderId, Array.from(targetFolderIds)))

    const uniqueSliceIds = Array.from(new Set(sliceRows.map((row) => row.sliceId)))

    // Tag all slices
    let tagged = 0
    for (const sliceId of uniqueSliceIds) {
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

    await markSamplesModified(uniqueSliceIds)

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
      if (isReducibleDimensionTag(existing[0].name)) {
        return res.status(400).json({ error: `Tag \"${existing[0].name}\" cannot be applied` })
      }
      tag = existing[0]
    } else {
      if (!name) {
        return res.status(400).json({ error: 'name or tagId required' })
      }
      const tagName = normalizeTagName(name)
      if (!tagName) {
        return res.status(400).json({ error: 'name or tagId required' })
      }
      const reducibleError = getReducibleTagError(tagName)
      if (reducibleError) {
        return res.status(400).json({ error: reducibleError })
      }
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
      .select({
        id: schema.slices.id,
        name: schema.slices.name,
        filePath: schema.slices.filePath,
        sampleModified: schema.slices.sampleModified,
        folderPath: schema.tracks.folderPath,
        relativePath: schema.tracks.relativePath,
      })
      .from(schema.slices)
      .leftJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(eq(schema.slices.id, sliceId))
      .limit(1)

    if (slice.length === 0) {
      return res.status(404).json({ error: 'Slice not found' })
    }

    if (!slice[0].filePath) {
      return res.status(400).json({ error: 'Slice audio file not found' })
    }

    const beforeTags = await getSliceTagNames(sliceId)
    const beforeAutoTags = await getSliceAiManagedTagNames(sliceId)
    const pathHint = buildSamplePathHint({
      folderPath: slice[0].folderPath ?? null,
      relativePath: slice[0].relativePath ?? null,
      filename: slice[0].name ?? null,
    })

    // Analyze audio with Python (Essentia + Librosa)
    const features = await analyzeAudioFeatures(slice[0].filePath, 'advanced', {
      filename: slice[0].name ?? undefined,
    })
    const fileMetadata = await getAudioFileMetadata(slice[0].filePath).catch(() => null)
    const enrichedFeatures = {
      ...features,
      sampleRate: fileMetadata?.sampleRate ?? features.sampleRate,
      channels: fileMetadata?.channels ?? undefined,
      fileFormat: fileMetadata?.format ?? undefined,
      sourceMtime: fileMetadata?.modifiedAt ?? undefined,
      sourceCtime: fileMetadata?.createdAt ?? undefined,
    }

    // Store raw features in database
    await storeAudioFeatures(sliceId, enrichedFeatures, {
      sampleName: slice[0].name ?? null,
      pathHint,
      preferPathHint: true,
    })

    const filenameEvidenceTags = await parseFilenameTagsSmart(
      slice[0].name,
      pathHint
    ).catch(() => [])
    const reviewedTags = await postAnalyzeSampleTags({
      features,
      sampleName: slice[0].name,
      folderPath: pathHint,
      modelTags: featuresToTags(features),
      previousAutoTags: beforeAutoTags,
      filenameTags: filenameEvidenceTags,
    })

    if (reviewedTags.length === 0) {
      return res.json({ tags: [], features })
    }

    await removeSliceAiManagedTags(sliceId)

    // Create tags that don't exist and link them to the slice
    const createdOrLinkedTags: string[] = []

    for (const reviewedTag of reviewedTags) {
      const lowerTag = reviewedTag.name.toLowerCase()

      try {
        // Get tag metadata (color and category)
        const { color, category } = getTagMetadata(lowerTag, reviewedTag.category)

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
        } else if (tag[0].category === 'filename' && category !== 'filename') {
          await db
            .update(schema.tags)
            .set({
              color,
              category,
            })
            .where(eq(schema.tags.id, tag[0].id))
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
    const afterAutoTags = await getSliceAiManagedTagNames(sliceId)

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
