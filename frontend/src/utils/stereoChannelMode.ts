export type StereoChannelMode = 'all' | 'mono' | 'stereo'

type StereoChannelSample = {
  stereoWidth?: number | null
  channels?: number | null
  tags?: Array<{ name: string }> | null
}

export function matchesStereoChannelMode(
  mode: StereoChannelMode,
  sample: StereoChannelSample,
  normalizedStereoWidth: number | null | undefined,
): boolean {
  if (mode === 'all') return true

  // Prefer absolute stereo width when available. Normalized values are
  // scope-relative and can collapse in narrow result sets.
  if (typeof sample.stereoWidth === 'number' && Number.isFinite(sample.stereoWidth)) {
    const monoThreshold = 0.2
    return mode === 'mono'
      ? sample.stereoWidth <= monoThreshold
      : sample.stereoWidth > monoThreshold
  }

  const monoTag = sample.tags?.some((tag) => tag.name.toLowerCase() === 'mono') ?? false
  if (monoTag) {
    return mode === 'mono'
  }

  if (typeof sample.channels === 'number' && Number.isFinite(sample.channels)) {
    return mode === 'mono' ? sample.channels <= 1 : sample.channels > 1
  }

  // Last-resort fallback for legacy payloads without raw stereo width.
  if (typeof normalizedStereoWidth === 'number' && Number.isFinite(normalizedStereoWidth)) {
    const monoThreshold = 0.02
    return mode === 'mono'
      ? normalizedStereoWidth <= monoThreshold
      : normalizedStereoWidth > monoThreshold
  }

  return false
}
