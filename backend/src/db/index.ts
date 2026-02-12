import Database from 'better-sqlite3'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import path from 'path'

let sqlite: Database.Database | null = null
let drizzleDb: BetterSQLite3Database<typeof schema> | null = null

function initDatabase() {
  const DATA_DIR = process.env.DATA_DIR || './data'
  const dbPath = path.join(DATA_DIR, 'database.sqlite')

  sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')

  drizzleDb = drizzle(sqlite, { schema })

  // Initialize tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      audio_path TEXT,
      peaks_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      file_path TEXT,
      sample_modified INTEGER NOT NULL DEFAULT 0,
      sample_modified_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general'
    );

    CREATE TABLE IF NOT EXISTS track_tags (
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (track_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS slice_tags (
      slice_id INTEGER NOT NULL REFERENCES slices(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (slice_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS audio_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slice_id INTEGER NOT NULL UNIQUE REFERENCES slices(id) ON DELETE CASCADE,
      duration REAL NOT NULL,
      sample_rate INTEGER NOT NULL DEFAULT 44100,
      is_one_shot INTEGER NOT NULL DEFAULT 0,
      is_loop INTEGER NOT NULL DEFAULT 0,
      bpm REAL,
      beats_count INTEGER,
      onset_count INTEGER NOT NULL DEFAULT 0,
      spectral_centroid REAL,
      spectral_rolloff REAL,
      spectral_bandwidth REAL,
      spectral_contrast REAL,
      zero_crossing_rate REAL,
      mfcc_mean TEXT,
      rms_energy REAL,
      loudness REAL,
      dynamic_range REAL,
      key_estimate TEXT,
      key_strength REAL,
      instrument_predictions TEXT,
      analysis_version TEXT NOT NULL DEFAULT '1.0',
      created_at TEXT NOT NULL,
      analysis_duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_audio_features_slice_id ON audio_features(slice_id);

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folder_slices (
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      slice_id INTEGER NOT NULL REFERENCES slices(id) ON DELETE CASCADE,
      PRIMARY KEY (folder_id, slice_id)
    );
  `)

  // Migration: Add category column to tags if it doesn't exist
  const tagsColumns = sqlite.prepare("PRAGMA table_info(tags)").all() as { name: string }[]
  const hasCategory = tagsColumns.some(col => col.name === 'category')
  if (!hasCategory) {
    console.log('[DB] Migrating: Adding category column to tags table')
    sqlite.exec("ALTER TABLE tags ADD COLUMN category TEXT NOT NULL DEFAULT 'general'")
  }

  // Migration: Add favorite column to slices if it doesn't exist
  const slicesColumns = sqlite.prepare("PRAGMA table_info(slices)").all() as { name: string }[]
  const hasFavorite = slicesColumns.some(col => col.name === 'favorite')
  if (!hasFavorite) {
    console.log('[DB] Migrating: Adding favorite column to slices table')
    sqlite.exec("ALTER TABLE slices ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0")
  }

  // Migration: Add sample_modified tracking columns to slices if they don't exist
  const slicesColumnsUpdated = sqlite.prepare("PRAGMA table_info(slices)").all() as { name: string }[]
  const hasSampleModified = slicesColumnsUpdated.some(col => col.name === 'sample_modified')
  if (!hasSampleModified) {
    console.log('[DB] Migrating: Adding sample_modified columns to slices table')
    sqlite.exec(`
      ALTER TABLE slices ADD COLUMN sample_modified INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE slices ADD COLUMN sample_modified_at TEXT;
    `)
  }

  // Migration: Add source column to tracks if it doesn't exist
  const tracksColumns = sqlite.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]
  const hasSource = tracksColumns.some(col => col.name === 'source')
  if (!hasSource) {
    console.log('[DB] Migrating: Adding source column to tracks table')
    sqlite.exec("ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube'")
  }

  // Migration: Add original_path and folder_path columns to tracks if they don't exist
  const tracksColumnsUpdated = sqlite.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]
  const hasOriginalPath = tracksColumnsUpdated.some(col => col.name === 'original_path')
  if (!hasOriginalPath) {
    console.log('[DB] Migrating: Adding original_path and folder_path columns to tracks table')
    sqlite.exec(`
      ALTER TABLE tracks ADD COLUMN original_path TEXT;
      ALTER TABLE tracks ADD COLUMN folder_path TEXT;
    `)
  }

  // Migration: Add new audio feature columns if they don't exist
  const audioFeaturesColumns = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasAttackTime = audioFeaturesColumns.some(col => col.name === 'attack_time')
  if (!hasAttackTime) {
    console.log('[DB] Migrating: Adding new audio feature columns (attack_time, spectral_flux, spectral_flatness, kurtosis)')
    sqlite.exec(`
      ALTER TABLE audio_features ADD COLUMN attack_time REAL;
      ALTER TABLE audio_features ADD COLUMN spectral_flux REAL;
      ALTER TABLE audio_features ADD COLUMN spectral_flatness REAL;
      ALTER TABLE audio_features ADD COLUMN kurtosis REAL;
    `)
  }

  // Migration: Add parent_id column to folders if it doesn't exist
  const foldersColumns = sqlite.prepare("PRAGMA table_info(folders)").all() as { name: string }[]
  const hasParentId = foldersColumns.some(col => col.name === 'parent_id')
  if (!hasParentId) {
    console.log('[DB] Migrating: Adding parent_id column to folders table for nested folders')
    sqlite.exec(`
      ALTER TABLE folders ADD COLUMN parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE;
    `)
  }

  // Migration: Add Phase 1 advanced audio features (timbral, perceptual, spectral)
  const audioFeaturesUpdated = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasDissonance = audioFeaturesUpdated.some(col => col.name === 'dissonance')
  if (!hasDissonance) {
    console.log('[DB] Migrating: Adding Phase 1 audio features (timbral, perceptual, spectral)')
    sqlite.exec(`
      -- Timbral features
      ALTER TABLE audio_features ADD COLUMN dissonance REAL;
      ALTER TABLE audio_features ADD COLUMN inharmonicity REAL;
      ALTER TABLE audio_features ADD COLUMN tristimulus TEXT;
      ALTER TABLE audio_features ADD COLUMN spectral_complexity REAL;
      ALTER TABLE audio_features ADD COLUMN spectral_crest REAL;

      -- Perceptual features
      ALTER TABLE audio_features ADD COLUMN brightness REAL;
      ALTER TABLE audio_features ADD COLUMN warmth REAL;
      ALTER TABLE audio_features ADD COLUMN hardness REAL;
      ALTER TABLE audio_features ADD COLUMN roughness REAL;
      ALTER TABLE audio_features ADD COLUMN sharpness REAL;

      -- Advanced spectral features
      ALTER TABLE audio_features ADD COLUMN mel_bands_mean TEXT;
      ALTER TABLE audio_features ADD COLUMN mel_bands_std TEXT;

      -- Analysis level tracking
      ALTER TABLE audio_features ADD COLUMN analysis_level TEXT DEFAULT 'standard';
    `)
  }

  // Migration: Add Phase 2 features (stereo analysis, HPSS)
  const audioFeaturesPhase2 = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasStereoWidth = audioFeaturesPhase2.some(col => col.name === 'stereo_width')
  if (!hasStereoWidth) {
    console.log('[DB] Migrating: Adding Phase 2 audio features (stereo analysis, harmonic/percussive separation)')
    sqlite.exec(`
      -- Stereo analysis features
      ALTER TABLE audio_features ADD COLUMN stereo_width REAL;
      ALTER TABLE audio_features ADD COLUMN panning_center REAL;
      ALTER TABLE audio_features ADD COLUMN stereo_imbalance REAL;

      -- Harmonic/Percussive separation features
      ALTER TABLE audio_features ADD COLUMN harmonic_percussive_ratio REAL;
      ALTER TABLE audio_features ADD COLUMN harmonic_energy REAL;
      ALTER TABLE audio_features ADD COLUMN percussive_energy REAL;
      ALTER TABLE audio_features ADD COLUMN harmonic_centroid REAL;
      ALTER TABLE audio_features ADD COLUMN percussive_centroid REAL;
    `)
  }

  // Migration: Add Phase 3 features (advanced rhythm, ADSR envelope)
  const audioFeaturesPhase3 = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasOnsetRate = audioFeaturesPhase3.some(col => col.name === 'onset_rate')
  if (!hasOnsetRate) {
    console.log('[DB] Migrating: Adding Phase 3 audio features (advanced rhythm, ADSR envelope)')
    sqlite.exec(`
      -- Advanced Rhythm features
      ALTER TABLE audio_features ADD COLUMN onset_rate REAL;
      ALTER TABLE audio_features ADD COLUMN beat_strength REAL;
      ALTER TABLE audio_features ADD COLUMN rhythmic_regularity REAL;
      ALTER TABLE audio_features ADD COLUMN danceability REAL;

      -- ADSR Envelope features
      ALTER TABLE audio_features ADD COLUMN decay_time REAL;
      ALTER TABLE audio_features ADD COLUMN sustain_level REAL;
      ALTER TABLE audio_features ADD COLUMN release_time REAL;
      ALTER TABLE audio_features ADD COLUMN envelope_type TEXT;
    `)
  }

  // Migration: Add Phase 4 features (ML-based instrument & genre classification)
  const audioFeaturesPhase4 = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasInstrumentClasses = audioFeaturesPhase4.some(col => col.name === 'instrument_classes')
  if (!hasInstrumentClasses) {
    console.log('[DB] Migrating: Adding Phase 4 audio features (ML instrument & genre classification)')
    sqlite.exec(`
      -- ML Classification features
      ALTER TABLE audio_features ADD COLUMN instrument_classes TEXT;
      ALTER TABLE audio_features ADD COLUMN genre_classes TEXT;
      ALTER TABLE audio_features ADD COLUMN genre_primary TEXT;
      ALTER TABLE audio_features ADD COLUMN yamnet_embeddings TEXT;
      ALTER TABLE audio_features ADD COLUMN mood_classes TEXT;
    `)
  }

  // Migration: Add Phase 5 features (EBU R128 loudness & sound event detection)
  const audioFeaturesPhase5 = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasLoudnessIntegrated = audioFeaturesPhase5.some(col => col.name === 'loudness_integrated')
  if (!hasLoudnessIntegrated) {
    console.log('[DB] Migrating: Adding Phase 5 audio features (EBU R128 loudness & sound events)')
    sqlite.exec(`
      -- EBU R128 Loudness features
      ALTER TABLE audio_features ADD COLUMN loudness_integrated REAL;
      ALTER TABLE audio_features ADD COLUMN loudness_range REAL;
      ALTER TABLE audio_features ADD COLUMN loudness_momentary_max REAL;
      ALTER TABLE audio_features ADD COLUMN true_peak REAL;

      -- Sound Event Detection features
      ALTER TABLE audio_features ADD COLUMN event_count INTEGER;
      ALTER TABLE audio_features ADD COLUMN event_density REAL;
    `)
  }

  // Migration: Add Phase 6 features (Audio fingerprinting & similarity detection)
  const audioFeaturesPhase6 = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasChromaprintFingerprint = audioFeaturesPhase6.some(col => col.name === 'chromaprint_fingerprint')
  if (!hasChromaprintFingerprint) {
    console.log('[DB] Migrating: Adding Phase 6 audio features (fingerprinting & similarity detection)')
    sqlite.exec(`
      -- Fingerprinting features
      ALTER TABLE audio_features ADD COLUMN chromaprint_fingerprint TEXT;
      ALTER TABLE audio_features ADD COLUMN similarity_hash TEXT;
    `)
  }

  // Migration: Add new analysis features (temporal centroid, crest factor, etc.)
  const audioFeaturesNew = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasTemporalCentroid = audioFeaturesNew.some(col => col.name === 'temporal_centroid')
  if (!hasTemporalCentroid) {
    console.log('[DB] Migrating: Adding new analysis features (temporal centroid, crest factor, etc.)')
    sqlite.exec(`
      ALTER TABLE audio_features ADD COLUMN temporal_centroid REAL;
      ALTER TABLE audio_features ADD COLUMN crest_factor REAL;
      ALTER TABLE audio_features ADD COLUMN transient_spectral_centroid REAL;
      ALTER TABLE audio_features ADD COLUMN transient_spectral_flatness REAL;
      ALTER TABLE audio_features ADD COLUMN sample_type_confidence REAL;
    `)
  }

  // Migration: Add instrument_type to audio_features
  const audioFeaturesInstrType = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasInstrumentType = audioFeaturesInstrType.some(col => col.name === 'instrument_type')
  if (!hasInstrumentType) {
    console.log('[DB] Migrating: Adding instrument_type column to audio_features')
    sqlite.exec(`ALTER TABLE audio_features ADD COLUMN instrument_type TEXT;`)
  }

  // Migration: Add artist and album to tracks
  const tracksArtist = sqlite.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]
  const hasArtist = tracksArtist.some(col => col.name === 'artist')
  if (!hasArtist) {
    console.log('[DB] Migrating: Adding artist and album columns to tracks')
    sqlite.exec(`
      ALTER TABLE tracks ADD COLUMN artist TEXT;
      ALTER TABLE tracks ADD COLUMN album TEXT;
    `)
  }

  // Migration: Add fundamental_frequency to audio_features
  const audioFeaturesFundamental = sqlite.prepare("PRAGMA table_info(audio_features)").all() as { name: string }[]
  const hasFundamentalFrequency = audioFeaturesFundamental.some(col => col.name === 'fundamental_frequency')
  if (!hasFundamentalFrequency) {
    console.log('[DB] Migrating: Adding fundamental_frequency column to audio_features')
    sqlite.exec(`ALTER TABLE audio_features ADD COLUMN fundamental_frequency REAL;`)
  }

  // Migration: Create collections table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `)

  // Migration: Add collection_id column to folders if it doesn't exist
  const foldersColsPersp = sqlite.prepare("PRAGMA table_info(folders)").all() as { name: string }[]
  const hasCollectionId = foldersColsPersp.some(col => col.name === 'collection_id')
  if (!hasCollectionId) {
    console.log('[DB] Migrating: Adding collection_id column to folders table')
    sqlite.exec(`ALTER TABLE folders ADD COLUMN collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE;`)
  }

  // Migration: Create default collection and assign ungrouped folders
  const collectionCount = (sqlite.prepare("SELECT COUNT(*) as count FROM collections").get() as { count: number }).count
  if (collectionCount === 0) {
    const ungroupedCount = (sqlite.prepare("SELECT COUNT(*) as count FROM folders WHERE collection_id IS NULL").get() as { count: number }).count
    if (ungroupedCount > 0 || collectionCount === 0) {
      console.log('[DB] Migrating: Creating default collection and assigning ungrouped folders')
      sqlite.exec(`INSERT INTO collections (name, color, sort_order, created_at) VALUES ('My Folders', '#6366f1', 0, '${new Date().toISOString()}')`)
      const defaultCollection = sqlite.prepare("SELECT id FROM collections WHERE name = 'My Folders' LIMIT 1").get() as { id: number }
      if (defaultCollection) {
        sqlite.exec(`UPDATE folders SET collection_id = ${defaultCollection.id} WHERE collection_id IS NULL`)
      }
    }
  }

  // Migration: Create sync_configs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sync_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `)

  // Migration: Create reanalysis logs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS reanalysis_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slice_id INTEGER NOT NULL REFERENCES slices(id) ON DELETE CASCADE,
      before_tags TEXT NOT NULL DEFAULT '[]',
      after_tags TEXT NOT NULL DEFAULT '[]',
      removed_tags TEXT NOT NULL DEFAULT '[]',
      added_tags TEXT NOT NULL DEFAULT '[]',
      had_potential_custom_state INTEGER NOT NULL DEFAULT 0,
      warning_message TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reanalysis_logs_slice_id ON reanalysis_logs(slice_id);
    CREATE INDEX IF NOT EXISTS idx_reanalysis_logs_created_at ON reanalysis_logs(created_at);
  `)

  return drizzleDb
}

// Getter that initializes on first access
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(target, prop) {
    if (!drizzleDb) {
      initDatabase()
    }
    return (drizzleDb as any)[prop]
  },
})

// For testing: reset the database connection
export function resetDbConnection() {
  if (sqlite) {
    try {
      sqlite.close()
    } catch (e) {
      // Ignore
    }
  }
  sqlite = null
  drizzleDb = null
}

// Get the raw sqlite connection (for testing)
export function getRawDb(): Database.Database {
  if (!sqlite) {
    initDatabase()
  }
  return sqlite!
}

export { schema }
