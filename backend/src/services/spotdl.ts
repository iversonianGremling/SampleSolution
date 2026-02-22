import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { ensureDownloadTool } from './downloadTools.js'

const DATA_DIR = process.env.DATA_DIR || './data'

export interface SpotifyTrackInfo {
  spotifyId: string
  title: string
  artist: string
  album: string
  duration: number
  thumbnailUrl: string
}

export function extractSpotifyTrackId(input: string): string | null {
  const patterns = [
    /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)/,
    /spotify:track:([a-zA-Z0-9]+)/,
  ]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function extractSpotifyPlaylistId(input: string): string | null {
  const patterns = [
    /open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]+)/,
    /spotify:playlist:([a-zA-Z0-9]+)/,
  ]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function extractSpotifyAlbumId(input: string): string | null {
  const patterns = [
    /open\.spotify\.com\/(?:intl-[a-z]+\/)?album\/([a-zA-Z0-9]+)/,
    /spotify:album:([a-zA-Z0-9]+)/,
  ]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match) return match[1]
  }
  return null
}

export async function getSpotifyTrackInfo(
  trackId: string,
  accessToken: string
): Promise<SpotifyTrackInfo> {
  const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Spotify API error: ${response.status}`)
  const data = (await response.json()) as any
  return {
    spotifyId: data.id,
    title: data.name,
    artist: data.artists.map((a: any) => a.name).join(', '),
    album: data.album.name,
    duration: data.duration_ms / 1000,
    thumbnailUrl: data.album.images[0]?.url || '',
  }
}

export async function getSpotifyPlaylistTracks(
  playlistId: string,
  accessToken: string
): Promise<SpotifyTrackInfo[]> {
  const tracks: SpotifyTrackInfo[] = []
  let url: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error(`Spotify API error: ${response.status}`)
    const data = (await response.json()) as any

    for (const item of data.items) {
      if (item.track && item.track.id) {
        tracks.push({
          spotifyId: item.track.id,
          title: item.track.name,
          artist: item.track.artists.map((a: any) => a.name).join(', '),
          album: item.track.album.name,
          duration: item.track.duration_ms / 1000,
          thumbnailUrl: item.track.album.images[0]?.url || '',
        })
      }
    }

    url = data.next
  }

  return tracks
}

export async function getSpotifyAlbumTracks(
  albumId: string,
  accessToken: string
): Promise<SpotifyTrackInfo[]> {
  const tracks: SpotifyTrackInfo[] = []
  // First get album info for thumbnail
  const albumRes = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!albumRes.ok) throw new Error(`Spotify API error: ${albumRes.status}`)
  const album = (await albumRes.json()) as any
  const thumbnailUrl = album.images[0]?.url || ''

  let url: string | null = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`
  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error(`Spotify API error: ${response.status}`)
    const data = (await response.json()) as any

    for (const item of data.items) {
      if (item.id) {
        tracks.push({
          spotifyId: item.id,
          title: item.name,
          artist: item.artists.map((a: any) => a.name).join(', '),
          album: album.name,
          duration: item.duration_ms / 1000,
          thumbnailUrl,
        })
      }
    }
    url = data.next
  }
  return tracks
}

export async function downloadSpotifyTrack(trackId: string): Promise<string> {
  await ensureDownloadTool('spotdl')

  const audioDir = path.join(DATA_DIR, 'audio')
  await fs.mkdir(audioDir, { recursive: true })

  const finalPath = path.join(audioDir, `spotify_${trackId}.mp3`)
  const tmpDir = path.join(audioDir, `_tmp_spotify_${trackId}`)
  await fs.mkdir(tmpDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const url = `https://open.spotify.com/track/${trackId}`
    const args = [
      'download',
      url,
      '--output',
      path.join(tmpDir, '{title}.{output-ext}'),
      '--format',
      'mp3',
      '--overwrite',
      'force',
      '--log-level',
      'WARNING',
    ]

    const proc = spawn('spotdl', args)
    let stderr = ''

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      console.log('[spotdl]', data.toString().trim())
    })
    proc.stdout.on('data', (data) => {
      console.log('[spotdl]', data.toString().trim())
    })

    proc.on('close', async (code) => {
      try {
        const files = await fs.readdir(tmpDir).catch(() => [])
        const mp3Files = files.filter((f) => f.endsWith('.mp3'))

        if (mp3Files.length === 0) {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
          reject(new Error(`spotdl download failed (code ${code}): ${stderr}`))
          return
        }

        await fs.rename(path.join(tmpDir, mp3Files[0]), finalPath)
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
        resolve(finalPath)
      } catch (err) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
        reject(err)
      }
    })
  })
}
