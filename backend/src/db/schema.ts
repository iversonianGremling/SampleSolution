import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const tracks = sqliteTable('tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  youtubeId: text('youtube_id').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  thumbnailUrl: text('thumbnail_url').notNull(),
  duration: real('duration').notNull().default(0),
  audioPath: text('audio_path'),
  peaksPath: text('peaks_path'),
  status: text('status', { enum: ['pending', 'downloading', 'ready', 'error'] })
    .notNull()
    .default('pending'),
  artist: text('artist'),
  album: text('album'),
  year: integer('year'),
  albumArtist: text('album_artist'),
  genre: text('genre'),
  composer: text('composer'),
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  trackComment: text('track_comment'),
  musicalKey: text('musical_key'),
  tagBpm: real('tag_bpm'),
  isrc: text('isrc'),
  metadataRaw: text('metadata_raw'),
  source: text('source', { enum: ['youtube', 'local'] })
    .notNull()
    .default('youtube'),
  originalPath: text('original_path'),  // Full path of imported file (for local sources)
  folderPath: text('folder_path'),      // Folder used for import (null for individual files/YouTube)
  relativePath: text('relative_path'),  // Relative path from imported folder root
  fullPathHint: text('full_path_hint'), // Reserved for desktop import full-path capture
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const slices = sqliteTable('slices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trackId: integer('track_id')
    .notNull()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startTime: real('start_time').notNull(),
  endTime: real('end_time').notNull(),
  filePath: text('file_path'),
  favorite: integer('favorite').notNull().default(0),
  sampleModified: integer('sample_modified').notNull().default(0),
  sampleModifiedAt: text('sample_modified_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  color: text('color').notNull(),
  category: text('category', {
    enum: ['general', 'type', 'energy', 'instrument', 'filename'],
  })
    .notNull()
    .default('general'),
})

export const trackTags = sqliteTable('track_tags', {
  trackId: integer('track_id')
    .notNull()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
})

export const sliceTags = sqliteTable('slice_tags', {
  sliceId: integer('slice_id')
    .notNull()
    .references(() => slices.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
})

export const audioFeatures = sqliteTable('audio_features', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sliceId: integer('slice_id')
    .notNull()
    .unique()
    .references(() => slices.id, { onDelete: 'cascade' }),
  // Basic properties
  duration: real('duration').notNull(),
  sampleRate: integer('sample_rate').notNull().default(44100),
  channels: integer('channels'),
  fileFormat: text('file_format'),
  sourceMtime: text('source_mtime'),
  sourceCtime: text('source_ctime'),
  isOneShot: integer('is_one_shot').notNull().default(0),
  isLoop: integer('is_loop').notNull().default(0),
  // Tempo/Rhythm
  bpm: real('bpm'),
  beatsCount: integer('beats_count'),
  onsetCount: integer('onset_count').notNull().default(0),
  // Spectral features
  spectralCentroid: real('spectral_centroid'),
  spectralRolloff: real('spectral_rolloff'),
  spectralBandwidth: real('spectral_bandwidth'),
  spectralContrast: real('spectral_contrast'),
  // Timbral features
  zeroCrossingRate: real('zero_crossing_rate'),
  mfccMean: text('mfcc_mean'),
  // Energy/Dynamics
  rmsEnergy: real('rms_energy'),
  loudness: real('loudness'),
  dynamicRange: real('dynamic_range'),
  // Key detection
  keyEstimate: text('key_estimate'),
  scale: text('scale'),
  keyStrength: real('key_strength'),
  // Instrument classification
  instrumentPredictions: text('instrument_predictions'),
  // Additional spectral features
  attackTime: real('attack_time'),
  spectralFlux: real('spectral_flux'),
  spectralFlatness: real('spectral_flatness'),
  kurtosis: real('kurtosis'),
  // Phase 1: Advanced Timbral Features
  dissonance: real('dissonance'),
  inharmonicity: real('inharmonicity'),
  tristimulus: text('tristimulus'), // JSON array [t1, t2, t3]
  spectralComplexity: real('spectral_complexity'),
  spectralCrest: real('spectral_crest'),
  // Phase 1: Perceptual Features (0-1 normalized)
  brightness: real('brightness'),
  warmth: real('warmth'),
  hardness: real('hardness'),
  noisiness: real('noisiness'),
  roughness: real('roughness'),
  sharpness: real('sharpness'),
  // Phase 1: Advanced Spectral Features
  melBandsMean: text('mel_bands_mean'), // JSON array
  melBandsStd: text('mel_bands_std'), // JSON array
  // Phase 2: Stereo Analysis
  stereoWidth: real('stereo_width'),
  panningCenter: real('panning_center'),
  stereoImbalance: real('stereo_imbalance'),
  // Phase 2: Harmonic/Percussive Separation
  harmonicPercussiveRatio: real('harmonic_percussive_ratio'),
  harmonicEnergy: real('harmonic_energy'),
  percussiveEnergy: real('percussive_energy'),
  harmonicCentroid: real('harmonic_centroid'),
  percussiveCentroid: real('percussive_centroid'),
  // Phase 3: Advanced Rhythm Features
  onsetRate: real('onset_rate'),
  beatStrength: real('beat_strength'),
  rhythmicRegularity: real('rhythmic_regularity'),
  danceability: real('danceability'),
  // Phase 3: ADSR Envelope Features
  decayTime: real('decay_time'),
  sustainLevel: real('sustain_level'),
  releaseTime: real('release_time'),
  envelopeType: text('envelope_type'),
  // Phase 4: ML-Based Classification
  instrumentClasses: text('instrument_classes'), // JSON: [{class, confidence}, ...]
  genreClasses: text('genre_classes'), // JSON: [{genre, confidence}, ...]
  genrePrimary: text('genre_primary'),
  yamnetEmbeddings: text('yamnet_embeddings'), // JSON: 1024-dim array for similarity
  moodClasses: text('mood_classes'), // JSON: [{mood, confidence}, ...]
  // Phase 5: EBU R128 Loudness & Sound Event Detection
  loudnessIntegrated: real('loudness_integrated'), // LUFS
  loudnessRange: real('loudness_range'), // LU
  loudnessMomentaryMax: real('loudness_momentary_max'),
  truePeak: real('true_peak'), // dBTP
  eventCount: integer('event_count'),
  eventDensity: real('event_density'),
  // Phase 6: Audio Fingerprinting & Similarity Detection
  chromaprintFingerprint: text('chromaprint_fingerprint'),
  similarityHash: text('similarity_hash'),
  // Derived instrument type (canonical: kick, snare, hihat, clap, shaker, cymbal, tom, bass, pad, lead, vocal, fx, percussion, keys, guitar, strings, other)
  instrumentType: text('instrument_type'),
  // New analysis features
  temporalCentroid: real('temporal_centroid'),
  crestFactor: real('crest_factor'),
  transientSpectralCentroid: real('transient_spectral_centroid'),
  transientSpectralFlatness: real('transient_spectral_flatness'),
  sampleTypeConfidence: real('sample_type_confidence'),
  fundamentalFrequency: real('fundamental_frequency'),
  polyphony: integer('polyphony'),
  // Metadata
  analysisLevel: text('analysis_level', {
    enum: ['advanced'],
  }).default('advanced'),
  analysisVersion: text('analysis_version').notNull().default('1.0'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  analysisDurationMs: integer('analysis_duration_ms'),
})

export const collections = sqliteTable('collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const folders = sqliteTable('folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  parentId: integer('parent_id'),
  collectionId: integer('collection_id').references(() => collections.id, { onDelete: 'cascade' }),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const folderSlices = sqliteTable('folder_slices', {
  folderId: integer('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  sliceId: integer('slice_id')
    .notNull()
    .references(() => slices.id, { onDelete: 'cascade' }),
})

export const syncConfigs = sqliteTable('sync_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  folderId: integer('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  syncDirection: text('sync_direction', {
    enum: ['tag-to-folder', 'folder-to-tag', 'bidirectional'],
  }).notNull().default('bidirectional'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const reanalysisLogs = sqliteTable('reanalysis_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sliceId: integer('slice_id')
    .notNull()
    .references(() => slices.id, { onDelete: 'cascade' }),
  beforeTags: text('before_tags').notNull().default('[]'),
  afterTags: text('after_tags').notNull().default('[]'),
  removedTags: text('removed_tags').notNull().default('[]'),
  addedTags: text('added_tags').notNull().default('[]'),
  hadPotentialCustomState: integer('had_potential_custom_state').notNull().default(0),
  warningMessage: text('warning_message'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})
