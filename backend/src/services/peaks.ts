import fs from 'fs/promises'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { generatePeaks } from './ffmpeg.js'

const TRACK_PEAKS_MAGIC = Buffer.from('SPK1')
const TRACK_PEAKS_HEADER_BYTES = 8
const TRACK_PEAKS_EXTENSION = '.peaks.bin'
const LEGACY_TRACK_PEAKS_EXTENSION = '.json'

export const DEFAULT_TRACK_PEAK_COUNT = 800

interface TrackPeaksRecord {
  id: number
  youtubeId: string
  audioPath: string | null
  peaksPath: string | null
}

function sanitizeTrackPeaksKey(trackKey: string): string {
  return trackKey.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function clampPeakValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function isPeaksNotFoundError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PEAKS_NOT_FOUND'
}

function buildTrackPeaksPathWithExtension(dataDir: string, trackKey: string, extension: string): string {
  return path.join(dataDir, 'peaks', `${sanitizeTrackPeaksKey(trackKey)}${extension}`)
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of paths) {
    if (!candidate) continue
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    result.push(candidate)
  }
  return result
}

function createPeaksNotFoundError(): Error & { code: 'PEAKS_NOT_FOUND' } {
  const error = new Error('Peaks not found') as Error & { code: 'PEAKS_NOT_FOUND' }
  error.code = 'PEAKS_NOT_FOUND'
  return error
}

