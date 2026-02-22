import { Router } from 'express'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { generatePeaks, getAudioDuration } from '../services/ffmpeg.js'
import { ensureDownloadTool } from '../services/downloadTools.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'

function isSoundCloudUrl(url: string): boolean {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    return parsed.hostname === 'soundcloud.com' || parsed.hostname === 'www.soundcloud.com'
  } catch {
    return false
  }
}

function isSoundCloudPlaylist(url: string): boolean {
  return url.includes('/sets/')
}

async function getSoundCloudInfo(
  url: string
): Promise<{ id: string; title: string; uploader: string; duration: number; thumbnail: string }> {
  await ensureDownloadTool('yt-dlp')

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ['--dump-json', '--no-download', '--no-playlist', url])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr}`))
        return
      }
      try {
        const info = JSON.parse(stdout)
        resolve({
          id: String(info.id),
          title: info.title,
          uploader: info.uploader || info.channel || '',
          duration: info.duration || 0,
          thumbnail: info.thumbnail || '',
        })
      } catch {
        reject(new Error('Failed to parse yt-dlp output'))
      }
    })
  })
}

async function getSoundCloudPlaylistUrls(playlistUrl: string): Promise<string[]> {
  await ensureDownloadTool('yt-dlp')

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', ['--flat-playlist', '-j', playlistUrl])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr}`))
        return
      }
      const urls: string[] = []
      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const item = JSON.parse(line)
          if (item.url) urls.push(item.url)
          else if (item.webpage_url) urls.push(item.webpage_url)
        } catch {}
      }
      resolve(urls)
    })
  })
}

async function downloadSoundCloudTrack(url: string, trackId: string): Promise<string> {
  await ensureDownloadTool('yt-dlp')

  const audioDir = path.join(DATA_DIR, 'audio')
  await fs.mkdir(audioDir, { recursive: true })

  const outputPath = path.join(audioDir, `sc_${trackId}.mp3`)

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '-o',
      outputPath,
      '--no-playlist',
      url,
    ])
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
      console.log('[yt-dlp SC]', d.toString().trim())
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed: ${stderr}`))
        return
      }
      resolve(outputPath)
    })
  })
}

// Import SoundCloud URLs (tracks or playlists)
router.post('/import', async (req, res) => {
  const { text } = req.body as { text: string }
  if (!text) return res.status(400).json({ error: 'Text required' })

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const trackUrls: string[] = []

  for (const line of lines) {
    if (!isSoundCloudUrl(line)) continue

    if (isSoundCloudPlaylist(line)) {
      try {
        const urls = await getSoundCloudPlaylistUrls(line)
        trackUrls.push(...urls)
      } catch (err) {
        console.error(`Failed to fetch SoundCloud playlist ${line}:`, err)
      }
    } else {
      trackUrls.push(line)
    }
  }

  const success: string[] = []
  const failed: { url: string; error: string }[] = []

  for (const url of trackUrls) {
    try {
      const info = await getSoundCloudInfo(url)
      const dbId = `sc_${info.id}`

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
        description: info.uploader,
        thumbnailUrl: info.thumbnail,
        duration: info.duration,
        status: 'pending',
        source: 'local',
        artist: info.uploader,
        createdAt: new Date().toISOString(),
      })

      success.push(info.title)

      processSoundCloudTrack(url, info.id, dbId).catch((err) => {
        console.error(`Failed to process SoundCloud track ${dbId}:`, err)
      })
    } catch (err) {
      failed.push({ url, error: String(err) })
    }
  }

  res.json({ success, failed })
})

async function processSoundCloudTrack(url: string, trackId: string, dbId: string) {
  const peaksDir = path.join(DATA_DIR, 'peaks')
  await fs.mkdir(peaksDir, { recursive: true })

  try {
    await db
      .update(schema.tracks)
      .set({ status: 'downloading' })
      .where(eq(schema.tracks.youtubeId, dbId))

    const audioPath = await downloadSoundCloudTrack(url, trackId)
    const duration = await getAudioDuration(audioPath)

    const peaksPath = path.join(peaksDir, `${dbId}.json`)
    await generatePeaks(audioPath, peaksPath)

    await db
      .update(schema.tracks)
      .set({ audioPath, peaksPath, duration, status: 'ready' })
      .where(eq(schema.tracks.youtubeId, dbId))

    console.log(`SoundCloud track ${dbId} is ready`)
  } catch (err) {
    console.error(`Error processing SoundCloud track ${dbId}:`, err)
    await db
      .update(schema.tracks)
      .set({ status: 'error' })
      .where(eq(schema.tracks.youtubeId, dbId))
  }
}

export default router
