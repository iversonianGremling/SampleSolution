import { Router } from 'express'
import { eq, inArray, and, isNull } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema, getRawDb } from '../db/index.js'
import {
  onFolderSliceAdded,
  onFolderSliceRemoved,
  createSyncLink,
  removeSyncLink,
  getAllSyncConfigs,
} from '../services/tagFolderSync.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

function isLegacyFoldersSchema() {
  const sqlite = getRawDb()
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  const hasPerspectivesTable = tables.some((t) => t.name === 'perspectives')
  const collectionColumns = sqlite.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>
  const hasLegacyCollectionColumns = collectionColumns.some((col) => col.name === 'perspective_id')
  return hasPerspectivesTable || hasLegacyCollectionColumns
}

// Get all folders (optionally filtered by collectionId or ungrouped)
router.get('/folders', async (req, res) => {
  try {
    const { collectionId, ungrouped } = req.query as { collectionId?: string; ungrouped?: string }

    const sqlite = getRawDb()
    const hasLegacyCollectionsSchema = isLegacyFoldersSchema()

    if (hasLegacyCollectionsSchema) {
      const whereParts: string[] = []
      if (ungrouped === 'true') {
        whereParts.push('perspective_id IS NULL')
      } else if (collectionId) {
        whereParts.push(`perspective_id = ${Number.parseInt(collectionId, 10)}`)
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
      const legacyCollections = sqlite
        .prepare(
          `SELECT id, name, color, parent_id, perspective_id, created_at
           FROM collections
           ${whereSql}
           ORDER BY name`
        )
        .all() as Array<{
          id: number
          name: string
          color: string
          parent_id: number | null
          perspective_id: number | null
          created_at: string
        }>

      const ids = legacyCollections.map((row) => row.id)
      const counts = ids.length > 0
        ? sqlite
            .prepare(
              `SELECT collection_id as collectionId, COUNT(*) as count
               FROM collection_slices
               WHERE collection_id IN (${ids.join(',')})
               GROUP BY collection_id`
            )
            .all() as Array<{ collectionId: number; count: number }>
        : []

      const countMap = new Map<number, number>()
      for (const row of counts) {
        countMap.set(row.collectionId, row.count)
      }

      return res.json(
        legacyCollections.map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color,
          parentId: row.parent_id ?? null,
          collectionId: row.perspective_id ?? null,
          sliceCount: countMap.get(row.id) || 0,
          createdAt: row.created_at,
        }))
      )
    }

    let whereClause
    if (ungrouped === 'true') {
      whereClause = isNull(schema.folders.collectionId)
    } else if (collectionId) {
      whereClause = eq(schema.folders.collectionId, parseInt(collectionId))
    }

    const folders = whereClause
      ? await db.select().from(schema.folders).where(whereClause).orderBy(schema.folders.name)
      : await db.select().from(schema.folders).orderBy(schema.folders.name)

    // Get slice count for each folder
    const folderIds = folders.map((c) => c.id)
    const sliceCounts =
      folderIds.length > 0
        ? await db
            .select({
              folderId: schema.folderSlices.folderId,
            })
            .from(schema.folderSlices)
            .where(inArray(schema.folderSlices.folderId, folderIds))
        : []

    const countMap = new Map<number, number>()
    for (const row of sliceCounts) {
      countMap.set(row.folderId, (countMap.get(row.folderId) || 0) + 1)
    }

    const result = folders.map((col) => ({
      ...col,
      sliceCount: countMap.get(col.id) || 0,
    }))

    res.json(result)
  } catch (error) {
    console.error('Error fetching folders:', error)
    res.status(500).json({ error: 'Failed to fetch folders' })
  }
})

