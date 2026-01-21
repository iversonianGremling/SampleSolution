import { Router } from 'express'
import { eq, inArray, and } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema } from '../db/index.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

// Get all collections
router.get('/collections', async (_req, res) => {
  try {
    const collections = await db
      .select()
      .from(schema.collections)
      .orderBy(schema.collections.name)

    // Get slice count for each collection
    const collectionIds = collections.map((c) => c.id)
    const sliceCounts =
      collectionIds.length > 0
        ? await db
            .select({
              collectionId: schema.collectionSlices.collectionId,
            })
            .from(schema.collectionSlices)
            .where(inArray(schema.collectionSlices.collectionId, collectionIds))
        : []

    const countMap = new Map<number, number>()
    for (const row of sliceCounts) {
      countMap.set(row.collectionId, (countMap.get(row.collectionId) || 0) + 1)
    }

    const result = collections.map((col) => ({
      ...col,
      sliceCount: countMap.get(col.id) || 0,
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
    const [collection] = await db
      .insert(schema.collections)
      .values({
        name: name.trim(),
        color: color || '#6366f1',
        createdAt: new Date().toISOString(),
      })
      .returning()

    res.json({ ...collection, sliceCount: 0 })
  } catch (error) {
    console.error('Error creating collection:', error)
    res.status(500).json({ error: 'Failed to create collection' })
  }
})

// Update collection
router.put('/collections/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, color } = req.body as { name?: string; color?: string }

  try {
    const updates: Partial<{ name: string; color: string }> = {}
    if (name !== undefined) updates.name = name.trim()
    if (color !== undefined) updates.color = color

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

// Delete collection
router.delete('/collections/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    await db.delete(schema.collections).where(eq(schema.collections.id, id))
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting collection:', error)
    res.status(500).json({ error: 'Failed to delete collection' })
  }
})

// Add slice to collection
router.post('/collections/:id/slices', async (req, res) => {
  const collectionId = parseInt(req.params.id)
  const { sliceId } = req.body as { sliceId: number }

  if (!sliceId) {
    return res.status(400).json({ error: 'sliceId is required' })
  }

  try {
    await db
      .insert(schema.collectionSlices)
      .values({ collectionId, sliceId })
      .onConflictDoNothing()

    res.json({ success: true })
  } catch (error) {
    console.error('Error adding slice to collection:', error)
    res.status(500).json({ error: 'Failed to add slice to collection' })
  }
})

// Remove slice from collection
router.delete('/collections/:id/slices/:sliceId', async (req, res) => {
  const collectionId = parseInt(req.params.id)
  const sliceId = parseInt(req.params.sliceId)

  try {
    await db
      .delete(schema.collectionSlices)
      .where(
        and(
          eq(schema.collectionSlices.collectionId, collectionId),
          eq(schema.collectionSlices.sliceId, sliceId)
        )
      )

    res.json({ success: true })
  } catch (error) {
    console.error('Error removing slice from collection:', error)
    res.status(500).json({ error: 'Failed to remove slice from collection' })
  }
})

// Get slices in a collection
router.get('/collections/:id/slices', async (req, res) => {
  const collectionId = parseInt(req.params.id)

  try {
    const sliceIds = await db
      .select({ sliceId: schema.collectionSlices.sliceId })
      .from(schema.collectionSlices)
      .where(eq(schema.collectionSlices.collectionId, collectionId))

    res.json(sliceIds.map((s) => s.sliceId))
  } catch (error) {
    console.error('Error fetching collection slices:', error)
    res.status(500).json({ error: 'Failed to fetch collection slices' })
  }
})

// Export collection to disk
router.post('/collections/:id/export', async (req, res) => {
  const collectionId = parseInt(req.params.id)
  const { exportPath } = req.body as { exportPath?: string }

  try {
    // Get collection info
    const collection = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.id, collectionId))
      .limit(1)

    if (collection.length === 0) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    // Get slice IDs in collection
    const sliceLinks = await db
      .select({ sliceId: schema.collectionSlices.sliceId })
      .from(schema.collectionSlices)
      .where(eq(schema.collectionSlices.collectionId, collectionId))

    if (sliceLinks.length === 0) {
      return res.status(400).json({ error: 'Collection is empty' })
    }

    const sliceIds = sliceLinks.map((s) => s.sliceId)

    // Get slice details
    const slices = await db
      .select()
      .from(schema.slices)
      .where(inArray(schema.slices.id, sliceIds))

    // Determine export directory
    const exportDir = exportPath || path.join(DATA_DIR, 'exports', collection[0].name.replace(/[^a-zA-Z0-9]/g, '_'))
    await fs.mkdir(exportDir, { recursive: true })

    // Copy files
    const exported: string[] = []
    const failed: { name: string; error: string }[] = []

    for (const slice of slices) {
      if (slice.filePath) {
        try {
          const destPath = path.join(exportDir, `${slice.name.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`)
          await fs.copyFile(slice.filePath, destPath)
          exported.push(slice.name)
        } catch (err) {
          failed.push({ name: slice.name, error: String(err) })
        }
      } else {
        failed.push({ name: slice.name, error: 'No audio file' })
      }
    }

    res.json({
      success: true,
      exportPath: exportDir,
      exported,
      failed,
    })
  } catch (error) {
    console.error('Error exporting collection:', error)
    res.status(500).json({ error: 'Failed to export collection' })
  }
})

// Export all slices (or filtered by favorites)
router.post('/slices/export', async (req, res) => {
  const { favoritesOnly, exportPath } = req.body as { favoritesOnly?: boolean; exportPath?: string }

  try {
    let slices
    if (favoritesOnly) {
      slices = await db
        .select()
        .from(schema.slices)
        .where(eq(schema.slices.favorite, 1))
    } else {
      slices = await db.select().from(schema.slices)
    }

    if (slices.length === 0) {
      return res.status(400).json({ error: 'No slices to export' })
    }

    const folderName = favoritesOnly ? 'favorites' : 'all_slices'
    const exportDir = exportPath || path.join(DATA_DIR, 'exports', folderName)
    await fs.mkdir(exportDir, { recursive: true })

    const exported: string[] = []
    const failed: { name: string; error: string }[] = []

    for (const slice of slices) {
      if (slice.filePath) {
        try {
          const destPath = path.join(exportDir, `${slice.name.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`)
          await fs.copyFile(slice.filePath, destPath)
          exported.push(slice.name)
        } catch (err) {
          failed.push({ name: slice.name, error: String(err) })
        }
      } else {
        failed.push({ name: slice.name, error: 'No audio file' })
      }
    }

    res.json({
      success: true,
      exportPath: exportDir,
      exported,
      failed,
    })
  } catch (error) {
    console.error('Error exporting slices:', error)
    res.status(500).json({ error: 'Failed to export slices' })
  }
})

export default router
