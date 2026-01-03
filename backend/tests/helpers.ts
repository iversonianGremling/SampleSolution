import { Express } from 'express'
import fs from 'fs'
import path from 'path'
import { getAppDb, TEST_DATA_DIR } from './setup.js'

export { TEST_DATA_DIR }

// Create a test track directly in the database
export async function createTestTrack(
  app: Express,
  data: Partial<{
    youtubeId: string
    title: string
    description: string
    thumbnailUrl: string
    duration: number
    status: string
  }> = {}
) {
  const trackData = {
    youtubeId: data.youtubeId || 'test-video-' + Date.now() + Math.random().toString(36).slice(2),
    title: data.title || 'Test Track',
    description: data.description || 'Test description',
    thumbnailUrl: data.thumbnailUrl || 'https://example.com/thumb.jpg',
    duration: data.duration || 180,
    status: data.status || 'ready',
  }

  const db = await getAppDb()

  const result = db.prepare(`
    INSERT INTO tracks (youtube_id, title, description, thumbnail_url, duration, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    trackData.youtubeId,
    trackData.title,
    trackData.description,
    trackData.thumbnailUrl,
    trackData.duration,
    trackData.status,
    new Date().toISOString()
  )

  return {
    id: result.lastInsertRowid as number,
    ...trackData,
  }
}

// Create a test track with audio file for slice testing
export async function createTestTrackWithAudio(app: Express) {
  const track = await createTestTrack(app, { status: 'ready' })

  // Create a dummy audio file
  const audioDir = path.join(TEST_DATA_DIR, 'audio')
  const audioPath = path.join(audioDir, `${track.youtubeId}.mp3`)

  // Create a minimal valid MP3 file (just headers, won't play but tests will work)
  const mp3Header = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, // MP3 frame header
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ])
  fs.writeFileSync(audioPath, mp3Header)

  // Create dummy peaks file
  const peaksDir = path.join(TEST_DATA_DIR, 'peaks')
  const peaksPath = path.join(peaksDir, `${track.youtubeId}.json`)
  fs.writeFileSync(peaksPath, JSON.stringify([0.5, 0.7, 0.3, 0.8, 0.4]))

  // Update track with file paths
  const db = await getAppDb()

  db.prepare(`
    UPDATE tracks SET audio_path = ?, peaks_path = ? WHERE id = ?
  `).run(audioPath, peaksPath, track.id)

  return {
    ...track,
    audioPath,
    peaksPath,
  }
}

// Create a test tag
export async function createTestTag(name: string = 'test-tag', color: string = '#ff0000') {
  const db = await getAppDb()

  const result = db.prepare(`
    INSERT INTO tags (name, color) VALUES (?, ?)
  `).run(name, color)

  return {
    id: result.lastInsertRowid as number,
    name,
    color,
  }
}

// Create a test slice
export async function createTestSlice(
  trackId: number,
  data: Partial<{
    name: string
    startTime: number
    endTime: number
  }> = {}
) {
  const sliceData = {
    name: data.name || 'Test Slice',
    startTime: data.startTime || 10,
    endTime: data.endTime || 20,
  }

  const db = await getAppDb()

  const result = db.prepare(`
    INSERT INTO slices (track_id, name, start_time, end_time, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    trackId,
    sliceData.name,
    sliceData.startTime,
    sliceData.endTime,
    new Date().toISOString()
  )

  return {
    id: result.lastInsertRowid as number,
    trackId,
    ...sliceData,
  }
}