// Create folder
router.post('/folders', async (req, res) => {
  const { name, color, parentId, collectionId } = req.body as { name: string; color?: string; parentId?: number; collectionId?: number }

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' })
  }

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      const now = new Date().toISOString()

      const stmt = sqlite.prepare(
        `INSERT INTO collections (name, color, parent_id, perspective_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      const result = stmt.run(
        name.trim(),
        color || '#6366f1',
        parentId ?? null,
        collectionId ?? null,
        now
      )

      return res.json({
        id: Number(result.lastInsertRowid),
        name: name.trim(),
        color: color || '#6366f1',
        parentId: parentId ?? null,
        collectionId: collectionId ?? null,
        sliceCount: 0,
        createdAt: now,
      })
    }

    const result = await db
      .insert(schema.folders)
      .values({
        name: name.trim(),
        color: color || '#6366f1',
        parentId: parentId || null,
        collectionId: collectionId || null,
        createdAt: new Date().toISOString(),
      })
      .returning()

    const folder = Array.isArray(result) ? result[0] : result
    res.json({ ...folder, sliceCount: 0 })
  } catch (error) {
    console.error('Error creating folder:', error)
    res.status(500).json({ error: 'Failed to create folder' })
  }
})

// Update folder
router.put('/folders/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { name, color, parentId, collectionId } = req.body as {
    name?: string
    color?: string
    parentId?: number | null
    collectionId?: number | null
  }

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()

      type LegacyFolder = {
        id: number
        name: string
        color: string
        parent_id: number | null
        perspective_id: number | null
        created_at: string
      }

      const existing = sqlite
        .prepare(
          `SELECT id, name, color, parent_id, perspective_id, created_at
           FROM collections
           WHERE id = ?
           LIMIT 1`
        )
        .get(id) as LegacyFolder | undefined

      if (!existing) {
        return res.status(404).json({ error: 'Folder not found' })
      }

      const updates: Array<{ sql: string; value: unknown }> = []
      if (name !== undefined) updates.push({ sql: 'name = ?', value: name.trim() })
      if (color !== undefined) updates.push({ sql: 'color = ?', value: color })
      if (parentId !== undefined) updates.push({ sql: 'parent_id = ?', value: parentId })
      if (collectionId !== undefined) updates.push({ sql: 'perspective_id = ?', value: collectionId })

      let inheritedCollectionId: number | null | undefined
      if (parentId !== undefined && collectionId === undefined && parentId !== null) {
        const parent = sqlite
          .prepare('SELECT perspective_id FROM collections WHERE id = ? LIMIT 1')
          .get(parentId) as { perspective_id: number | null } | undefined
        inheritedCollectionId = parent?.perspective_id ?? null
        updates.push({ sql: 'perspective_id = ?', value: inheritedCollectionId })
      }

      if (updates.length > 0) {
        const setSql = updates.map((u) => u.sql).join(', ')
        const values = updates.map((u) => u.value)
        sqlite.prepare(`UPDATE collections SET ${setSql} WHERE id = ?`).run(...values, id)
      }

      const updated = sqlite
        .prepare(
          `SELECT id, name, color, parent_id, perspective_id, created_at
           FROM collections
           WHERE id = ?
           LIMIT 1`
        )
        .get(id) as LegacyFolder | undefined

      if (!updated) {
        return res.status(404).json({ error: 'Folder not found' })
      }

      if (collectionId !== undefined || (parentId !== undefined && inheritedCollectionId !== undefined)) {
        const targetCollectionId = collectionId !== undefined ? collectionId : inheritedCollectionId ?? null
        const allFolders = sqlite
          .prepare('SELECT id, parent_id FROM collections')
          .all() as Array<{ id: number; parent_id: number | null }>

        const childrenByParent = new Map<number, number[]>()
        for (const row of allFolders) {
          if (row.parent_id !== null) {
            const list = childrenByParent.get(row.parent_id) || []
            list.push(row.id)
            childrenByParent.set(row.parent_id, list)
          }
        }

        const queue = [...(childrenByParent.get(id) || [])]
        const descendantIds: number[] = []
        while (queue.length > 0) {
          const next = queue.shift()!
          descendantIds.push(next)
          const kids = childrenByParent.get(next)
          if (kids && kids.length > 0) queue.push(...kids)
        }

        if (descendantIds.length > 0) {
          const placeholders = descendantIds.map(() => '?').join(',')
          sqlite
            .prepare(`UPDATE collections SET perspective_id = ? WHERE id IN (${placeholders})`)
            .run(targetCollectionId, ...descendantIds)
        }
      }

      return res.json({
        id: updated.id,
        name: updated.name,
        color: updated.color,
        parentId: updated.parent_id ?? null,
        collectionId: updated.perspective_id ?? null,
        createdAt: updated.created_at,
      })
    }

    const updates: Partial<{ name: string; color: string; parentId: number | null; collectionId: number | null }> = {}
    if (name !== undefined) updates.name = name.trim()
    if (color !== undefined) updates.color = color
    if (parentId !== undefined) updates.parentId = parentId
    if (collectionId !== undefined) updates.collectionId = collectionId

    // If parentId is provided but collectionId is not, inherit parent's collection.
    if (parentId !== undefined && collectionId === undefined && parentId !== null) {
      const [parent] = await db
        .select({ collectionId: schema.folders.collectionId })
        .from(schema.folders)
        .where(eq(schema.folders.id, parentId))
        .limit(1)
      if (parent) {
        updates.collectionId = parent.collectionId
      }
    }

    const [updated] = await db
      .update(schema.folders)
      .set(updates)
      .where(eq(schema.folders.id, id))
      .returning()

    if (!updated) {
      return res.status(404).json({ error: 'Folder not found' })
    }

    if (collectionId !== undefined || (parentId !== undefined && updates.collectionId !== undefined)) {
      const targetCollectionId = updates.collectionId ?? null
      const allFolders = await db
        .select({ id: schema.folders.id, parentId: schema.folders.parentId })
        .from(schema.folders)

      const childrenByParent = new Map<number, number[]>()
      for (const row of allFolders) {
        if (row.parentId !== null) {
          const list = childrenByParent.get(row.parentId) || []
          list.push(row.id)
          childrenByParent.set(row.parentId, list)
        }
      }

      const queue = [...(childrenByParent.get(id) || [])]
      const descendantIds: number[] = []
      while (queue.length > 0) {
        const next = queue.shift()!
        descendantIds.push(next)
        const kids = childrenByParent.get(next)
        if (kids && kids.length > 0) queue.push(...kids)
      }

      if (descendantIds.length > 0) {
        await db
          .update(schema.folders)
          .set({ collectionId: targetCollectionId })
          .where(inArray(schema.folders.id, descendantIds))
      }
    }

    res.json(updated)
  } catch (error) {
    console.error('Error updating folder:', error)
    res.status(500).json({ error: 'Failed to update folder' })
  }
})

// Delete folder
router.delete('/folders/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      sqlite.prepare('DELETE FROM collection_slices WHERE collection_id = ?').run(id)
      sqlite.prepare('DELETE FROM collections WHERE id = ?').run(id)
      return res.json({ success: true })
    }

    await db.delete(schema.folders).where(eq(schema.folders.id, id))
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting folder:', error)
    res.status(500).json({ error: 'Failed to delete folder' })
  }
})

// Add slice to folder
router.post('/folders/:id/slices', async (req, res) => {
  const folderId = parseInt(req.params.id)
  const { sliceId } = req.body as { sliceId: number }

  if (!sliceId) {
    return res.status(400).json({ error: 'sliceId is required' })
  }

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      sqlite
        .prepare('INSERT OR IGNORE INTO collection_slices (collection_id, slice_id) VALUES (?, ?)')
        .run(folderId, sliceId)

      onFolderSliceAdded(folderId, sliceId).catch(err => console.error('Sync error (slice added):', err))
      return res.json({ success: true })
    }

    await db
      .insert(schema.folderSlices)
      .values({ folderId, sliceId })
      .onConflictDoNothing()

    // Trigger tag-folder sync
    onFolderSliceAdded(folderId, sliceId).catch(err => console.error('Sync error (slice added):', err))

    res.json({ success: true })
  } catch (error) {
    console.error('Error adding slice to folder:', error)
    res.status(500).json({ error: 'Failed to add slice to folder' })
  }
})

// Batch add slices to folder
router.post('/folders/:id/slices/batch', async (req, res) => {
  const folderId = parseInt(req.params.id)
  const { sliceIds } = req.body as { sliceIds: number[] }

  if (!sliceIds || !Array.isArray(sliceIds) || sliceIds.length === 0) {
    return res.status(400).json({ error: 'sliceIds array is required' })
  }

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      const insertStmt = sqlite.prepare('INSERT OR IGNORE INTO collection_slices (collection_id, slice_id) VALUES (?, ?)')
      const tx = sqlite.transaction((ids: number[]) => {
        for (const sid of ids) {
          insertStmt.run(folderId, sid)
        }
      })
      tx(sliceIds)

      for (const sliceId of sliceIds) {
        onFolderSliceAdded(folderId, sliceId).catch(err =>
          console.error('Sync error (batch slice added):', err)
        )
      }

      return res.json({ success: true, added: sliceIds.length })
    }

    const BATCH_SIZE = 500
    for (let i = 0; i < sliceIds.length; i += BATCH_SIZE) {
      const batch = sliceIds.slice(i, i + BATCH_SIZE)
      await db
        .insert(schema.folderSlices)
        .values(batch.map(sliceId => ({ folderId, sliceId })))
        .onConflictDoNothing()
    }

    for (const sliceId of sliceIds) {
      onFolderSliceAdded(folderId, sliceId).catch(err =>
        console.error('Sync error (batch slice added):', err)
      )
    }

    res.json({ success: true, added: sliceIds.length })
  } catch (error) {
    console.error('Error batch adding slices:', error)
    res.status(500).json({ error: 'Failed to batch add slices' })
  }
})

// Batch create folders with slices
router.post('/folders/batch-create', async (req, res) => {
  const { collectionId, folders } = req.body as {
    collectionId: number
    folders: Array<{
      tempId: string
      name: string
      color?: string
      parentTempId?: string
      parentId?: number
      sliceIds: number[]
    }>
  }

  if (!collectionId || !folders || !Array.isArray(folders) || folders.length === 0) {
    return res.status(400).json({ error: 'collectionId and folders array are required' })
  }

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      const tempIdToRealId = new Map<string, number>()
      const created: Array<{ tempId: string; id: number; name: string; sliceCount: number }> = []

      const insertCollection = sqlite.prepare(
        `INSERT INTO collections (name, color, parent_id, perspective_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      const insertLink = sqlite.prepare('INSERT OR IGNORE INTO collection_slices (collection_id, slice_id) VALUES (?, ?)')

      for (const folderDef of folders) {
        let parentId: number | null = folderDef.parentId || null
        if (folderDef.parentTempId && tempIdToRealId.has(folderDef.parentTempId)) {
          parentId = tempIdToRealId.get(folderDef.parentTempId)!
        }

        const now = new Date().toISOString()
        const result = insertCollection.run(
          folderDef.name.trim(),
          folderDef.color || '#6366f1',
          parentId,
          collectionId,
          now
        )
        const realId = Number(result.lastInsertRowid)
        tempIdToRealId.set(folderDef.tempId, realId)

        for (const sid of folderDef.sliceIds) {
          insertLink.run(realId, sid)
        }

        created.push({
          tempId: folderDef.tempId,
          id: realId,
          name: folderDef.name,
          sliceCount: folderDef.sliceIds.length,
        })
      }

      return res.json({ created })
    }

    const tempIdToRealId = new Map<string, number>()
    const created: Array<{ tempId: string; id: number; name: string; sliceCount: number }> = []

    for (const folderDef of folders) {
      let parentId: number | null = folderDef.parentId || null
      if (folderDef.parentTempId && tempIdToRealId.has(folderDef.parentTempId)) {
        parentId = tempIdToRealId.get(folderDef.parentTempId)!
      }

      const [createdFolder] = await db
        .insert(schema.folders)
        .values({
          name: folderDef.name.trim(),
          color: folderDef.color || '#6366f1',
          parentId,
          collectionId,
          createdAt: new Date().toISOString(),
        })
        .returning()

      tempIdToRealId.set(folderDef.tempId, createdFolder.id)

      if (folderDef.sliceIds.length > 0) {
        const BATCH_SIZE = 500
        for (let i = 0; i < folderDef.sliceIds.length; i += BATCH_SIZE) {
          const batch = folderDef.sliceIds.slice(i, i + BATCH_SIZE)
          await db
            .insert(schema.folderSlices)
            .values(batch.map((sliceId: number) => ({ folderId: createdFolder.id, sliceId })))
            .onConflictDoNothing()
        }
      }

      created.push({
        tempId: folderDef.tempId,
        id: createdFolder.id,
        name: folderDef.name,
        sliceCount: folderDef.sliceIds.length,
      })
    }

    res.json({ created })
  } catch (error) {
    console.error('Error batch creating folders:', error)
    res.status(500).json({ error: 'Failed to batch create folders' })
  }
})

