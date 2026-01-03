import { eq } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema } from '../db/index.js'
import { downloadAudio } from './ytdlp.js'
import { generatePeaks, getAudioDuration } from './ffmpeg.js'

const DATA_DIR = process.env.DATA_DIR || './data'

export async function processTrack(videoId: string): Promise<void> {
  const audioDir = path.join(DATA_DIR, 'audio')
  const peaksDir = path.join(DATA_DIR, 'peaks')

  await fs.mkdir(audioDir, { recursive: true })
  await fs.mkdir(peaksDir, { recursive: true })

  try {
    // Update status to downloading
    await db
      .update(schema.tracks)
      .set({ status: 'downloading' })
      .where(eq(schema.tracks.youtubeId, videoId))

    // Download audio
    console.log(`Downloading audio for ${videoId}...`)
    const audioPath = await downloadAudio(videoId, audioDir)

    // Get actual duration
    const duration = await getAudioDuration(audioPath)

    // Generate peaks
    console.log(`Generating peaks for ${videoId}...`)
    const peaksPath = path.join(peaksDir, `${videoId}.json`)
    await generatePeaks(audioPath, peaksPath)

    // Update track as ready
    await db
      .update(schema.tracks)
      .set({
        audioPath,
        peaksPath,
        duration,
        status: 'ready',
      })
      .where(eq(schema.tracks.youtubeId, videoId))

    console.log(`Track ${videoId} is ready`)
  } catch (error) {
    console.error(`Error processing track ${videoId}:`, error)
    await db
      .update(schema.tracks)
      .set({ status: 'error' })
      .where(eq(schema.tracks.youtubeId, videoId))
  }
}

// Process multiple tracks in parallel (with concurrency limit)
export async function processTracksParallel(
  videoIds: string[],
  concurrency: number = 3
): Promise<void> {
  const queue = [...videoIds]
  const processing = new Set<Promise<void>>()

  while (queue.length > 0 || processing.size > 0) {
    // Start new tasks up to concurrency limit
    while (queue.length > 0 && processing.size < concurrency) {
      const videoId = queue.shift()!
      const promise = processTrack(videoId).finally(() => {
        processing.delete(promise)
      })
      processing.add(promise)
    }

    // Wait for at least one to complete
    if (processing.size > 0) {
      await Promise.race(processing)
    }
  }
}
