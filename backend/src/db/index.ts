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

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_slices (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      slice_id INTEGER NOT NULL REFERENCES slices(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, slice_id)
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

  // Migration: Add source column to tracks if it doesn't exist
  const tracksColumns = sqlite.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]
  const hasSource = tracksColumns.some(col => col.name === 'source')
  if (!hasSource) {
    console.log('[DB] Migrating: Adding source column to tracks table')
    sqlite.exec("ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'youtube'")
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
