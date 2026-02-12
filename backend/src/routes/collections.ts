import { Router } from 'express'
import { eq, inArray, and, sql } from 'drizzle-orm'
import { db, schema, getRawDb } from '../db/index.js'

const router = Router()

function useLegacyCollectionsSchema() {
  const sqlite = getRawDb()
  const collectionColumns = sqlite.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>
  const hasModernCollectionsSchema = collectionColumns.some((col) => col.name === 'sort_order')
  return !hasModernCollectionsSchema
}

// Get all collections with folder counts
router.get('/collections', async (_req, res) => {
  try {
    const sqlite = getRawDb()
    const collectionColumns = sqlite.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>
    const hasModernCollectionsSchema = collectionColumns.some((col) => col.name === 'sort_order')

    if (!hasModernCollectionsSchema) {
      const perspectives = sqlite
        .prepare(
          `SELECT id, name, color, sort_order, created_at
           FROM perspectives
           ORDER BY sort_order, name`
        )
        .all() as Array<{ id: number; name: string; color: string; sort_order: number; created_at: string }>

      const counts = sqlite
        .prepare(
          `SELECT perspective_id as collectionId, COUNT(*) as count
           FROM collections
           WHERE perspective_id IS NOT NULL
           GROUP BY perspective_id`
        )
        .all() as Array<{ collectionId: number; count: number }>

      const countMap = new Map<number, number>()
      for (const row of counts) {
        countMap.set(row.collectionId, row.count)
      }

      return res.json(
        perspectives.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          sortOrder: p.sort_order ?? 0,
          folderCount: countMap.get(p.id) || 0,
          createdAt: p.created_at,
        }))
      )
    }

    const collections = await db
      .select()
      .from(schema.collections)
      .orderBy(schema.collections.sortOrder, schema.collections.name)

    // Get folder counts per collection
    const collectionIds = collections.map(p => p.id)
    let countMap = new Map<number, number>()

    if (collectionIds.length > 0) {
      const counts = await db
        .select({
          collectionId: schema.folders.collectionId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(schema.folders)
        .where(inArray(schema.folders.collectionId, collectionIds))
        .groupBy(schema.folders.collectionId)

      for (const row of counts) {
        if (row.collectionId !== null) {
          countMap.set(row.collectionId, row.count)
        }
      }
    }

    const result = collections.map(p => ({
      ...p,
      folderCount: countMap.get(p.id) || 0,
    }))

    res.json(result)
  } catch (error) {
    console.error('Error fetching collections:', error)
    res.status(500).json({ error: 'Failed to fetch collections' })
  }
})

// Create collection
router.post('/collections', async (req, res) => {
  const { name, color } = req.body as { name: string; color?: string }

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' })
  }

  try {
    if (useLegacyCollectionsSchema()) {
      const sqlite = getRawDb()
      const maxSortRow = sqlite
        .prepare('SELECT COALESCE(MAX(sort_order), -1) as maxSort FROM perspectives')
        .get() as { maxSort: number }

      const now = new Date().toISOString()
      const result = sqlite
        .prepare('INSERT INTO perspectives (name, color, sort_order, created_at) VALUES (?, ?, ?, ?)')
        .run(name.trim(), color || '#6366f1', (maxSortRow?.maxSort ?? -1) + 1, now)

      return res.json({
        id: Number(result.lastInsertRowid),
        name: name.trim(),
        color: color || '#6366f1',
        sortOrder: (maxSortRow?.maxSort ?? -1) + 1,
        folderCount: 0,
        createdAt: now,
      })
    }

    // Get max sort order
    const existing = await db.select().from(schema.collections)
    const maxSort = existing.reduce((max, p) => Math.max(max, p.sortOrder), -1)

    const [collection] = await db
      .insert(schema.collections)
      .values({
        name: name.trim(),
        color: color || '#6366f1',
        sortOrder: maxSort + 1,
        createdAt: new Date().toISOString(),
      })
      .returning()

    res.json({ ...collection, folderCount: 0 })
  } catch (error) {
    console.error('Error creating collection:', error)
    res.status(500).json({ error: 'Failed to create collection' })
  }
})

