import * as tf from '@tensorflow/tfjs-node';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

// YAMNet model configuration
const YAMNET_MODEL_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';
const SAMPLE_RATE = 16000;
const SCORE_THRESHOLD = 0.15; // Minimum confidence score to consider a class
const TOP_K = 5; // Number of top predictions to return

// Cache the loaded model
let yamnetModel: tf.GraphModel | null = null;
let classNames: string[] = [];

/**
 * Load YAMNet model from TensorFlow Hub
 */
export async function loadYAMNetModel(): Promise<void> {
  if (yamnetModel) {
    return; // Already loaded
  }

  console.log('Loading YAMNet model...');
  yamnetModel = await tf.loadGraphModel(YAMNET_MODEL_URL, { fromTFHub: true });

  // Load class names
  classNames = await loadClassNames();
  console.log(`YAMNet model loaded with ${classNames.length} classes`);
}

/**
 * Load YAMNet class names from the official CSV
 */
async function loadClassNames(): Promise<string[]> {
  // YAMNet class names URL
  const classNamesUrl = 'https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv';

  try {
    const response = await fetch(classNamesUrl);
    const csvText = await response.text();

    // Parse CSV: index,mid,display_name
    const lines = csvText.split('\n').slice(1); // Skip header
    const names = lines
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(',');
        return parts[2]?.replace(/"/g, '').trim() || '';
      })
      .filter(name => name);

    return names;
  } catch (error) {
    console.error('Error loading class names, using fallback:', error);
    // Fallback to a subset of common classes if fetch fails
    return getFallbackClassNames();
  }
}

/**
 * Convert audio file to waveform array suitable for YAMNet
 * YAMNet expects: 16kHz mono audio as float32 array in range [-1, 1]
 */
async function audioFileToWaveform(audioPath: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', audioPath,
      '-f', 's16le',        // 16-bit PCM
      '-acodec', 'pcm_s16le',
      '-ar', SAMPLE_RATE.toString(), // 16kHz
      '-ac', '1',           // Mono
      '-'                   // Output to stdout
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (data) => {
      // FFmpeg outputs to stderr, we can ignore most of it
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}`));
        return;
      }

      // Combine all chunks
      const buffer = Buffer.concat(chunks);

      // Convert 16-bit PCM to Float32 array normalized to [-1, 1]
      const samples = new Float32Array(buffer.length / 2);
      for (let i = 0; i < samples.length; i++) {
        const int16 = buffer.readInt16LE(i * 2);
        samples[i] = int16 / 32768.0; // Normalize to [-1, 1]
      }

      resolve(samples);
    });

    ffmpeg.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Classify audio file using YAMNet
 */
export async function classifyAudio(audioPath: string): Promise<AudioClassification[]> {
  // Ensure model is loaded
  if (!yamnetModel) {
    await loadYAMNetModel();
  }

  if (!yamnetModel) {
    throw new Error('Failed to load YAMNet model');
  }

  // Convert audio to waveform
  const waveform = await audioFileToWaveform(audioPath);

  // Run inference
  const waveformTensor = tf.tensor1d(waveform);
  let prediction = yamnetModel.predict(waveformTensor) as any;

  // Handle case where predict returns an object with named tensors
  if (prediction && typeof prediction === 'object' && 'scores' in prediction) {
    prediction = prediction.scores;
  } else if (Array.isArray(prediction)) {
    prediction = prediction[0];
  }

  // Ensure we have a tensor by checking for required methods
  if (!prediction || typeof prediction.array !== 'function' || !prediction.shape) {
    throw new Error('Model did not return a valid tensor');
  }

  // Get scores - handle both tensor and raw data outputs
  let scores: number[];
  const predictionTensor = prediction as tf.Tensor;

  if (predictionTensor.shape.length === 1) {
    // Already 1D (single scores per class)
    scores = await predictionTensor.array() as number[];
  } else if (predictionTensor.shape.length === 2) {
    // 2D output [time, classes] - average across time
    scores = await predictionTensor.mean(0).array() as number[];
  } else {
    throw new Error(`Unexpected prediction shape: ${predictionTensor.shape}`);
  }

  // Clean up tensors
  waveformTensor.dispose();
  predictionTensor.dispose();

  // Get top K predictions
  const results: AudioClassification[] = scores
    .map((score, index) => ({
      className: classNames[index] || `class_${index}`,
      score,
    }))
    .filter(result => result.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  return results;
}

/**
 * Map YAMNet classifications to tag names
 */
export function mapClassificationsToTags(classifications: AudioClassification[]): string[] {
  const tagMap = getYAMNetToTagMapping();
  const tags = new Set<string>();

  for (const classification of classifications) {
    const className = classification.className.toLowerCase();

    // Direct mapping
    if (tagMap[className]) {
      tags.add(tagMap[className]);
    }

    // Fuzzy matching for instruments, genres, etc.
    for (const [pattern, tag] of Object.entries(tagMap)) {
      if (className.includes(pattern) || pattern.includes(className)) {
        tags.add(tag);
      }
    }

    // Also add the raw class name as a tag (cleaned up)
    const cleanedClassName = className
      .replace(/[_-]/g, ' ')
      .split(' ')
      .slice(0, 2) // Take first 2 words max
      .join(' ');

    if (cleanedClassName && cleanedClassName.length > 2) {
      tags.add(cleanedClassName);
    }
  }

  return Array.from(tags);
}

/**
 * Mapping from YAMNet class names to user-friendly tag names
 */
function getYAMNetToTagMapping(): Record<string, string> {
  return {
    // Instruments
    'piano': 'piano',
    'keyboard': 'piano',
    'electric piano': 'piano',
    'guitar': 'guitar',
    'acoustic guitar': 'guitar',
    'electric guitar': 'guitar',
    'bass': 'bass',
    'bass guitar': 'bass',
    'drum': 'drums',
    'drums': 'drums',
    'snare drum': 'drums',
    'hi-hat': 'drums',
    'cymbal': 'drums',
    'synthesizer': 'synth',
    'synth': 'synth',
    'strings': 'strings',
    'violin': 'strings',
    'cello': 'strings',
    'flute': 'wind',
    'saxophone': 'wind',
    'trumpet': 'brass',
    'trombone': 'brass',

    // Genres/Styles
    'jazz': 'jazz',
    'rock': 'rock',
    'hip hop music': 'hip-hop',
    'electronic music': 'electronic',
    'techno': 'electronic',
    'house music': 'electronic',
    'classical': 'classical',
    'funk': 'funk',
    'soul': 'soul',
    'blues': 'blues',
    'reggae': 'reggae',
    'ambient': 'ambient',

    // Moods/Vibes
    'music': 'music',
    'singing': 'vocals',
    'vocal': 'vocals',
    'speech': 'vocals',
    'rhythm': 'rhythmic',
    'melody': 'melodic',
    'harmony': 'harmonic',

    // Use cases
    'sample': 'sampling',
    'loop': 'loops',
    'beat': 'beats',
  };
}

/**
 * Fallback class names if we can't fetch from GitHub
 */
function getFallbackClassNames(): string[] {
  return [
    'Speech', 'Music', 'Singing', 'Piano', 'Guitar', 'Bass', 'Drums',
    'Synthesizer', 'Electronic', 'Jazz', 'Rock', 'Hip-hop', 'Classical',
    'Funk', 'Soul', 'Ambient', 'Rhythm', 'Melody', 'Harmony', 'Vocals'
  ];
}

export interface AudioClassification {
  className: string;
  score: number;
}
