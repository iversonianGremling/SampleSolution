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
  relativePath?: string | null
  fullPathHint?: string | null
  artist?: string | null
  album?: string | null
  year?: number | null
  albumArtist?: string | null
  genre?: string | null
  composer?: string | null
  trackNumber?: number | null
  discNumber?: number | null
  trackComment?: string | null
  musicalKey?: string | null
  tagBpm?: number | null
  isrc?: string | null
  metadataRaw?: string | null
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
  sampleType?: 'oneshot' | 'loop' | null
  favorite: boolean
  sampleModified?: boolean
  sampleModifiedAt?: string | null
  createdAt: string
  tags: Tag[]
  bpm?: number | null
  keyEstimate?: string | null
  fundamentalFrequency?: number | null
  envelopeType?: string | null
  genrePrimary?: string | null
  instrumentPrimary?: string | null
  instrumentType?: string | null
  brightness?: number | null
  warmth?: number | null
  hardness?: number | null
  sharpness?: number | null
  noisiness?: number | null
  loudness?: number | null
  roughness?: number | null
  stereoWidth?: number | null
  rhythmicRegularity?: number | null
  scale?: string | null
  sampleRate?: number | null
  channels?: number | null
  format?: string | null
  polyphony?: number | null
  dateAdded?: string | null
  dateCreated?: string | null
  dateModified?: string | null
  pathDisplay?: string | null
  absolutePath?: string | null
  uri?: string | null
  similarity?: number  // 0-1 range, only present in similarity mode
  subjectiveNormalized?: {
    brightness?: number | null
    noisiness?: number | null
    warmth?: number | null
    hardness?: number | null
    sharpness?: number | null
  } | null
  dimensionNormalized?: {
    brightness?: number | null
    harmonicity?: number | null
    noisiness?: number | null
    attack?: number | null
    dynamics?: number | null
    saturation?: number | null
    surface?: number | null
    rhythmic?: number | null
    density?: number | null
    ambience?: number | null
    stereoWidth?: number | null
    depth?: number | null
  } | null
}

export interface SliceWithTrack extends Slice {
  folderIds: number[]
  track: {
    title: string
    youtubeId: string
  }
}

export interface Folder {
  id: number
  name: string
  color: string
  parentId: number | null
  collectionId: number | null
  sliceCount: number
  createdAt: string
}

export interface Collection {
  id: number
  name: string
  color: string
  sortOrder: number
  folderCount: number
  createdAt: string
}

export interface FacetGroup {
  tags: Record<string, { tagId: number; name: string; count: number }[]>
  metadata: Record<string, { value: string; count: number }[]>
  totalSamples: number
}

export interface SplitResult {
  created: { id: number; name: string; sliceCount: number }[]
  unmatched: number
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
  category?: string
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

export type AnalysisLevel = 'advanced'

export type NormalizationMethod = 'minmax' | 'robust' | 'zscore'

export interface AudioFeatures {
  // Slice info
  id: number
  name: string
  trackId: number
  filePath: string | null
  // Sample type
  isOneShot: number | null // 1 = one-shot, 0 = not
  isLoop: number | null // 1 = loop, 0 = not
  fundamentalFrequency: number | null
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
  noisiness?: number | null
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
  // New analysis features
  temporalCentroid?: number | null
  crestFactor?: number | null
  transientSpectralCentroid?: number | null
  transientSpectralFlatness?: number | null
  sampleTypeConfidence?: number | null
  polyphony?: number | null
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
  noisiness: number
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
  // New analysis features
  temporalCentroid: number
  crestFactor: number
  transientSpectralCentroid: number
  transientSpectralFlatness: number
  sampleTypeConfidence: number
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
  excludedTags?: number[]
  minDuration: number
  maxDuration: number
  showFavoritesOnly: boolean
  selectedFolderIds: number[]
  excludedFolderIds?: number[]
  selectedTrackId: number | null
}

export interface FilterableSlice {
  id: number
  name: string
  trackId: number
  favorite?: boolean
  tags?: { id: number }[]
  folderIds?: number[]
  track?: { title: string }
  startTime?: number
  endTime?: number
  duration?: number | null
}

export interface AudioFeaturesWithMetadata extends AudioFeatures {
  favorite: boolean
  tags: { id: number; name: string; color: string }[]
  folderIds: number[]
  track: { title: string; youtubeId: string }
  startTime: number
  endTime: number
  instrumentPrimary?: string | null
  instrumentType?: string | null
  dateAdded?: string | null
  dateCreated?: string | null
  dateModified?: string | null
}

// Sources feature types
export interface YouTubeSourceNode {
  id: number
  title: string
  thumbnailUrl: string
  sliceCount: number
}

export interface StreamingSourceNode {
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

export interface LibrarySourceNode {
  id: string
  name: string
  sampleCount: number
  collectionCount?: number
  importedAt?: string | null
}

export interface SourceTree {
  youtube: YouTubeSourceNode[]
  local: { count: number }
  streaming?: {
    soundcloud: { count: number; tracks: StreamingSourceNode[] }
    spotify: { count: number; tracks: StreamingSourceNode[] }
    bandcamp: { count: number; tracks: StreamingSourceNode[] }
  }
  folders: FolderNode[]
  libraries?: LibrarySourceNode[]
}

export type SourceScope =
  | { type: 'all' }
  | { type: 'youtube' }
  | { type: 'youtube-video'; trackId: number }
  | { type: 'local' }
  | { type: 'soundcloud' }
  | { type: 'soundcloud-track'; trackId: number }
  | { type: 'spotify' }
  | { type: 'spotify-track'; trackId: number }
  | { type: 'bandcamp' }
  | { type: 'bandcamp-track'; trackId: number }
  | { type: 'folder'; path: string }
  | { type: 'library'; libraryId: string }
  | { type: 'my-folder'; folderId: number }
  | { type: 'collection'; collectionId: number }

export interface SliceWithTrackExtended extends Slice {
  folderIds: number[]
  track: {
    title: string
    youtubeId: string
    source?: 'youtube' | 'local'
    folderPath?: string | null
    originalPath?: string | null
    relativePath?: string | null
    fullPathHint?: string | null
    uri?: string | null
    artist?: string | null
    album?: string | null
    year?: number | null
    albumArtist?: string | null
    genre?: string | null
    composer?: string | null
    trackNumber?: number | null
    discNumber?: number | null
    trackComment?: string | null
    musicalKey?: string | null
    tagBpm?: number | null
    isrc?: string | null
  }
}

export interface SyncConfig {
  id: number
  tagId: number
  folderId: number
  syncDirection: 'tag-to-folder' | 'folder-to-tag' | 'bidirectional'
  enabled: boolean
  createdAt: string
}

export interface SourcesSamplesResponse {
  samples: SliceWithTrackExtended[]
  total: number
}