// Update collection
router.put('/collections/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, color, sortOrder } = req.body as { name?: string; color?: string; sortOrder?: number }

  try {
    if (useLegacyCollectionsSchema()) {
      const sqlite = getRawDb()

      const updates: Array<{ sql: string; value: unknown }> = []
      if (name !== undefined) updates.push({ sql: 'name = ?', value: name.trim() })
      if (color !== undefined) updates.push({ sql: 'color = ?', value: color })
      if (sortOrder !== undefined) updates.push({ sql: 'sort_order = ?', value: sortOrder })

      if (updates.length === 0) {
        const unchanged = sqlite
          .prepare('SELECT id, name, color, sort_order, created_at FROM perspectives WHERE id = ? LIMIT 1')
          .get(id) as { id: number; name: string; color: string; sort_order: number; created_at: string } | undefined
        if (!unchanged) {
          return res.status(404).json({ error: 'Collection not found' })
        }

        return res.json({
          id: unchanged.id,
          name: unchanged.name,
          color: unchanged.color,
          sortOrder: unchanged.sort_order,
          createdAt: unchanged.created_at,
        })
      }

      const setSql = updates.map((u) => u.sql).join(', ')
      const values = updates.map((u) => u.value)
      const result = sqlite.prepare(`UPDATE perspectives SET ${setSql} WHERE id = ?`).run(...values, id)

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Collection not found' })
      }

      const updated = sqlite
        .prepare('SELECT id, name, color, sort_order, created_at FROM perspectives WHERE id = ? LIMIT 1')
        .get(id) as { id: number; name: string; color: string; sort_order: number; created_at: string } | undefined

      if (!updated) {
        return res.status(404).json({ error: 'Collection not found' })
      }

      return res.json({
        id: updated.id,
        name: updated.name,
        color: updated.color,
        sortOrder: updated.sort_order,
        createdAt: updated.created_at,
      })
    }

    const updates: Partial<{ name: string; color: string; sortOrder: number }> = {}
    if (name !== undefined) updates.name = name.trim()
    if (color !== undefined) updates.color = color
    if (sortOrder !== undefined) updates.sortOrder = sortOrder

    const [updated] = await db
      .update(schema.collections)
      .set(updates)
      .where(eq(schema.collections.id, id))
      .returning()

    if (!updated) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    res.json(updated)
  } catch (error) {
    console.error('Error updating collection:', error)
    res.status(500).json({ error: 'Failed to update collection' })
  }
})

// Delete collection (cascades to folders via FK)
router.delete('/collections/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    if (useLegacyCollectionsSchema()) {
      const sqlite = getRawDb()
      sqlite.prepare('UPDATE collections SET perspective_id = NULL WHERE perspective_id = ?').run(id)
      sqlite.prepare('DELETE FROM perspectives WHERE id = ?').run(id)
      return res.json({ success: true })
    }

    await db.delete(schema.collections).where(eq(schema.collections.id, id))
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting collection:', error)
    res.status(500).json({ error: 'Failed to delete collection' })
  }
})

// Get facets for a collection (all samples across all its folders)
router.get('/collections/:id/facets', async (req, res) => {
  const collectionId = parseInt(req.params.id)

  try {
    // Get all folders in this collection
    const folders = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(eq(schema.folders.collectionId, collectionId))

    const folderIds = folders.map(c => c.id)
    if (folderIds.length === 0) {
      return res.json({ tags: {}, metadata: {}, totalSamples: 0 })
    }

    // Get all unique slice IDs across all folders in this collection
    const sliceLinks = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(inArray(schema.folderSlices.folderId, folderIds))

    const sliceIds = [...new Set(sliceLinks.map(s => s.sliceId))]
    if (sliceIds.length === 0) {
      return res.json({ tags: {}, metadata: {}, totalSamples: 0 })
    }

    const facets = await buildFacets(sliceIds)
    res.json({ ...facets, totalSamples: sliceIds.length })
  } catch (error) {
    console.error('Error fetching collection facets:', error)
    res.status(500).json({ error: 'Failed to fetch facets' })
  }
})

// Get facets for a specific folder
router.get('/folders/:id/facets', async (req, res) => {
  const folderId = parseInt(req.params.id)

  try {
    const sliceLinks = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(eq(schema.folderSlices.folderId, folderId))

    const sliceIds = sliceLinks.map(s => s.sliceId)
    if (sliceIds.length === 0) {
      return res.json({ tags: {}, metadata: {}, totalSamples: 0 })
    }

    const facets = await buildFacets(sliceIds)
    res.json({ ...facets, totalSamples: sliceIds.length })
  } catch (error) {
    console.error('Error fetching folder facets:', error)
    res.status(500).json({ error: 'Failed to fetch facets' })
  }
})

