import { spawn } from 'child_process'
import path from 'path'
import type { YouTubeVideoInfo } from '../types/index.js'

const DATA_DIR = process.env.DATA_DIR || './data'

export async function getVideoInfo(videoId: string): Promise<YouTubeVideoInfo> {
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
  // Handle various YouTube URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Plain video ID
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return null
}

export function extractPlaylistId(input: string): string | null {
  const match = input.match(/[?&]list=([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}
