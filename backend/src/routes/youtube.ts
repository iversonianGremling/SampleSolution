import { Router } from 'express'
import {
  searchYouTube,
  getUserPlaylists,
  getPlaylistItems,
  createOAuth2Client,
} from '../services/youtube-api.js'
import { extractVideoId, extractPlaylistId, getVideoInfo } from '../services/ytdlp.js'
import { processTrack } from '../services/processor.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

const router = Router()

// Search YouTube
router.get('/search', async (req, res) => {
  const query = req.query.q as string

  if (!query) {
    return res.status(400).json({ error: 'Query required' })
  }

  try {
    const results = await searchYouTube(query)
    res.json(results)
  } catch (error) {
    console.error('YouTube search error:', error)
    res.status(500).json({ error: 'Search failed' })
  }
})

// Get user playlists (requires auth)
router.get('/playlists', async (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  try {
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials(req.session.tokens)

    const playlists = await getUserPlaylists(oauth2Client)
    res.json(playlists)
  } catch (error) {
    console.error('Playlist fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch playlists' })
  }
})

// Get playlist items
router.get('/playlist/:id', async (req, res) => {
  const playlistId = req.params.id

  try {
    let oauth2Client = undefined
    if (req.session.tokens) {
      oauth2Client = createOAuth2Client()
      oauth2Client.setCredentials(req.session.tokens)
    }

    const items = await getPlaylistItems(playlistId, oauth2Client)
    res.json(items)
  } catch (error) {
    console.error('Playlist items error:', error)
    res.status(500).json({ error: 'Failed to fetch playlist items' })
  }
})

// Import from text (URLs, IDs, CSV, etc.)
router.post('/import', async (req, res) => {
  const { text } = req.body as { text: string }

  if (!text) {
    return res.status(400).json({ error: 'Text required' })
  }

  const lines = text.split('\n').filter((line) => line.trim())
  const videoIds = new Set<string>()
  const playlistIds = new Set<string>()

  // Parse each line
  for (const line of lines) {
    // Skip header lines (CSV)
    if (line.toLowerCase().includes('video id') || line.toLowerCase().includes('playlist')) {
      continue
    }

    // Try to extract video ID
    const videoId = extractVideoId(line.trim())
    if (videoId) {
      videoIds.add(videoId)
      continue
    }

    // Try to extract playlist ID
    const playlistId = extractPlaylistId(line.trim())
    if (playlistId) {
      playlistIds.add(playlistId)
      continue
    }

    // Try CSV format: videoId,timestamp or videoId,title,etc
    const parts = line.split(',')
    if (parts.length >= 1) {
      const possibleId = extractVideoId(parts[0].trim())
      if (possibleId) {
        videoIds.add(possibleId)
      }
    }
  }

  // Fetch videos from playlists
  for (const playlistId of playlistIds) {
    try {
      let oauth2Client = undefined
      if (req.session.tokens) {
        oauth2Client = createOAuth2Client()
        oauth2Client.setCredentials(req.session.tokens)
      }

      const items = await getPlaylistItems(playlistId, oauth2Client)
      for (const item of items) {
        videoIds.add(item.videoId)
      }
    } catch (error) {
      console.error(`Failed to fetch playlist ${playlistId}:`, error)
    }
  }

  // Import all video IDs
  const success: string[] = []
  const failed: { url: string; error: string }[] = []

  for (const videoId of videoIds) {
    try {
      // Check if already exists
      const existing = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.youtubeId, videoId))
        .limit(1)

      if (existing.length > 0) {
        success.push(videoId)
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

      // Start background processing
      processTrack(videoId).catch((err) => {
        console.error(`Failed to process track ${videoId}:`, err)
      })
    } catch (error) {
      failed.push({ url: videoId, error: String(error) })
    }
  }

  res.json({ success, failed })
})

export default router