// Split a folder by a facet
router.post('/folders/:id/split', async (req, res) => {
  const folderId = parseInt(req.params.id)
  const { facetType, facetKey, selectedValues } = req.body as {
    facetType: 'tag-category' | 'metadata'
    facetKey: string
    selectedValues?: string[]
  }

  if (!facetType || !facetKey) {
    return res.status(400).json({ error: 'facetType and facetKey are required' })
  }

  try {
    // Get parent folder to inherit collectionId and color
    const [parentFolder] = await db
      .select()
      .from(schema.folders)
      .where(eq(schema.folders.id, folderId))

    if (!parentFolder) {
      return res.status(404).json({ error: 'Folder not found' })
    }

    // Get all slice IDs in this folder
    const sliceLinks = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(eq(schema.folderSlices.folderId, folderId))

    const sliceIds = sliceLinks.map(s => s.sliceId)
    if (sliceIds.length === 0) {
      return res.json({ created: [], unmatched: 0 })
    }

    // Group slices by facet value
    let groups: Map<string, number[]>

    if (facetType === 'tag-category') {
      groups = await groupSlicesByTagCategory(sliceIds, facetKey as TagCategory)
    } else {
      groups = await groupSlicesByMetadata(sliceIds, facetKey)
    }

    // Filter to selected values if specified
    if (selectedValues && selectedValues.length > 0) {
      const selectedSet = new Set(selectedValues)
      for (const key of groups.keys()) {
        if (!selectedSet.has(key)) {
          groups.delete(key)
        }
      }
    }

    // Create sub-folders
    const created: { id: number; name: string; sliceCount: number }[] = []
    const matchedSliceIds = new Set<number>()

    for (const [value, groupSliceIds] of groups) {
      if (groupSliceIds.length === 0) continue

      // Create child folder
      const [child] = await db
        .insert(schema.folders)
        .values({
          name: value,
          color: parentFolder.color,
          parentId: folderId,
          collectionId: parentFolder.collectionId,
          createdAt: new Date().toISOString(),
        })
        .returning()

      // Add slices to child folder
      await db
        .insert(schema.folderSlices)
        .values(groupSliceIds.map(sliceId => ({
          folderId: child.id,
          sliceId,
        })))
        .onConflictDoNothing()

      for (const id of groupSliceIds) matchedSliceIds.add(id)

      created.push({
        id: child.id,
        name: value,
        sliceCount: groupSliceIds.length,
      })
    }

    const unmatched = sliceIds.filter(id => !matchedSliceIds.has(id)).length

    res.json({ created, unmatched })
  } catch (error) {
    console.error('Error splitting folder:', error)
    res.status(500).json({ error: 'Failed to split folder' })
  }
})

// Split collection — creates root-level folders in the collection from all its samples
router.post('/collections/:id/split', async (req, res) => {
  const collectionId = parseInt(req.params.id)
  const { facetType, facetKey, selectedValues } = req.body as {
    facetType: 'tag-category' | 'metadata'
    facetKey: string
    selectedValues?: string[]
  }

  if (!facetType || !facetKey) {
    return res.status(400).json({ error: 'facetType and facetKey are required' })
  }

  try {
    // Get the collection
    const [collection] = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.id, collectionId))

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    // Get all folders in this collection
    const collectionFolders = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(eq(schema.folders.collectionId, collectionId))

    const folderIds = collectionFolders.map(c => c.id)
    if (folderIds.length === 0) {
      return res.json({ created: [], unmatched: 0 })
    }

    // Get all slice IDs across all folders in this collection
    const sliceLinks = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(inArray(schema.folderSlices.folderId, folderIds))

    const sliceIds = [...new Set(sliceLinks.map(s => s.sliceId))]
    if (sliceIds.length === 0) {
      return res.json({ created: [], unmatched: 0 })
    }

    // Group slices by facet value
    let groups: Map<string, number[]>

    if (facetType === 'tag-category') {
      groups = await groupSlicesByTagCategory(sliceIds, facetKey as TagCategory)
    } else {
      groups = await groupSlicesByMetadata(sliceIds, facetKey)
    }

    // Filter to selected values if specified
    if (selectedValues && selectedValues.length > 0) {
      const selectedSet = new Set(selectedValues)
      for (const key of groups.keys()) {
        if (!selectedSet.has(key)) {
          groups.delete(key)
        }
      }
    }

    // Create root-level folders in the collection
    const created: { id: number; name: string; sliceCount: number }[] = []
    const matchedSliceIds = new Set<number>()

    for (const [value, groupSliceIds] of groups) {
      if (groupSliceIds.length === 0) continue

      const [child] = await db
        .insert(schema.folders)
        .values({
          name: value,
          color: collection.color,
          parentId: null,
          collectionId,
          createdAt: new Date().toISOString(),
        })
        .returning()

      await db
        .insert(schema.folderSlices)
        .values(groupSliceIds.map(sliceId => ({
          folderId: child.id,
          sliceId,
        })))
        .onConflictDoNothing()

      for (const id of groupSliceIds) matchedSliceIds.add(id)

      created.push({
        id: child.id,
        name: value,
        sliceCount: groupSliceIds.length,
      })
    }

    const unmatched = sliceIds.filter(id => !matchedSliceIds.has(id)).length

    res.json({ created, unmatched })
  } catch (error) {
    console.error('Error splitting collection:', error)
    res.status(500).json({ error: 'Failed to split collection' })
  }
})

// --- Helper functions ---

