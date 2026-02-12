import type { AudioFeatures, SliceWithTrack, AudioFeaturesWithMetadata } from '../types'

// Enrich AudioFeatures with metadata from SliceWithTrack for filtering
export function enrichAudioFeatures(
  features: AudioFeatures[],
  slices: SliceWithTrack[]
): AudioFeaturesWithMetadata[] {
  // Create lookup map for O(1) access
  const sliceMap = new Map(slices.map(s => [s.id, s]))

  return features
    .map(feature => {
      const slice = sliceMap.get(feature.id)
      if (!slice) return null

      return {
        ...feature,
        favorite: slice.favorite,
        tags: slice.tags,
        folderIds: slice.folderIds,
        track: slice.track,
        startTime: feature.duration ? 0 : slice.startTime,
        endTime: feature.duration ?? slice.endTime,
      } as AudioFeaturesWithMetadata
    })
    .filter((item): item is AudioFeaturesWithMetadata => item !== null)
}
