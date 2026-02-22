import { spawn } from 'child_process'
import fs from 'fs/promises'

export type AudioConversionFormat = 'mp3' | 'wav' | 'flac' | 'aiff' | 'ogg' | 'm4a'

export interface AudioFileMetadata {
  sampleRate: number | null
  channels: number | null
  format: string | null
  modifiedAt: string | null
  createdAt: string | null
  title: string | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  composer: string | null
  trackNumber: number | null
  discNumber: number | null
  trackComment: string | null
  musicalKey: string | null
  tagBpm: number | null
  isrc: string | null
  year: number | null
  metadataRaw: string | null
}

type TagMap = Record<string, unknown>

function normalizeText(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return null
  }

  const value = String(rawValue).trim()
  return value || null
}

function parseYear(rawValue: unknown): number | null {
  const asString = normalizeText(rawValue)
  if (!asString) return null

  const match = asString.match(/\b(19|20)\d{2}\b/)
  if (!match) return null

  const year = Number.parseInt(match[0], 10)
  return Number.isInteger(year) ? year : null
}

function parsePositiveInteger(rawValue: unknown): number | null {
  const asString = normalizeText(rawValue)
  if (!asString) return null

  const match = asString.match(/\d+/)
  if (!match) return null

  const value = Number.parseInt(match[0], 10)
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

function parseBpm(rawValue: unknown): number | null {
  const asString = normalizeText(rawValue)
  if (!asString) return null

  const match = asString.replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null

  const bpm = Number.parseFloat(match[0])
  if (!Number.isFinite(bpm) || bpm <= 0) return null
  return bpm
}

function normalizeDate(rawValue: unknown): string | null {
  const value = normalizeText(rawValue)
  if (!value) return null

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function normalizeTagMap(rawTags: unknown): TagMap {
  if (!rawTags || typeof rawTags !== 'object' || Array.isArray(rawTags)) {
    return {}
  }

  const normalized: TagMap = {}
  for (const [key, value] of Object.entries(rawTags as Record<string, unknown>)) {
    const normalizedKey = key.trim().toLowerCase()
    if (!normalizedKey) continue
    normalized[normalizedKey] = value
  }
  return normalized
}

function firstTagValue(tagMaps: TagMap[], keys: string[]): unknown {
  for (const tagMap of tagMaps) {
    for (const key of keys) {
      if (!(key in tagMap)) continue
      const value = tagMap[key]
      if (typeof value === 'string') {
        if (value.trim()) return value
        continue
      }
      if (typeof value === 'number') {
        return value
      }
    }
  }
  return null
}

function isLikelyValidBirthtime(date: Date): boolean {
  const ms = date.getTime()
  if (!Number.isFinite(ms)) return false
  // Some filesystems report Unix epoch for unavailable birthtime.
  return ms > Date.parse('1971-01-01T00:00:00.000Z')
}

function getConversionArgs(targetFormat: AudioConversionFormat): string[] {
  switch (targetFormat) {
    case 'mp3':
      return ['-acodec', 'libmp3lame', '-q:a', '2']
    case 'wav':
      return ['-acodec', 'pcm_s16le']
    case 'flac':
      return ['-acodec', 'flac']
    case 'aiff':
      return ['-acodec', 'pcm_s16be']
    case 'ogg':
      return ['-acodec', 'libvorbis', '-q:a', '5']
    case 'm4a':
      return ['-acodec', 'aac', '-b:a', '256k']
    default: {
      const neverFormat: never = targetFormat
      throw new Error(`Unsupported conversion format: ${String(neverFormat)}`)
    }
  }
}

export async function convertAudioFile(
  inputPath: string,
  outputPath: string,
  targetFormat: AudioConversionFormat
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vn',
      ...getConversionArgs(targetFormat),
      '-y',
      outputPath,
    ]

    const proc = spawn('ffmpeg', args)
    let stderr = ''

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('error', (error) => {
      reject(error)
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg convert failed: ${stderr}`))
        return
      }
      resolve(outputPath)
    })
  })
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

  const streamTags = normalizeTagMap(audioStream?.tags)
  const formatTags = normalizeTagMap(parsed?.format?.tags)
  const tagMaps: TagMap[] = [streamTags, formatTags]

  const sampleRateRaw = audioStream?.sample_rate
  const channelsRaw = audioStream?.channels
  const rawFormat = parsed?.format?.format_name

  const sampleRate = Number.isFinite(Number(sampleRateRaw)) ? Number(sampleRateRaw) : null
  const channels = Number.isFinite(Number(channelsRaw)) ? Number(channelsRaw) : null
  const format = typeof rawFormat === 'string' && rawFormat.trim()
    ? rawFormat.split(',')[0].trim().toLowerCase()
    : null

  const title = normalizeText(firstTagValue(tagMaps, ['title']))
  const artist = normalizeText(firstTagValue(tagMaps, ['artist']))
  const album = normalizeText(firstTagValue(tagMaps, ['album']))
  const albumArtist = normalizeText(
    firstTagValue(tagMaps, ['album_artist', 'albumartist', 'album artist'])
  )
  const genre = normalizeText(firstTagValue(tagMaps, ['genre']))
  const composer = normalizeText(firstTagValue(tagMaps, ['composer']))
  const trackNumber = parsePositiveInteger(
    firstTagValue(tagMaps, ['track', 'tracknumber', 'track_number'])
  )
  const discNumber = parsePositiveInteger(
    firstTagValue(tagMaps, ['disc', 'discnumber', 'disc_number'])
  )
  const trackComment = normalizeText(firstTagValue(tagMaps, ['comment', 'description']))
  const musicalKey = normalizeText(firstTagValue(tagMaps, ['initialkey', 'key']))
  const tagBpm = parseBpm(firstTagValue(tagMaps, ['bpm', 'tbpm', 'tempo']))
  const isrc = normalizeText(firstTagValue(tagMaps, ['isrc']))
  const year = parseYear(
    firstTagValue(tagMaps, ['date', 'year', 'originalyear', 'creation_time'])
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
    normalizeDate(firstTagValue(tagMaps, ['creation_time'])) ??
    normalizeDate(firstTagValue(tagMaps, ['encoded_date']))

  let metadataRaw: string | null = null
  if (Object.keys(streamTags).length > 0 || Object.keys(formatTags).length > 0) {
    try {
      metadataRaw = JSON.stringify({ streamTags, formatTags })
    } catch {
      metadataRaw = null
    }
  }

  return {
    sampleRate,
    channels,
    format,
    modifiedAt,
    createdAt: metadataCreatedAt ?? filesystemCreatedAt,
    title,
    artist,
    album,
    albumArtist,
    genre,
    composer,
    trackNumber,
    discNumber,
    trackComment,
    musicalKey,
    tagBpm,
    isrc,
    year,
    metadataRaw,
  }
}