async function buildFacets(sliceIds: number[]) {
  // Batch sliceIds to avoid SQLite variable limits
  const BATCH_SIZE = 500
  const tagResults: { sliceId: number; tagId: number; tagName: string; tagCategory: string }[] = []
  const metadataResults: { sliceId: number; instrumentType: string | null; genrePrimary: string | null; keyEstimate: string | null; envelopeType: string | null }[] = []

  for (let i = 0; i < sliceIds.length; i += BATCH_SIZE) {
    const batch = sliceIds.slice(i, i + BATCH_SIZE)

    // Get tags for these slices
    const tagRows = await db
      .select({
        sliceId: schema.sliceTags.sliceId,
        tagId: schema.tags.id,
        tagName: schema.tags.name,
        tagCategory: schema.tags.category,
      })
      .from(schema.sliceTags)
      .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
      .where(inArray(schema.sliceTags.sliceId, batch))

    tagResults.push(...tagRows)

    // Get metadata for these slices
    const metaRows = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        instrumentType: schema.audioFeatures.instrumentType,
        genrePrimary: schema.audioFeatures.genrePrimary,
        keyEstimate: schema.audioFeatures.keyEstimate,
        envelopeType: schema.audioFeatures.envelopeType,
      })
      .from(schema.audioFeatures)
      .where(inArray(schema.audioFeatures.sliceId, batch))

    metadataResults.push(...metaRows)
  }

  // Group tags by category
  const tags: Record<string, { tagId: number; name: string; count: number }[]> = {}
  const tagCountMap = new Map<string, Map<number, { name: string; count: number }>>()

  for (const row of tagResults) {
    if (!tagCountMap.has(row.tagCategory)) {
      tagCountMap.set(row.tagCategory, new Map())
    }
    const catMap = tagCountMap.get(row.tagCategory)!
    if (!catMap.has(row.tagId)) {
      catMap.set(row.tagId, { name: row.tagName, count: 0 })
    }
    catMap.get(row.tagId)!.count++
  }

  for (const [category, catMap] of tagCountMap) {
    tags[category] = Array.from(catMap.entries())
      .map(([tagId, data]) => ({ tagId, name: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
  }

  // Group metadata values
  const metadata: Record<string, { value: string; count: number }[]> = {}
  const metaFields = ['instrumentType', 'genrePrimary', 'keyEstimate', 'envelopeType'] as const

  for (const field of metaFields) {
    const countMap = new Map<string, number>()
    for (const row of metadataResults) {
      const value = row[field]
      if (value) {
        countMap.set(value, (countMap.get(value) || 0) + 1)
      }
    }
    if (countMap.size > 0) {
      metadata[field] = Array.from(countMap.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
    }
  }

  return { tags, metadata }
}

type TagCategory = 'general' | 'type' | 'tempo' | 'spectral' | 'energy' | 'instrument' | 'filename'

async function groupSlicesByTagCategory(sliceIds: number[], category: TagCategory): Promise<Map<string, number[]>> {
  const groups = new Map<string, number[]>()
  const BATCH_SIZE = 500

  for (let i = 0; i < sliceIds.length; i += BATCH_SIZE) {
    const batch = sliceIds.slice(i, i + BATCH_SIZE)

    const rows = await db
      .select({
        sliceId: schema.sliceTags.sliceId,
        tagName: schema.tags.name,
      })
      .from(schema.sliceTags)
      .innerJoin(schema.tags, eq(schema.sliceTags.tagId, schema.tags.id))
      .where(
        and(
          inArray(schema.sliceTags.sliceId, batch),
          eq(schema.tags.category, category)
        )
      )

    for (const row of rows) {
      if (!groups.has(row.tagName)) {
        groups.set(row.tagName, [])
      }
      groups.get(row.tagName)!.push(row.sliceId)
    }
  }

  return groups
}

async function groupSlicesByMetadata(sliceIds: number[], field: string): Promise<Map<string, number[]>> {
  const groups = new Map<string, number[]>()
  const validFields = ['instrumentType', 'genrePrimary', 'keyEstimate', 'envelopeType'] as const
  type ValidField = typeof validFields[number]

  if (!validFields.includes(field as ValidField)) {
    return groups
  }

  const BATCH_SIZE = 500

  for (let i = 0; i < sliceIds.length; i += BATCH_SIZE) {
    const batch = sliceIds.slice(i, i + BATCH_SIZE)

    const rows = await db
      .select({
        sliceId: schema.audioFeatures.sliceId,
        value: schema.audioFeatures[field as ValidField],
      })
      .from(schema.audioFeatures)
      .where(inArray(schema.audioFeatures.sliceId, batch))

    for (const row of rows) {
      const value = row.value as string | null
      if (value) {
        if (!groups.has(value)) {
          groups.set(value, [])
        }
        groups.get(value)!.push(row.sliceId)
      }
    }
  }

  return groups
}

export default router
