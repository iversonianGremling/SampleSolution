const REDUCIBLE_DIMENSION_TAG_LIST = [
  // Legacy tempo buckets now represented by numeric BPM fields.
  'slow',
  'fast',
  'uptempo',
  'downtempo',
  'midtempo',
  '60-80bpm',
  '80-100bpm',
  '100-120bpm',
  '120-140bpm',
  '140+bpm',

  // Spectral / tonal single-axis descriptors.
  'bright',
  'dark',
  'mid-range',
  'midrange',
  'bass-heavy',
  'high-freq',
  'noisy',
  'smooth',
  'harmonic',
  'percussive',

  // Energy single-axis descriptors.
  'punchy',
  'soft',
  'dynamic',
  'compressed',

  // Surface / texture / density single-axis descriptors.
  'rough',
  'sharp',
  'event-dense',
  'multi-event',
  'single-event',

  // Space single-axis descriptors.
  'ambient',
  'wide-stereo',
  'mono',
] as const

export const REDUCIBLE_DIMENSION_TAGS: ReadonlyArray<string> = REDUCIBLE_DIMENSION_TAG_LIST

const REDUCIBLE_DIMENSION_TAG_SET = new Set<string>(REDUCIBLE_DIMENSION_TAG_LIST)

export function isReducibleDimensionTag(tagName: string): boolean {
  const normalized = tagName.trim().toLowerCase()
  return REDUCIBLE_DIMENSION_TAG_SET.has(normalized)
}
