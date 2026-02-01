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
  source?: 'youtube' | 'local'
  originalPath?: string | null
  folderPath?: string | null
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
  bpm?: number | null
  keyEstimate?: string | null
  envelopeType?: string | null
  genrePrimary?: string | null
  instrumentPrimary?: string | null
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
  parentId: number | null
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

export type AnalysisLevel = 'quick' | 'standard' | 'advanced'

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
  // Phase 1: Advanced Timbral Features
  dissonance?: number | null
  inharmonicity?: number | null
  tristimulus?: number[] | null
  spectralComplexity?: number | null
  spectralCrest?: number | null
  // Phase 1: Perceptual Features (0-1 normalized)
  brightness?: number | null
  warmth?: number | null
  hardness?: number | null
  roughness?: number | null
  sharpness?: number | null
  // Phase 1: Advanced Spectral Features
  melBandsMean?: number[] | null
  melBandsStd?: number[] | null
  // Phase 2: Stereo Analysis
  stereoWidth?: number | null
  panningCenter?: number | null
  stereoImbalance?: number | null
  // Phase 2: Harmonic/Percussive Separation
  harmonicPercussiveRatio?: number | null
  harmonicEnergy?: number | null
  percussiveEnergy?: number | null
  harmonicCentroid?: number | null
  percussiveCentroid?: number | null
  // Phase 3: Advanced Rhythm Features
  onsetRate?: number | null
  beatStrength?: number | null
  rhythmicRegularity?: number | null
  danceability?: number | null
  // Phase 3: ADSR Envelope Features
  decayTime?: number | null
  sustainLevel?: number | null
  releaseTime?: number | null
  envelopeType?: string | null
  // Phase 4: ML-Based Classification
  instrumentClasses?: Array<{
    class: string
    confidence: number
  }> | null
  genreClasses?: Array<{
    genre: string
    confidence: number
  }> | null
  genrePrimary?: string | null
  yamnetEmbeddings?: number[] | null // 1024-dim array for similarity
  moodClasses?: Array<{
    mood: string
    confidence: number
  }> | null
  // Phase 5: EBU R128 Loudness
  loudnessIntegrated?: number | null // LUFS
  loudnessRange?: number | null // LU
  loudnessMomentaryMax?: number | null
  truePeak?: number | null // dBTP
  // Phase 5: Sound Event Detection
  eventCount?: number | null
  eventDensity?: number | null // Events per second
  // Phase 6: Audio Fingerprinting & Similarity Detection
  chromaprintFingerprint?: string | null
  similarityHash?: string | null
  // Metadata
  analysisLevel?: AnalysisLevel | null
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
  // Phase 1: Timbral features
  dissonance: number
  inharmonicity: number
  spectralComplexity: number
  spectralCrest: number
  // Phase 1: Perceptual features (0-1 normalized)
  brightness: number
  warmth: number
  hardness: number
  roughness: number
  sharpness: number
  // Phase 2: Stereo features
  stereoWidth: number
  panningCenter: number
  stereoImbalance: number
  // Phase 2: Harmonic/Percussive features
  harmonicPercussiveRatio: number
  harmonicEnergy: number
  percussiveEnergy: number
  harmonicCentroid: number
  percussiveCentroid: number
  // Phase 3: Advanced Rhythm features
  onsetRate: number
  beatStrength: number
  rhythmicRegularity: number
  danceability: number
  // Phase 3: ADSR Envelope features
  decayTime: number
  sustainLevel: number
  releaseTime: number
  // Phase 5: EBU R128 Loudness features
  loudnessIntegrated: number
  loudnessRange: number
  loudnessMomentaryMax: number
  truePeak: number
  // Phase 5: Sound Event Detection features
  eventCount: number
  eventDensity: number
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
  selectedCollectionIds: number[]
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

// Sources feature types
export interface YouTubeSourceNode {
  id: number
  title: string
  thumbnailUrl: string
  sliceCount: number
}

export interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
  sampleCount: number
}

export interface SourceTree {
  youtube: YouTubeSourceNode[]
  local: { count: number }
  folders: FolderNode[]
}

export type SourceScope =
  | { type: 'all' }
  | { type: 'youtube' }
  | { type: 'youtube-video'; trackId: number }
  | { type: 'local' }
  | { type: 'folder'; path: string }
  | { type: 'my-folder'; collectionId: number }

export interface SliceWithTrackExtended extends Slice {
  collectionIds: number[]
  track: {
    title: string
    youtubeId: string
    source?: 'youtube' | 'local'
    folderPath?: string | null
    originalPath?: string | null
  }
}

export interface SourcesSamplesResponse {
  samples: SliceWithTrackExtended[]
  total: number
}
