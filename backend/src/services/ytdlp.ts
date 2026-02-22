import { spawn } from 'child_process'
import path from 'path'
import type { YouTubeVideoInfo } from '../types/index.js'
import { ensureDownloadTool } from './downloadTools.js'

const DATA_DIR = process.env.DATA_DIR || './data'
const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

function parseUrl(input: string): URL | null {
  try {
    return new URL(input)
  } catch {
    try {
      return new URL(`https://${input}`)
    } catch {
      return null
    }
  }
}

export async function getVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
  await ensureDownloadTool('yt-dlp')

  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-download',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]

    const proc = spawn('yt-dlp', args)
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
        reject(new Error(`yt-dlp failed: ${stderr}`))
        return
      }

      try {
        const info = JSON.parse(stdout)
        resolve({
          videoId: info.id,
          title: info.title,
          description: info.description || '',
          thumbnailUrl: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          channelTitle: info.channel || info.uploader || '',
          duration: info.duration || 0,
        })
      } catch (e) {
        reject(new Error(`Failed to parse yt-dlp output: ${e}`))
      }
    })
  })
}

export async function downloadAudio(
  videoId: string,
  outputPath: string
): Promise<string> {
  await ensureDownloadTool('yt-dlp')

  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(outputPath, `${videoId}.%(ext)s`)
    const args = [
      '-x', // Extract audio
      '--audio-format', 'mp3',
      '--audio-quality', '0', // Best quality
      '-o', outputTemplate,
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]

    const proc = spawn('yt-dlp', args)
    let stderr = ''

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      console.log('yt-dlp:', data.toString())
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed: ${stderr}`))
        return
      }
      resolve(path.join(outputPath, `${videoId}.mp3`))
    })
  })
}

export function extractVideoId(input: string): string | null {
  const cleaned = input.trim().replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '')

  if (!cleaned) {
    return null
  }

  // Plain video ID
  if (YOUTUBE_VIDEO_ID_PATTERN.test(cleaned)) {
    return cleaned
  }

  // Parse as URL when possible (supports URLs where `v` is not the first query param)
  const parsedUrl = parseUrl(cleaned)
  if (parsedUrl) {
    const hostname = parsedUrl.hostname.toLowerCase()
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
    const firstSegment = pathParts[0]
    const secondSegment = pathParts[1]

    if (hostname === 'youtu.be' && firstSegment && YOUTUBE_VIDEO_ID_PATTERN.test(firstSegment)) {
      return firstSegment
    }

    const isYoutubeHost =
      hostname.endsWith('youtube.com') || hostname.endsWith('youtube-nocookie.com')

    if (isYoutubeHost) {
      const queryVideoId = parsedUrl.searchParams.get('v')
      if (queryVideoId && YOUTUBE_VIDEO_ID_PATTERN.test(queryVideoId)) {
        return queryVideoId
      }

      if (
        firstSegment &&
        ['embed', 'v', 'shorts', 'live'].includes(firstSegment) &&
        secondSegment &&
        YOUTUBE_VIDEO_ID_PATTERN.test(secondSegment)
      ) {
        return secondSegment
      }
    }
  }

  // Fallback regexes for slightly malformed pasted text
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }

  return null
}

export function extractPlaylistId(input: string): string | null {
  const cleaned = input.trim()
  if (!cleaned) {
    return null
  }

  const parsedUrl = parseUrl(cleaned)
  if (parsedUrl) {
    const list = parsedUrl.searchParams.get('list')
    if (list) {
      return list
    }
  }

  const match = cleaned.match(/[?&]list=([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}
