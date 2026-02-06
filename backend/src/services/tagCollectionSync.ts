/**
 * Tag-Collection Auto-Sync Service
 * Keeps tags and collections in sync based on sync config rules.
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
 * Get all active sync configs for a given collection
 */
async function getSyncConfigsForCollection(collectionId: number) {
  return db
    .select()
    .from(schema.syncConfigs)
    .where(and(eq(schema.syncConfigs.collectionId, collectionId), eq(schema.syncConfigs.enabled, 1)))
}

/**
 * Called when a tag is added to a slice.
 * If a sync config exists (tag-to-collection or bidirectional), add the slice to the linked collection.
 */
export async function onTagAdded(sliceId: number, tagId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForTag(tagId)
    for (const config of configs) {
      if (config.syncDirection === 'tag-to-collection' || config.syncDirection === 'bidirectional') {
        await db
          .insert(schema.collectionSlices)
          .values({ collectionId: config.collectionId, sliceId })
          .onConflictDoNothing()
      }
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Called when a tag is removed from a slice.
 * If a sync config exists, remove the slice from the linked collection.
 */
export async function onTagRemoved(sliceId: number, tagId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForTag(tagId)
    for (const config of configs) {
      if (config.syncDirection === 'tag-to-collection' || config.syncDirection === 'bidirectional') {
        await db
          .delete(schema.collectionSlices)
          .where(
            and(
              eq(schema.collectionSlices.collectionId, config.collectionId),
              eq(schema.collectionSlices.sliceId, sliceId)
            )
          )
      }
    }
  } finally {
    isSyncing = false
  }
}

/**
 * Called when a slice is added to a collection.
 * If a sync config exists (collection-to-tag or bidirectional), apply the linked tag.
 */
export async function onCollectionSliceAdded(collectionId: number, sliceId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForCollection(collectionId)
    for (const config of configs) {
      if (config.syncDirection === 'collection-to-tag' || config.syncDirection === 'bidirectional') {
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
 * Called when a slice is removed from a collection.
 * If a sync config exists, remove the linked tag.
 */
export async function onCollectionSliceRemoved(collectionId: number, sliceId: number): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  try {
    const configs = await getSyncConfigsForCollection(collectionId)
    for (const config of configs) {
      if (config.syncDirection === 'collection-to-tag' || config.syncDirection === 'bidirectional') {
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
 * Create a new sync link between a tag and collection.
 * Performs initial sync based on direction.
 */
export async function createSyncLink(
  tagId: number,
  collectionId: number,
  direction: 'tag-to-collection' | 'collection-to-tag' | 'bidirectional'
) {
  const [config] = await db
    .insert(schema.syncConfigs)
    .values({
      tagId,
      collectionId,
      syncDirection: direction,
      enabled: 1,
      createdAt: new Date().toISOString(),
    })
    .returning()

  // Initial sync
  isSyncing = true
  try {
    if (direction === 'tag-to-collection' || direction === 'bidirectional') {
      // Get all slices with this tag and add them to the collection
      const taggedSlices = await db
        .select({ sliceId: schema.sliceTags.sliceId })
        .from(schema.sliceTags)
        .where(eq(schema.sliceTags.tagId, tagId))

      for (const { sliceId } of taggedSlices) {
        await db
          .insert(schema.collectionSlices)
          .values({ collectionId, sliceId })
          .onConflictDoNothing()
      }
    }

    if (direction === 'collection-to-tag' || direction === 'bidirectional') {
      // Get all slices in the collection and apply the tag
      const collectionSlices = await db
        .select({ sliceId: schema.collectionSlices.sliceId })
        .from(schema.collectionSlices)
        .where(eq(schema.collectionSlices.collectionId, collectionId))

      for (const { sliceId } of collectionSlices) {
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
