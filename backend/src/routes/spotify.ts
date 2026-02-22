import { Router } from 'express'
import path from 'path'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import {
  extractSpotifyTrackId,
  extractSpotifyPlaylistId,
  extractSpotifyAlbumId,
  getSpotifyTrackInfo,
  getSpotifyPlaylistTracks,
  getSpotifyAlbumTracks,
  downloadSpotifyTrack,
} from '../services/spotdl.js'
import { generatePeaks, getAudioDuration } from '../services/ffmpeg.js'

const router = Router()

const DATA_DIR = process.env.DATA_DIR || './data'
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || ''
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || ''
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value || value.trim() === '') return fallback
  return TRUTHY.has(value.trim().toLowerCase())
}

const SPOTIFY_IMPORT_ENABLED = parseBooleanEnv(process.env.ENABLE_SPOTIFY_IMPORT, true)

if (!SPOTIFY_IMPORT_ENABLED) {
  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
}

async function getClientCredentialsToken(): Promise<string> {
  const credentials = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString('base64')
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok)
    throw new Error(`Failed to get Spotify client credentials token: ${response.status}`)
  const data = (await response.json()) as any
  return data.access_token
}

// Check Spotify configuration and auth status
router.get('/status', (req, res) => {
  const configured = !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET)
  const connected = !!req.session.spotifyTokens
  res.json({ configured, connected })
})

// Start Spotify OAuth flow
router.get('/auth', (req, res) => {
  if (!SPOTIFY_CLIENT_ID) {
    return res.status(500).json({ error: 'Spotify client ID not configured' })
  }
  const scope = 'playlist-read-private playlist-read-collaborative user-library-read'
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: `${BACKEND_URL}/api/spotify/callback`,
  })
  res.redirect(`https://accounts.spotify.com/authorize?${params}`)
})

// OAuth callback
router.get('/callback', async (req, res) => {
  const code = req.query.code as string

  if (!code) {
    return res.redirect(`${FRONTEND_URL}?spotify_error=auth_denied`)
  }

  try {
    const credentials = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    ).toString('base64')
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${BACKEND_URL}/api/spotify/callback`,
      }),
    })

    if (!response.ok) throw new Error('Token exchange failed')
    const tokens = (await response.json()) as any

    req.session.spotifyTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    }

    res.redirect(`${FRONTEND_URL}?spotify_connected=1`)
  } catch (error) {
    console.error('Spotify OAuth callback error:', error)
    res.redirect(`${FRONTEND_URL}?spotify_error=token_failed`)
  }
})

// Disconnect
router.post('/disconnect', (req, res) => {
  delete req.session.spotifyTokens
  res.json({ success: true })
})

// Get user playlists (requires OAuth)
router.get('/playlists', async (req, res) => {
  if (!req.session.spotifyTokens) {
    return res.status(401).json({ error: 'Not authenticated with Spotify' })
  }

  try {
    const token = req.session.spotifyTokens.access_token
    const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) throw new Error(`Spotify API error: ${response.status}`)
    const data = (await response.json()) as any

    res.json(
      data.items.map((p: any) => ({
        id: p.id,
        name: p.name,
        trackCount: p.tracks.total,
        thumbnailUrl: p.images[0]?.url || null,
      }))
    )
  } catch (error) {
    console.error('Spotify playlists error:', error)
    res.status(500).json({ error: 'Failed to fetch playlists' })
  }
})

// Import Spotify URLs (tracks, playlists, albums)
router.post('/import', async (req, res) => {
  const { text } = req.body as { text: string }
  if (!text) return res.status(400).json({ error: 'Text required' })

  let accessToken: string
  try {
    if (req.session.spotifyTokens) {
      accessToken = req.session.spotifyTokens.access_token
    } else {
      if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        return res
          .status(401)
          .json({ error: 'Spotify credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.' })
      }
      accessToken = await getClientCredentialsToken()
    }
  } catch (err) {
    return res.status(401).json({ error: 'Could not obtain Spotify access token' })
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const trackInfoMap = new Map<string, { title: string; artist: string; album: string; duration: number; thumbnailUrl: string }>()

  for (const line of lines) {
    const trackId = extractSpotifyTrackId(line)
    if (trackId) {
      try {
        const info = await getSpotifyTrackInfo(trackId, accessToken)
        trackInfoMap.set(trackId, info)
      } catch (err) {
        console.error(`Failed to get Spotify track info ${trackId}:`, err)
      }
      continue
    }

    const playlistId = extractSpotifyPlaylistId(line)
    if (playlistId) {
      try {
        const tracks = await getSpotifyPlaylistTracks(playlistId, accessToken)
        for (const t of tracks) {
          trackInfoMap.set(t.spotifyId, t)
        }
      } catch (err) {
        console.error(`Failed to fetch Spotify playlist ${playlistId}:`, err)
      }
      continue
    }

    const albumId = extractSpotifyAlbumId(line)
    if (albumId) {
      try {
        const tracks = await getSpotifyAlbumTracks(albumId, accessToken)
        for (const t of tracks) {
          trackInfoMap.set(t.spotifyId, t)
        }
      } catch (err) {
        console.error(`Failed to fetch Spotify album ${albumId}:`, err)
      }
    }
  }

  const success: string[] = []
  const failed: { url: string; error: string }[] = []

  for (const [trackId, info] of trackInfoMap) {
    const dbId = `spotify_${trackId}`

    try {
      const existing = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.youtubeId, dbId))
        .limit(1)

      if (existing.length > 0) {
        success.push(info.title)
        continue
      }

      await db.insert(schema.tracks).values({
        youtubeId: dbId,
        title: info.title,
        description: `${info.artist} — ${info.album}`,
        thumbnailUrl: info.thumbnailUrl,
        duration: info.duration,
        status: 'pending',
        source: 'local',
        artist: info.artist,
        album: info.album,
        createdAt: new Date().toISOString(),
      })

      success.push(info.title)

      processSpotifyTrack(trackId, dbId).catch((err) => {
        console.error(`Failed to process Spotify track ${dbId}:`, err)
      })
    } catch (err) {
      failed.push({ url: `spotify:track:${trackId}`, error: String(err) })
    }
  }

  res.json({ success, failed })
})

async function processSpotifyTrack(trackId: string, dbId: string) {
  const peaksDir = path.join(DATA_DIR, 'peaks')

  try {
    await db
      .update(schema.tracks)
      .set({ status: 'downloading' })
      .where(eq(schema.tracks.youtubeId, dbId))

    const audioPath = await downloadSpotifyTrack(trackId)
    const duration = await getAudioDuration(audioPath)

    const peaksPath = path.join(peaksDir, `${dbId}.json`)
    await generatePeaks(audioPath, peaksPath)

    await db
      .update(schema.tracks)
      .set({ audioPath, peaksPath, duration, status: 'ready' })
      .where(eq(schema.tracks.youtubeId, dbId))

    console.log(`Spotify track ${dbId} is ready`)
  } catch (err) {
    console.error(`Error processing Spotify track ${dbId}:`, err)
    await db
      .update(schema.tracks)
      .set({ status: 'error' })
      .where(eq(schema.tracks.youtubeId, dbId))
  }
}

export default router
