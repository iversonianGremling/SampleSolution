export interface Track {
  id: number
  youtubeId: string
  title: string
  description: string
  thumbnailUrl: string
  duration: number
  audioPath: string | null
  peaksPath: string | null
  status: 'pending' | 'downloading' | 'ready' | 'error'
  createdAt: string
  tags: Tag[]
}

export interface Slice {
  id: number
  trackId: number
  name: string
  startTime: number
  endTime: number
  filePath: string | null
  favorite: boolean
  createdAt: string
  tags: Tag[]
}

export interface SliceWithTrack extends Slice {
  collectionIds: number[]
  track: {
    title: string
    youtubeId: string
  }
}

export interface Collection {
  id: number
  name: string
  color: string
  sliceCount: number
  createdAt: string
}

export interface ExportResult {
  success: boolean
  exportPath: string
  exported: string[]
  failed: { name: string; error: string }[]
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface YouTubeSearchResult {
  videoId: string
  title: string
  description: string
  thumbnailUrl: string
  channelTitle: string
  publishedAt: string
}

export interface YouTubePlaylist {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  itemCount: number
}

export interface AuthStatus {
  authenticated: boolean
  user?: {
    name: string
    email: string
    picture: string
  }
}

export interface ImportResult {
  success: string[]
  failed: { url: string; error: string }[]
}

export interface AudioFeatures {
  // Slice info
  id: number
  name: string
  trackId: number
  filePath: string | null
  // Audio features
  duration: number | null
  bpm: number | null
  onsetCount: number | null
  spectralCentroid: number | null
  spectralRolloff: number | null
  spectralBandwidth: number | null
  spectralContrast: number | null
  zeroCrossingRate: number | null
  mfccMean: number[] | null
  rmsEnergy: number | null
  loudness: number | null
  dynamicRange: number | null
  keyEstimate: string | null
  keyStrength: number | null
  attackTime: number | null
  spectralFlux: number | null
  spectralFlatness: number | null
  kurtosis: number | null
}

export interface FeatureWeights {
  spectralCentroid: number
  spectralRolloff: number
  spectralBandwidth: number
  spectralContrast: number
  spectralFlux: number
  spectralFlatness: number
  zeroCrossingRate: number
  rmsEnergy: number
  loudness: number
  dynamicRange: number
  attackTime: number
  kurtosis: number
  bpm: number
  onsetCount: number
  keyStrength: number
}

export interface SamplePoint {
  id: number
  name: string
  x: number
  y: number
  cluster: number
  features: AudioFeatures
}

export interface SliceFilterState {
  searchQuery: string
  selectedTags: number[]
  minDuration: number
  maxDuration: number
  showFavoritesOnly: boolean
  selectedCollectionId: number | null
  selectedTrackId: number | null
}

export interface FilterableSlice {
  id: number
  name: string
  trackId: number
  favorite?: boolean
  tags?: { id: number }[]
  collectionIds?: number[]
  track?: { title: string }
  startTime?: number
  endTime?: number
  duration?: number | null
}

export interface AudioFeaturesWithMetadata extends AudioFeatures {
  favorite: boolean
  tags: { id: number; name: string; color: string }[]
  collectionIds: number[]
  track: { title: string; youtubeId: string }
  startTime: number
  endTime: number
}
