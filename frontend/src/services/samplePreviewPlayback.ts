import { getSliceDownloadUrl } from '../api/client'
import { calcSemitoneShift, extractTonic, freqToNoteName } from '../utils/musicTheory'

interface PreparedSamplePreviewPlayback {
  url: string
  playbackRate: number
}

interface PreviewPitchSample {
  id: number
  fundamentalFrequency?: number | null
  keyEstimate?: string | null
}

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const getPitchSemitoneShift = (sample: PreviewPitchSample, tuneTargetNote: string | null) => {
  if (!tuneTargetNote) return 0

  const sourceNote =
    (sample.fundamentalFrequency ? freqToNoteName(sample.fundamentalFrequency) : null) ||
    (sample.keyEstimate ? extractTonic(sample.keyEstimate) : null)
  if (!sourceNote) return 0

  return calcSemitoneShift(sourceNote, tuneTargetNote)
}

export const prepareSamplePreviewPlayback = (
  sample: PreviewPitchSample,
  tuneTargetNote: string | null
): PreparedSamplePreviewPlayback => {
  const sourceUrl = getSliceDownloadUrl(sample.id)
  const semitoneShift = getPitchSemitoneShift(sample, tuneTargetNote)

  if (Math.abs(semitoneShift) <= 0.0001) {
    return { url: sourceUrl, playbackRate: 1 }
  }

  // Previews always use tape-style playback for fast response and low CPU.
  return {
    url: sourceUrl,
    playbackRate: clamp(Math.pow(2, semitoneShift / 12), 0.25, 4),
  }
}
