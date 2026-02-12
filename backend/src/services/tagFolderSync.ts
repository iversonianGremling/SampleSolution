/**
 * Tag-Folder Auto-Sync Service
 * Keeps tags and folders in sync based on sync config rules.
 */
import { db, schema } from '../db/index.js'
import { eq, and } from 'drizzle-orm'

let isSyncing = false

/**
 * Get all active sync configs for a given tag
 */
async function getSyncConfigsForTag(tagId: number) {
  return db
    .select()
    .from(schema.syncConfigs)
    .where(and(eq(schema.syncConfigs.tagId, tagId), eq(schema.syncConfigs.enabled, 1)))
}

/**
 * Get all active sync configs for a given folder
 */
async function getSyncConfigsForFolder(folderId: number) {
  return db
    .select()
    .from(schema.syncConfigs)
    .where(and(eq(schema.syncConfigs.folderId, folderId), eq(schema.syncConfigs.enabled, 1)))
}

/**
 * Called when a tag is added to a slice.
 * If a sync config exists (tag-to-folder or bidirectional), add the slice to the linked folder.
 */
export async function onTagAdded(sliceId: number, tagId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForTag(tagId)
    for (const config of configs) {
      if (config.syncDirection === 'tag-to-folder' || config.syncDirection === 'bidirectional') {
        await db
          .insert(schema.folderSlices)
          .values({ folderId: config.folderId, sliceId })
          .onConflictDoNothing()
      }
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Called when a tag is removed from a slice.
 * If a sync config exists, remove the slice from the linked folder.
 */
export async function onTagRemoved(sliceId: number, tagId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForTag(tagId)
    for (const config of configs) {
      if (config.syncDirection === 'tag-to-folder' || config.syncDirection === 'bidirectional') {
        await db
          .delete(schema.folderSlices)
          .where(
            and(
              eq(schema.folderSlices.folderId, config.folderId),
              eq(schema.folderSlices.sliceId, sliceId)
            )
          )
      }
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Called when a slice is added to a folder.
 * If a sync config exists (folder-to-tag or bidirectional), apply the linked tag.
 */
export async function onFolderSliceAdded(folderId: number, sliceId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForFolder(folderId)
    for (const config of configs) {
      if (config.syncDirection === 'folder-to-tag' || config.syncDirection === 'bidirectional') {
        await db
          .insert(schema.sliceTags)
          .values({ sliceId, tagId: config.tagId })
          .onConflictDoNothing()
      }
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Called when a slice is removed from a folder.
 * If a sync config exists, remove the linked tag.
 */
export async function onFolderSliceRemoved(folderId: number, sliceId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForFolder(folderId)
    for (const config of configs) {
      if (config.syncDirection === 'folder-to-tag' || config.syncDirection === 'bidirectional') {
        await db
          .delete(schema.sliceTags)
          .where(
            and(
              eq(schema.sliceTags.sliceId, sliceId),
              eq(schema.sliceTags.tagId, config.tagId)
            )
          )
      }
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Create a new sync link between a tag and folder.
 * Performs initial sync based on direction.
 */
export async function createSyncLink(
  tagId: number,
  folderId: number,
  direction: 'tag-to-folder' | 'folder-to-tag' | 'bidirectional'
) {
  const [config] = await db
    .insert(schema.syncConfigs)
    .values({
      tagId,
      folderId,
      syncDirection: direction,
      enabled: 1,
      createdAt: new Date().toISOString(),
    })
    .returning()

  // Initial sync
  isSyncing = true
  try {
    if (direction === 'tag-to-folder' || direction === 'bidirectional') {
      // Get all slices with this tag and add them to the folder
      const taggedSlices = await db
        .select({ sliceId: schema.sliceTags.sliceId })
        .from(schema.sliceTags)
        .where(eq(schema.sliceTags.tagId, tagId))

      for (const { sliceId } of taggedSlices) {
        await db
          .insert(schema.folderSlices)
          .values({ folderId, sliceId })
          .onConflictDoNothing()
      }
    }

    if (direction === 'folder-to-tag' || direction === 'bidirectional') {
      // Get all slices in the folder and apply the tag
      const folderSlices = await db
        .select({ sliceId: schema.folderSlices.sliceId })
        .from(schema.folderSlices)
        .where(eq(schema.folderSlices.folderId, folderId))

      for (const { sliceId } of folderSlices) {
        await db
          .insert(schema.sliceTags)
          .values({ sliceId, tagId })
          .onConflictDoNothing()
      }
    }
  } finally {
    isSyncing = false
  }

  return config
}

/**
 * Remove a sync link.
 */
export async function removeSyncLink(id: number): Promise<void> {
  await db.delete(schema.syncConfigs).where(eq(schema.syncConfigs.id, id))
}

/**
 * Get all sync configs.
 */
export async function getAllSyncConfigs() {
  return db.select().from(schema.syncConfigs)
}
