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

      // The /slices/features API returns these fields directly from audio_features table.
      // We cast to any to access extra fields (instrumentType, sliceCreatedAt, sourceCtime)
      // that are returned by the backend but not declared in the AudioFeatures type.
      const f = feature as any
      return {
        ...feature,
        fundamentalFrequency: feature.fundamentalFrequency ?? null,
        envelopeType: feature.envelopeType ?? null,
        brightness: feature.brightness ?? null,
        warmth: feature.warmth ?? null,
        hardness: feature.hardness ?? null,
        genrePrimary: feature.genrePrimary ?? null,
        instrumentType: f.instrumentType ?? null,
        instrumentPrimary: null, // not available from audio_features
        // dateAdded = when the slice was created in the app (slices.createdAt)
        dateAdded: f.sliceCreatedAt ?? slice.createdAt ?? null,
        // dateCreated = source file's creation time (audio_features.sourceCtime)
        dateCreated: f.sourceCtime ?? null,
        // dateModified = source file modified time (audio_features.sourceMtime)
        dateModified: f.sourceMtime ?? slice.sampleModifiedAt ?? slice.dateModified ?? null,
        // Metadata
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
