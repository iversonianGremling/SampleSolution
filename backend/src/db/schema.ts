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
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  color: text('color').notNull(),
  category: text('category', {
    enum: ['general', 'type', 'tempo', 'spectral', 'energy', 'instrument'],
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
  keyStrength: real('key_strength'),
  // Instrument classification
  instrumentPredictions: text('instrument_predictions'),
  // Metadata
  analysisVersion: text('analysis_version').notNull().default('1.0'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  analysisDurationMs: integer('analysis_duration_ms'),
})
