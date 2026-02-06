import { Router } from 'express'
import { eq, inArray, isNull, isNotNull, and, sql } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema } from '../db/index.js'
import { getVideoInfo, extractVideoId } from '../services/ytdlp.js'
import { processTrack } from '../services/processor.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

// Types for source tree
interface YouTubeSourceNode {
  id: number
  title: string
  thumbnailUrl: string
  sliceCount: number
}

interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
  sampleCount: number
}

interface SourceTree {
  youtube: YouTubeSourceNode[]
  local: { count: number }
  folders: FolderNode[]
}

// Helper function to build folder tree from flat list of paths
function buildFolderTree(
  folderCounts: Map<string, number>
): FolderNode[] {
  const rootFolders: FolderNode[] = []
  const folderMap = new Map<string, FolderNode>()

  // Sort paths by length to process parents before children
  const sortedPaths = Array.from(folderCounts.keys()).sort((a, b) => a.length - b.length)

  for (const folderPath of sortedPaths) {
    const count = folderCounts.get(folderPath) || 0
    const node: FolderNode = {
      path: folderPath,
      name: path.basename(folderPath) || folderPath,
      children: [],
      sampleCount: count,
    }
    folderMap.set(folderPath, node)

    // Find parent folder
    const parentPath = path.dirname(folderPath)
    const parent = folderMap.get(parentPath)

    if (parent) {
      parent.children.push(node)
      // Add this folder's count to parent's total
      parent.sampleCount += count
    } else {
      rootFolders.push(node)
    }
  }

  return rootFolders
}

// GET /api/sources/tree - Returns hierarchical source tree
router.get('/sources/tree', async (_req, res) => {
  try {
    // Get YouTube tracks with slice counts
    const youtubeTracks = await db
      .select({
        id: schema.tracks.id,
        title: schema.tracks.title,
        thumbnailUrl: schema.tracks.thumbnailUrl,
      })
      .from(schema.tracks)
      .where(eq(schema.tracks.source, 'youtube'))
      .orderBy(schema.tracks.createdAt)

    // Get slice counts for each YouTube track
    const youtubeTrackIds = youtubeTracks.map(t => t.id)
    const sliceCounts = youtubeTrackIds.length > 0
      ? await db
          .select({
            trackId: schema.slices.trackId,
            count: sql<number>`count(*)`.as('count'),
          })
          .from(schema.slices)
          .where(inArray(schema.slices.trackId, youtubeTrackIds))
          .groupBy(schema.slices.trackId)
      : []

    const sliceCountMap = new Map(sliceCounts.map(s => [s.trackId, Number(s.count)]))

    const youtube: YouTubeSourceNode[] = youtubeTracks.map(t => ({
      id: t.id,
      title: t.title,
      thumbnailUrl: t.thumbnailUrl,
      sliceCount: sliceCountMap.get(t.id) || 0,
    }))

    // Get local samples count (individual imports without folderPath)
    const localCountResult = await db
      .select({ count: sql<number>`count(*)`.as('count') })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(and(
        eq(schema.tracks.source, 'local'),
        isNull(schema.tracks.folderPath)
      ))

    const localCount = Number(localCountResult[0]?.count || 0)

    // Get folder paths with sample counts
    const folderResults = await db
      .select({
        folderPath: schema.tracks.folderPath,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(and(
        eq(schema.tracks.source, 'local'),
        isNotNull(schema.tracks.folderPath)
      ))
      .groupBy(schema.tracks.folderPath)

    const folderCounts = new Map<string, number>()
    for (const row of folderResults) {
      if (row.folderPath) {
        folderCounts.set(row.folderPath, Number(row.count))
      }
    }

    const folders = buildFolderTree(folderCounts)

    const tree: SourceTree = {
      youtube,
      local: { count: localCount },
      folders,
    }

    res.json(tree)
  } catch (error) {
    console.error('Error fetching sources tree:', error)
    res.status(500).json({ error: 'Failed to fetch sources tree' })
  }
})

// Get all tracks with their tags
router.get('/', async (req, res) => {
  try {
    const tracks = await db.select().from(schema.tracks).orderBy(schema.tracks.createdAt)

    // Get tags for each track
    const trackIds = tracks.map((t) => t.id)
    const trackTagsResult =
      trackIds.length > 0
        ? await db
            .select()
            .from(schema.trackTags)
            .innerJoin(schema.tags, eq(schema.trackTags.tagId, schema.tags.id))
            .where(inArray(schema.trackTags.trackId, trackIds))
        : []

    const tagsByTrack = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of trackTagsResult) {
      const trackId = row.track_tags.trackId
      if (!tagsByTrack.has(trackId)) {
        tagsByTrack.set(trackId, [])
      }
      tagsByTrack.get(trackId)!.push(row.tags)
    }

    const result = tracks.map((track) => ({
      ...track,
      tags: tagsByTrack.get(track.id) || [],
    }))

    res.json(result)
  } catch (error) {
    console.error('Error fetching tracks:', error)
    res.status(500).json({ error: 'Failed to fetch tracks' })
  }
})

// Add tracks by URLs
router.post('/', async (req, res) => {
  const { urls } = req.body as { urls: string[] }

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs array required' })
  }

  const success: string[] = []
  const failed: { url: string; error: string }[] = []

  for (const url of urls) {
    try {
      const videoId = extractVideoId(url)
      if (!videoId) {
        failed.push({ url, error: 'Invalid YouTube URL or video ID' })
        continue
      }

      // Check if already exists
      const existing = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.youtubeId, videoId))
        .limit(1)

      if (existing.length > 0) {
        success.push(videoId) // Already exists, count as success
        continue
      }

      // Get video info
      const info = await getVideoInfo(videoId)

      // Insert track
      await db.insert(schema.tracks).values({
        youtubeId: videoId,
        title: info.title,
        description: info.description,
        thumbnailUrl: info.thumbnailUrl,
        duration: info.duration,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })

      success.push(videoId)

      // Start download in background
      processTrack(videoId).catch((err) => {
        console.error(`Failed to process track ${videoId}:`, err)
      })
    } catch (error) {
      failed.push({ url, error: String(error) })
    }
  }

  res.json({ success, failed })
})

