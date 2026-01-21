import { Router } from 'express'
import { eq, inArray } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema } from '../db/index.js'
import { getVideoInfo, extractVideoId } from '../services/ytdlp.js'
import { processTrack } from '../services/processor.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

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
  const { title } = req.body as { title?: string }

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