// Remove slice from folder
router.delete('/folders/:id/slices/:sliceId', async (req, res) => {
  const folderId = parseInt(req.params.id)
  const sliceId = parseInt(req.params.sliceId)

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      sqlite
        .prepare('DELETE FROM collection_slices WHERE collection_id = ? AND slice_id = ?')
        .run(folderId, sliceId)

      onFolderSliceRemoved(folderId, sliceId).catch(err => console.error('Sync error (slice removed):', err))
      return res.json({ success: true })
    }

    await db
      .delete(schema.folderSlices)
      .where(
        and(
          eq(schema.folderSlices.folderId, folderId),
          eq(schema.folderSlices.sliceId, sliceId)
        )
      )

    // Trigger tag-folder sync
    onFolderSliceRemoved(folderId, sliceId).catch(err => console.error('Sync error (slice removed):', err))

    res.json({ success: true })
  } catch (error) {
    console.error('Error removing slice from folder:', error)
    res.status(500).json({ error: 'Failed to remove slice from folder' })
  }
})

// Get slices in a folder
router.get('/folders/:id/slices', async (req, res) => {
  const folderId = parseInt(req.params.id)

  try {
    if (isLegacyFoldersSchema()) {
      const sqlite = getRawDb()
      const rows = sqlite
        .prepare('SELECT slice_id as sliceId FROM collection_slices WHERE collection_id = ?')
        .all(folderId) as Array<{ sliceId: number }>
      return res.json(rows.map((s) => s.sliceId))
    }

    const sliceIds = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(eq(schema.folderSlices.folderId, folderId))

    res.json(sliceIds.map((s) => s.sliceId))
  } catch (error) {
    console.error('Error fetching folder slices:', error)
    res.status(500).json({ error: 'Failed to fetch folder slices' })
  }
})

