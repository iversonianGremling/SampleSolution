/**
 * Audio Analysis Service
 * Uses Python (Essentia + Librosa) for feature extraction and tag generation
 */

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to Python script
const PYTHON_SCRIPT = path.join(__dirname, '../python/analyze_audio.py')
// Try to use venv Python if available, otherwise fall back to system python3
const VENV_PYTHON = path.join(__dirname, '../../venv/bin/python')
const PYTHON_EXECUTABLE = process.env.PYTHON_PATH || VENV_PYTHON

/**
 * Audio features extracted from analysis
 */
export interface AudioFeatures {
  // Basic properties
  duration: number
  sampleRate: number
  isOneShot: boolean
  isLoop: boolean

  // Tempo/Rhythm
  bpm?: number
  beatsCount?: number
  onsetCount: number

  // Spectral features
  spectralCentroid: number
  spectralRolloff: number
  spectralBandwidth: number
  spectralContrast: number

  // Timbral features
  zeroCrossingRate: number
  mfccMean: number[]

  // Energy/Dynamics
  rmsEnergy: number
  loudness: number
  dynamicRange: number

  // Key detection (optional)
  keyEstimate?: string
  keyStrength?: number

  // Instrument classification
  instrumentPredictions: Array<{
    name: string
    confidence: number
  }>

  // Metadata
  analysisDurationMs: number

  // Generated tags
  suggestedTags?: string[]
}

/**
 * Analysis error response
 */
export interface AnalysisError {
  error: string
  details?: string
}

/**
 * Analyze audio file using Python script (Essentia + Librosa)
 * Spawns Python process and parses JSON output
 */
export async function analyzeAudioFeatures(
  audioPath: string
): Promise<AudioFeatures> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_EXECUTABLE, [PYTHON_SCRIPT, audioPath], {
      timeout: 60000, // 60 second timeout
    })

    let stdout = ''
    let stderr = ''

    const timeoutHandle = setTimeout(() => {
      proc.kill()
      reject(new Error('Audio analysis timeout (>60s)'))
    }, 60000)

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timeoutHandle)

      if (code !== 0) {
        console.error('Python analysis failed:', stderr)
        reject(new Error(`Audio analysis failed: ${stderr.substring(0, 500)}`))
        return
      }

      try {
        const result = JSON.parse(stdout) as Record<string, any>

        if (result.error) {
          reject(new Error(`Analysis error: ${result.error}`))
          return
        }

        // Convert snake_case keys from Python to camelCase for TypeScript
        const converted: AudioFeatures = {
          duration: result.duration,
          sampleRate: result.sample_rate,
          isOneShot: result.is_one_shot,
          isLoop: result.is_loop,
          bpm: result.bpm,
          beatsCount: result.beats_count,
          onsetCount: result.onset_count,
          spectralCentroid: result.spectral_centroid,
          spectralRolloff: result.spectral_rolloff,
          spectralBandwidth: result.spectral_bandwidth,
          spectralContrast: result.spectral_contrast,
          zeroCrossingRate: result.zero_crossing_rate,
          mfccMean: result.mfcc_mean,
          rmsEnergy: result.rms_energy,
          loudness: result.loudness,
          dynamicRange: result.dynamic_range,
          keyEstimate: result.key_estimate,
          keyStrength: result.key_strength,
          instrumentPredictions: result.instrument_predictions || [],
          analysisDurationMs: result.analysis_duration_ms,
          suggestedTags: result.suggested_tags,
        }

        resolve(converted)
      } catch (err) {
        console.error('Failed to parse Python output:', stdout.substring(0, 500))
        reject(new Error('Failed to parse analysis results'))
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeoutHandle)
      reject(
        new Error(
          `Failed to spawn Python process: ${err.message}. Make sure Python is installed: python3 --version`
        )
      )
    })
  })
}

/**
 * Store audio features in database
 */
export async function storeAudioFeatures(
  sliceId: number,
  features: AudioFeatures
): Promise<void> {
  const createdAt = new Date().toISOString()

  const values = {
    sliceId,
    duration: features.duration,
    sampleRate: features.sampleRate,
    isOneShot: features.isOneShot ? 1 : 0,
    isLoop: features.isLoop ? 1 : 0,
    bpm: features.bpm ?? null,
    beatsCount: features.beatsCount ?? null,
    onsetCount: features.onsetCount,
    spectralCentroid: features.spectralCentroid,
    spectralRolloff: features.spectralRolloff,
    spectralBandwidth: features.spectralBandwidth,
    spectralContrast: features.spectralContrast,
    zeroCrossingRate: features.zeroCrossingRate,
    mfccMean: JSON.stringify(features.mfccMean),
    rmsEnergy: features.rmsEnergy,
    loudness: features.loudness,
    dynamicRange: features.dynamicRange,
    keyEstimate: features.keyEstimate ?? null,
    keyStrength: features.keyStrength ?? null,
    instrumentPredictions: JSON.stringify(features.instrumentPredictions),
    analysisVersion: '1.0',
    createdAt,
    analysisDurationMs: features.analysisDurationMs,
  }

  // Try to insert, or update if already exists (on unique constraint conflict)
  try {
    await db.insert(schema.audioFeatures).values(values)
  } catch (err: any) {
    // If unique constraint violation, update instead
    if (err.message?.includes('UNIQUE constraint failed')) {
      await db
        .update(schema.audioFeatures)
        .set({
          ...values,
          createdAt: undefined, // Don't update creation time on re-analysis
        } as any)
        .where(eq(schema.audioFeatures.sliceId, sliceId))
    } else {
      throw err
    }
  }
}