// Update track
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const { title, artist, album } = req.body as { title?: string; artist?: string; album?: string }

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }

    const updates: Partial<typeof schema.tracks.$inferSelect> = {}
    if (title !== undefined) updates.title = title
    if (artist !== undefined) updates.artist = artist
    if (album !== undefined) updates.album = album

    const [updated] = await db
      .update(schema.tracks)
      .set(updates)
      .where(eq(schema.tracks.id, id))
      .returning()

    res.json(updated)
  } catch (error) {
    console.error('Error updating track:', error)
    res.status(500).json({ error: 'Failed to update track' })
  }
})

// Delete track
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }

    // Delete audio files
    if (track[0].audioPath) {
      await fs.unlink(track[0].audioPath).catch(() => {})
    }
    if (track[0].peaksPath) {
      await fs.unlink(track[0].peaksPath).catch(() => {})
    }

    // Delete slices and their files
    const slices = await db
      .select()
      .from(schema.slices)
      .where(eq(schema.slices.trackId, id))

    for (const slice of slices) {
      if (slice.filePath) {
        await fs.unlink(slice.filePath).catch(() => {})
      }
    }

    await db.delete(schema.tracks).where(eq(schema.tracks.id, id))

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting track:', error)
    res.status(500).json({ error: 'Failed to delete track' })
  }
})

// Stream audio file
router.get('/:id/audio', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0 || !track[0].audioPath) {
      return res.status(404).json({ error: 'Audio not found' })
    }

    res.sendFile(path.resolve(track[0].audioPath))
  } catch (error) {
    console.error('Error streaming audio:', error)
    res.status(500).json({ error: 'Failed to stream audio' })
  }
})

// Get waveform peaks
router.get('/:id/peaks', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0 || !track[0].peaksPath) {
      return res.status(404).json({ error: 'Peaks not found' })
    }

    const peaks = JSON.parse(await fs.readFile(track[0].peaksPath, 'utf-8'))
    res.json(peaks)
  } catch (error) {
    console.error('Error fetching peaks:', error)
    res.status(500).json({ error: 'Failed to fetch peaks' })
  }
})

export default router