// Export folder to disk
router.post('/folders/:id/export', async (req, res) => {
  const folderId = parseInt(req.params.id)
  const { exportPath } = req.body as { exportPath?: string }

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

    // Get slice IDs in folder
    const sliceLinks = await db
      .select({ sliceId: schema.folderSlices.sliceId })
      .from(schema.folderSlices)
      .where(eq(schema.folderSlices.folderId, folderId))

    if (sliceLinks.length === 0) {
      return res.status(400).json({ error: 'Folder is empty' })
    }

    const sliceIds = sliceLinks.map((s) => s.sliceId)

    // Get slice details
    const slices = await db
      .select()
      .from(schema.slices)
      .where(inArray(schema.slices.id, sliceIds))

    // Determine export directory
    const exportDir = exportPath || path.join(DATA_DIR, 'exports', folder[0].name.replace(/[^a-zA-Z0-9]/g, '_'))
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
    console.error('Error exporting folder:', error)
    res.status(500).json({ error: 'Failed to export folder' })
  }
})

// Create folder from tag (add all slices with a specific tag)
router.post('/folders/from-tag', async (req, res) => {
  const { tagId, name, color, collectionId } = req.body as { tagId: number; name?: string; color?: string; collectionId?: number }

  if (!tagId) {
    return res.status(400).json({ error: 'tagId is required' })
  }

  try {
    // Get tag info
    const tag = await db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.id, tagId))
      .limit(1)

    if (tag.length === 0) {
      return res.status(404).json({ error: 'Tag not found' })
    }

    // Create folder
    const [folder] = await db
      .insert(schema.folders)
      .values({
        name: name || `${tag[0].name} samples`,
        color: color || tag[0].color,
        collectionId: collectionId ?? null,
        createdAt: new Date().toISOString(),
      })
      .returning()

    // Get all slices with this tag
    const sliceIds = await db
      .select({ sliceId: schema.sliceTags.sliceId })
      .from(schema.sliceTags)
      .where(eq(schema.sliceTags.tagId, tagId))

    // Add slices to folder
    if (sliceIds.length > 0) {
      await db
        .insert(schema.folderSlices)
        .values(sliceIds.map(s => ({
          folderId: folder.id,
          sliceId: s.sliceId,
        })))
        .onConflictDoNothing()
    }

    res.json({ ...folder, sliceCount: sliceIds.length })
  } catch (error) {
    console.error('Error creating folder from tag:', error)
    res.status(500).json({ error: 'Failed to create folder from tag' })
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

// --- Sync Config Routes ---

// Get all sync configs
router.get('/sync-configs', async (_req, res) => {
  try {
    const configs = await getAllSyncConfigs()
    res.json(configs)
  } catch (error) {
    console.error('Error fetching sync configs:', error)
    res.status(500).json({ error: 'Failed to fetch sync configs' })
  }
})

// Create sync config
router.post('/sync-configs', async (req, res) => {
  const { tagId, folderId, direction } = req.body as {
    tagId: number
    folderId: number
    direction: 'tag-to-folder' | 'folder-to-tag' | 'bidirectional'
  }

  if (!tagId || !folderId || !direction) {
    return res.status(400).json({ error: 'tagId, folderId, and direction are required' })
  }

  try {
    const config = await createSyncLink(tagId, folderId, direction)
    res.json(config)
  } catch (error) {
    console.error('Error creating sync config:', error)
    res.status(500).json({ error: 'Failed to create sync config' })
  }
})

// Delete sync config
router.delete('/sync-configs/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    await removeSyncLink(id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting sync config:', error)
    res.status(500).json({ error: 'Failed to delete sync config' })
  }
})

export default router
