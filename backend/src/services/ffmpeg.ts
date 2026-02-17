import { spawn } from 'child_process'
import fs from 'fs/promises'

export interface AudioFileMetadata {
  sampleRate: number | null
  channels: number | null
  format: string | null
  modifiedAt: string | null
  createdAt: string | null
  artist: string | null
  album: string | null
  year: number | null
}

function parseYear(rawValue: unknown): number | null {
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return null
  }

  const asString = String(rawValue).trim()
  if (!asString) return null

  const match = asString.match(/\b(19|20)\d{2}\b/)
  if (!match) return null

  const year = Number.parseInt(match[0], 10)
  return Number.isInteger(year) ? year : null
}

function normalizeDate(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return null
  }

  const value = String(rawValue).trim()
  if (!value) return null

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function isLikelyValidBirthtime(date: Date): boolean {
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return false
  // Some filesystems report Unix epoch for unavailable birthtime.
  return ms > Date.parse('1971-01-01T00:00:00.000Z')
}

export async function extractSlice(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const duration = endTime - startTime
    const args = [
      '-i', inputPath,
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-acodec', 'libmp3lame',
      '-q:a', '2', // High quality
      '-y', // Overwrite output
      outputPath,
    ]

    const proc = spawn('ffmpeg', args)
    let stderr = ''

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg slice failed: ${stderr}`))
        return
      }
      resolve(outputPath)
    })
  })
}

export async function generatePeaks(
  inputPath: string,
  outputPath: string,
  numPeaks: number = 800
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    // Get audio duration first
    const probeArgs = [
      '-i', inputPath,
      '-show_entries', 'format=duration',
      '-v', 'quiet',
      '-of', 'csv=p=0',
    ]

    const probe = spawn('ffprobe', probeArgs)
    let duration = ''

    probe.stdout.on('data', (data) => {
      duration += data.toString()
    })

    probe.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Failed to probe audio duration'))
        return
      }

      const durationSec = parseFloat(duration.trim())
      const samplesPerPeak = Math.floor((durationSec * 44100) / numPeaks)

      // Extract raw audio data and compute peaks
      const args = [
        '-i', inputPath,
        '-ac', '1', // Mono
        '-ar', '44100', // 44.1kHz
        '-f', 's16le', // Raw PCM
        '-',
      ]

      const proc = spawn('ffmpeg', args)
      const chunks: Buffer[] = []

      proc.stdout.on('data', (data) => {
        chunks.push(data)
      })

      proc.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error('Failed to extract audio for peaks'))
          return
        }

        const buffer = Buffer.concat(chunks)
        const samples = new Int16Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.length / 2
        )

        const peaks: number[] = []
        for (let i = 0; i < numPeaks; i++) {
          const start = i * samplesPerPeak
          const end = Math.min(start + samplesPerPeak, samples.length)
          let max = 0
          for (let j = start; j < end; j++) {
            const abs = Math.abs(samples[j])
            if (abs > max) max = abs
          }
          peaks.push(max / 32768) // Normalize to 0-1
        }

        // Save peaks to file
        await fs.writeFile(outputPath, JSON.stringify(peaks))
        resolve(peaks)
      })
    })
  })
}

export async function getAudioDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-show_entries', 'format=duration',
      '-v', 'quiet',
      '-of', 'csv=p=0',
    ]

    const proc = spawn('ffprobe', args)
    let stdout = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to get audio duration'))
        return
      }
      resolve(parseFloat(stdout.trim()))
    })
  })
}

export async function getAudioFileMetadata(inputPath: string): Promise<AudioFileMetadata> {
  const probeOutput = await new Promise<string>((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-print_format', 'json',
      inputPath,
    ]

    const proc = spawn('ffprobe', args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || 'Failed to probe audio metadata'))
        return
      }
      resolve(stdout)
    })
  })

  let parsed: any = {}
  try {
    parsed = JSON.parse(probeOutput)
  } catch {
    parsed = {}
  }

  const audioStream = Array.isArray(parsed?.streams)
    ? parsed.streams.find((stream: any) => stream?.codec_type === 'audio') ?? parsed.streams[0]
    : null

  const streamTags = audioStream?.tags && typeof audioStream.tags === 'object' ? audioStream.tags : {}
  const formatTags = parsed?.format?.tags && typeof parsed.format.tags === 'object'
    ? parsed.format.tags
    : {}

  const sampleRateRaw = audioStream?.sample_rate
  const channelsRaw = audioStream?.channels
  const rawFormat = parsed?.format?.format_name

  const sampleRate = Number.isFinite(Number(sampleRateRaw)) ? Number(sampleRateRaw) : null
  const channels = Number.isFinite(Number(channelsRaw)) ? Number(channelsRaw) : null
  const format = typeof rawFormat === 'string' && rawFormat.trim()
    ? rawFormat.split(',')[0].trim().toLowerCase()
    : null

  const artist = (
    streamTags.artist ??
    formatTags.artist ??
    streamTags.ARTIST ??
    formatTags.ARTIST ??
    null
  )
  const album = (
    streamTags.album ??
    formatTags.album ??
    streamTags.ALBUM ??
    formatTags.ALBUM ??
    null
  )

  const year = parseYear(
    streamTags.date ??
    formatTags.date ??
    streamTags.creation_time ??
    formatTags.creation_time ??
    streamTags.year ??
    formatTags.year
  )

  let modifiedAt: string | null = null
  let filesystemCreatedAt: string | null = null
  try {
    const stats = await fs.stat(inputPath)
    modifiedAt = stats.mtime.toISOString()
    if (stats.birthtime instanceof Date && isLikelyValidBirthtime(stats.birthtime)) {
      filesystemCreatedAt = stats.birthtime.toISOString()
    }
  } catch {
    modifiedAt = null
    filesystemCreatedAt = null
  }

  const metadataCreatedAt =
    normalizeDate(streamTags.creation_time) ??
    normalizeDate(formatTags.creation_time) ??
    normalizeDate(streamTags.encoded_date) ??
    normalizeDate(formatTags.encoded_date)

  return {
    sampleRate,
    channels,
    format,
    modifiedAt,
    createdAt: metadataCreatedAt ?? filesystemCreatedAt,
    artist: typeof artist === 'string' ? artist.trim() || null : null,
    album: typeof album === 'string' ? album.trim() || null : null,
    year,
  }
}
