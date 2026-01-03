import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'

const DATA_DIR = process.env.DATA_DIR || './data'

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