export async function writeTrackPeaksCache(filePath: string, peaks: number[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const peakCount = peaks.length
  const buffer = Buffer.alloc(TRACK_PEAKS_HEADER_BYTES + peakCount)

  TRACK_PEAKS_MAGIC.copy(buffer, 0)
  buffer.writeUInt32LE(peakCount, 4)

  for (let index = 0; index < peakCount; index += 1) {
    buffer[TRACK_PEAKS_HEADER_BYTES + index] = Math.round(clampPeakValue(peaks[index]) * 255)
  }

  await fs.writeFile(filePath, buffer)
}

function decodeTrackPeaksBinary(buffer: Buffer): number[] {
  if (buffer.length < TRACK_PEAKS_HEADER_BYTES) {
    throw new Error('Invalid peaks cache header')
  }

  if (!buffer.subarray(0, TRACK_PEAKS_MAGIC.length).equals(TRACK_PEAKS_MAGIC)) {
    throw new Error('Invalid peaks cache format')
  }

  const peakCount = buffer.readUInt32LE(4)
  if (buffer.length !== TRACK_PEAKS_HEADER_BYTES + peakCount) {
    throw new Error('Invalid peaks cache length')
  }

  const peaks = new Array<number>(peakCount)
  for (let index = 0; index < peakCount; index += 1) {
    peaks[index] = buffer[TRACK_PEAKS_HEADER_BYTES + index] / 255
  }
  return peaks
}

async function readLegacyTrackPeaksJson(filePath: string): Promise<number[]> {
  const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'))
  if (!Array.isArray(raw)) {
    throw new Error('Invalid peaks JSON format')
  }
  return raw.map((value) => clampPeakValue(Number(value)))
}

async function readTrackPeaksCache(filePath: string): Promise<number[]> {
  if (path.extname(filePath).toLowerCase() === LEGACY_TRACK_PEAKS_EXTENSION) {
    return readLegacyTrackPeaksJson(filePath)
  }

  const buffer = await fs.readFile(filePath)
  return decodeTrackPeaksBinary(buffer)
}

async function removePaths(paths: Array<string | null | undefined>): Promise<void> {
  for (const filePath of uniquePaths(paths)) {
    await fs.unlink(filePath).catch(() => {})
  }
}

async function persistTrackPeaksPath(trackId: number, peaksPath: string): Promise<void> {
  await db
    .update(schema.tracks)
    .set({ peaksPath })
    .where(eq(schema.tracks.id, trackId))
}

export function getTrackPeaksCachePath(dataDir: string, trackKey: string): string {
  return buildTrackPeaksPathWithExtension(dataDir, trackKey, TRACK_PEAKS_EXTENSION)
}

export function getLegacyTrackPeaksCachePath(dataDir: string, trackKey: string): string {
  return buildTrackPeaksPathWithExtension(dataDir, trackKey, LEGACY_TRACK_PEAKS_EXTENSION)
}

export function getTrackPeaksArtifactPaths(
  dataDir: string,
  trackKey: string,
  peaksPath?: string | null
): string[] {
  return uniquePaths([
    peaksPath,
    getTrackPeaksCachePath(dataDir, trackKey),
    getLegacyTrackPeaksCachePath(dataDir, trackKey),
  ])
}

export async function generateAndStoreTrackPeaks(
  audioPath: string,
  dataDir: string,
  trackKey: string,
  numPeaks: number = DEFAULT_TRACK_PEAK_COUNT
): Promise<string> {
  const peaks = await generatePeaks(audioPath, null, numPeaks)
  const peaksPath = getTrackPeaksCachePath(dataDir, trackKey)
  await writeTrackPeaksCache(peaksPath, peaks)
  return peaksPath
}

export async function ensureTrackPeaks(
  track: TrackPeaksRecord,
  dataDir: string
): Promise<{ peaks: number[]; peaksPath: string }> {
  const canonicalPath = getTrackPeaksCachePath(dataDir, track.youtubeId)
  const legacyPath = getLegacyTrackPeaksCachePath(dataDir, track.youtubeId)
  const candidatePaths = getTrackPeaksArtifactPaths(dataDir, track.youtubeId, track.peaksPath)

  for (const candidatePath of candidatePaths) {
    try {
      const peaks = await readTrackPeaksCache(candidatePath)

      if (candidatePath !== canonicalPath) {
        await writeTrackPeaksCache(canonicalPath, peaks)
      }

      if (track.peaksPath !== canonicalPath) {
        await persistTrackPeaksPath(track.id, canonicalPath)
      }

      if (candidatePath !== canonicalPath || track.peaksPath === legacyPath) {
        await removePaths(
          uniquePaths([track.peaksPath, legacyPath]).filter(
            (filePath) => path.resolve(filePath) !== path.resolve(canonicalPath)
          )
        )
      }

      return { peaks, peaksPath: canonicalPath }
    } catch (error) {
      const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
      if (code === 'ENOENT' || isPeaksNotFoundError(error)) {
        continue
      }
      if (track.audioPath) {
        console.warn(`Discarding unreadable peaks cache for ${track.youtubeId}:`, error)
        break
      }
      throw error
    }
  }

  if (!track.audioPath) {
    throw createPeaksNotFoundError()
  }

  const peaksPath = await generateAndStoreTrackPeaks(track.audioPath, dataDir, track.youtubeId)
  if (track.peaksPath !== peaksPath) {
    await persistTrackPeaksPath(track.id, peaksPath)
  }
  await removePaths(
    uniquePaths([track.peaksPath, legacyPath]).filter(
      (filePath) => path.resolve(filePath) !== path.resolve(peaksPath)
    )
  )

  const peaks = await readTrackPeaksCache(peaksPath)
  return { peaks, peaksPath }
}

export async function pruneOrphanedTrackPeaks(dataDir: string): Promise<string[]> {
  const peaksDir = path.join(dataDir, 'peaks')
  let entries: string[]

  try {
    entries = await fs.readdir(peaksDir)
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') return []
    throw error
  }

  const tracks = await db
    .select({
      youtubeId: schema.tracks.youtubeId,
      peaksPath: schema.tracks.peaksPath,
    })
    .from(schema.tracks)

  const allowedPaths = new Set<string>()
  for (const track of tracks) {
    allowedPaths.add(path.resolve(getTrackPeaksCachePath(dataDir, track.youtubeId)))
    if (track.peaksPath) {
      allowedPaths.add(path.resolve(track.peaksPath))
    }
  }

  const deleted: string[] = []
  for (const entry of entries) {
    const filePath = path.join(peaksDir, entry)
    const resolved = path.resolve(filePath)
    if (allowedPaths.has(resolved)) continue
    if (!entry.endsWith(TRACK_PEAKS_EXTENSION) && !entry.endsWith(LEGACY_TRACK_PEAKS_EXTENSION)) continue
    await fs.unlink(filePath).catch(() => {})
    deleted.push(filePath)
  }

  return deleted
}