/**
 * Retrieve audio features for a slice from database
 */
export async function getAudioFeatures(sliceId: number): Promise<AudioFeatures | null> {
  const result = await db
    .select()
    .from(schema.audioFeatures)
    .where(eq(schema.audioFeatures.sliceId, sliceId))
    .limit(1)

  if (result.length === 0) return null

  const row = result[0]

  return {
    duration: row.duration || 0,
    sampleRate: row.sampleRate || 44100,
    isOneShot: row.isOneShot === 1,
    isLoop: row.isLoop === 1,
    bpm: row.bpm ?? undefined,
    beatsCount: row.beatsCount ?? undefined,
    onsetCount: row.onsetCount || 0,
    spectralCentroid: row.spectralCentroid || 0,
    spectralRolloff: row.spectralRolloff || 0,
    spectralBandwidth: row.spectralBandwidth || 0,
    spectralContrast: row.spectralContrast || 0,
    zeroCrossingRate: row.zeroCrossingRate || 0,
    mfccMean: JSON.parse(row.mfccMean || '[]'),
    rmsEnergy: row.rmsEnergy || 0,
    loudness: row.loudness || 0,
    dynamicRange: row.dynamicRange || 0,
    keyEstimate: row.keyEstimate ?? undefined,
    keyStrength: row.keyStrength ?? undefined,
    instrumentPredictions: JSON.parse(row.instrumentPredictions || '[]'),
    analysisDurationMs: row.analysisDurationMs || 0,
  }
}

/**
 * Convert audio features to searchable tags
 * Prefers tags generated by Python, but can generate fallback tags
 */
export function featuresToTags(features: AudioFeatures): string[] {
  // Use suggested tags from Python if available
  if (features.suggestedTags && features.suggestedTags.length > 0) {
    return features.suggestedTags
  }

  // Fallback: generate tags in Node (less preferred)
  const tags: string[] = []

  // Type tags
  if (features.isOneShot) tags.push('one-shot')
  if (features.isLoop) tags.push('loop')

  // BPM tags (only for loops)
  if (features.bpm && features.isLoop) {
    const bpm = features.bpm
    if (bpm < 80) tags.push('slow', '60-80bpm')
    else if (bpm < 100) tags.push('downtempo', '80-100bpm')
    else if (bpm < 120) tags.push('midtempo', '100-120bpm')
    else if (bpm < 140) tags.push('uptempo', '120-140bpm')
    else tags.push('fast', '140+bpm')
  }

  // Spectral tags (brightness)
  const centroid = features.spectralCentroid
  if (centroid > 3500) tags.push('bright')
  else if (centroid > 1500) tags.push('mid-range')
  else tags.push('dark')

  // Frequency content
  const rolloff = features.spectralRolloff
  if (rolloff < 2000) tags.push('bass-heavy')
  else if (rolloff > 8000) tags.push('high-freq')

  // Energy/dynamics tags
  const loudness = features.loudness

  if (loudness > -10) tags.push('aggressive')
  else if (loudness < -30) tags.push('ambient')

  if (features.dynamicRange > 30) tags.push('dynamic')
  else if (features.dynamicRange < 10) tags.push('compressed')

  // Instruments
  features.instrumentPredictions
    .filter((p) => p.confidence > 0.55)
    .forEach((p) => tags.push(p.name))

  // Return unique tags (preserving order)
  return Array.from(new Set(tags))
}

/**
 * Get tag metadata (color and category based on tag name)
 */
export function getTagMetadata(
  tagName: string
): { color: string; category: 'type' | 'tempo' | 'spectral' | 'energy' | 'instrument' | 'general' } {
  const lowerTag = tagName.toLowerCase()

  // Category determination
  let category: 'type' | 'tempo' | 'spectral' | 'energy' | 'instrument' | 'general' =
    'general'

  if (
    lowerTag.includes('bpm') ||
    ['slow', 'fast', 'uptempo', 'downtempo', 'midtempo'].includes(lowerTag)
  ) {
    category = 'tempo'
  } else if (
    ['bright', 'dark', 'mid-range', 'bass-heavy', 'high-freq', 'noisy', 'smooth'].includes(
      lowerTag
    )
  ) {
    category = 'spectral'
  } else if (
    ['punchy', 'soft', 'aggressive', 'ambient', 'dynamic', 'compressed'].includes(lowerTag)
  ) {
    category = 'energy'
  } else if (
    [
      'kick',
      'snare',
      'hihat',
      'bass',
      'synth',
      'guitar',
      'piano',
      'vocal',
      'percussion',
    ].includes(lowerTag)
  ) {
    category = 'instrument'
  } else if (['one-shot', 'loop'].includes(lowerTag)) {
    category = 'type'
  }

  // Color scheme by category
  const colorSchemes = {
    type: '#8b5cf6', // Purple
    tempo: '#3b82f6', // Blue
    spectral: '#14b8a6', // Teal
    energy: '#f59e0b', // Amber
    instrument: '#22c55e', // Green
    general: '#6366f1', // Indigo
  }

  return {
    color: colorSchemes[category],
    category,
  }
}
