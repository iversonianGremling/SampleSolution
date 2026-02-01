# Advanced Audio Analysis System - Technical Documentation & Implementation Plan

> **For Future Developers & AI Agents**
>
> This document serves as both a technical reference for the current audio analysis system and a comprehensive implementation plan for advanced features. It includes architecture diagrams, code patterns, library references, and step-by-step implementation guides.

---

## Table of Contents

1. [Current System Architecture](#current-system-architecture)
2. [Technical Stack & Libraries](#technical-stack--libraries)
3. [Data Flow & Integration Patterns](#data-flow--integration-patterns)
4. [Database Schema Reference](#database-schema-reference)
5. [Feature Extraction Methods](#feature-extraction-methods)
6. [Implementation Plan](#implementation-plan)
7. [Code Patterns & Examples](#code-patterns--examples)
8. [Troubleshooting Guide](#troubleshooting-guide)

---

## Current System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React + TS)                   │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │SourcesSample │  │ SampleSpace │  │SourcesDetail     │   │
│  │List/Grid     │  │ View        │  │ Modal            │   │
│  │(Table UI)    │  │(UMAP/t-SNE) │  │(Waveform+Tags)   │   │
│  └──────┬───────┘  └──────┬──────┘  └─────────┬────────┘   │
│         │                  │                    │            │
│         └──────────────────┴────────────────────┘            │
│                            │                                 │
│                   React Query (API Client)                   │
└────────────────────────────┼────────────────────────────────┘
                             │ HTTP/REST
┌────────────────────────────┼────────────────────────────────┐
│                  Backend (Node.js + TypeScript)              │
│                            │                                 │
│  ┌─────────────────────────▼──────────────────────────┐     │
│  │            Express REST API Routes                  │     │
│  │  /slices, /tracks, /tags, /import, /sources        │     │
│  └─────────────────────┬────────────────────────────┬─┘     │
│                        │                            │        │
│         ┌──────────────▼────────────┐    ┌─────────▼──────┐ │
│         │  Audio Analysis Service   │    │  Database      │ │
│         │  - analyzeAudioFeatures() │    │  (SQLite +     │ │
│         │  - storeAudioFeatures()   │    │   Drizzle ORM) │ │
│         │  - featuresToTags()       │    │                │ │
│         └──────────────┬────────────┘    └────────────────┘ │
│                        │                                     │
│                        │ spawn subprocess                    │
│                        ▼                                     │
│         ┌──────────────────────────────┐                    │
│         │   Python Analysis Script     │                    │
│         │   - Librosa (primary)        │                    │
│         │   - Essentia (BPM only)      │                    │
│         │   - Returns JSON features    │                    │
│         └──────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Frontend:**
- **Display Layer**: Shows sample metadata in tables, grids, and detail views
- **Visualization**: 2D scatter plots using dimensionality reduction (UMAP/t-SNE/PCA)
- **Clustering**: Client-side clustering (k-means, DBSCAN) on reduced dimensions
- **Feature Weighting**: User-adjustable weights for different audio features

**Backend API:**
- **Import Management**: Handles YouTube downloads, local file imports, folder imports
- **Slice Management**: Creates and manages audio segments from tracks
- **Tag Management**: Auto-tags based on audio features, user-defined tags
- **Analysis Queue**: Serializes audio analysis tasks to prevent resource exhaustion

**Python Analysis:**
- **Feature Extraction**: Spectral, temporal, energy, rhythm analysis
- **Library Coordination**: Uses Librosa + Essentia for comprehensive analysis
- **Tag Generation**: Converts numeric features to semantic tags
- **Output Format**: JSON with ~30 audio features + suggested tags

**Database:**
- **Schema**: SQLite with Drizzle ORM for type-safe queries
- **Tables**: `tracks`, `slices`, `audioFeatures`, `tags`, junction tables
- **Migrations**: Runtime migrations using PRAGMA checks + ALTER TABLE
- **Relationships**: Cascading deletes, many-to-many tag associations

---

## Technical Stack & Libraries

### Frontend Stack

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| React | ^18.x | UI framework | https://react.dev/ |
| TypeScript | ^5.x | Type safety | https://www.typescriptlang.org/ |
| React Query | ^4.x | Data fetching/caching | https://tanstack.com/query |
| Tailwind CSS | ^3.x | Styling | https://tailwindcss.com/ |
| umap-js | ^1.x | Dimensionality reduction | https://github.com/PAIR-code/umap-js |
| druid.js | ^2.x | PCA, t-SNE | https://github.com/saehm/DruidJS |
| density-clustering | ^1.x | DBSCAN, k-means | https://github.com/uhho/density-clustering |
| Wavesurfer.js | ^7.x | Waveform visualization | https://wavesurfer.xyz/ |

### Backend Stack

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| Node.js | ^20.x | Runtime | https://nodejs.org/ |
| Express | ^4.x | HTTP server | https://expressjs.com/ |
| TypeScript | ^5.x | Type safety | https://www.typescriptlang.org/ |
| Drizzle ORM | ^0.29.x | Database ORM | https://orm.drizzle.team/ |
| better-sqlite3 | ^9.x | SQLite driver | https://github.com/WiseLibs/better-sqlite3 |
| ytdl-core | ^4.x | YouTube downloads | https://github.com/fent/node-ytdl-core |

### Python Stack (Current)

| Library | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| Python | ^3.9 | Runtime | https://python.org/ |
| Librosa | ^0.10.x | Audio analysis (primary) | https://librosa.org/ |
| Essentia | ^2.1.x | Advanced analysis (minimal use) | https://essentia.upf.edu/ |
| NumPy | ^1.24.x | Numerical computing | https://numpy.org/ |
| SoundFile | ^0.12.x | Audio I/O | https://pysoundfile.readthedocs.io/ |

### Python Stack (Planned Additions)

| Library | Version | Purpose | Phase |
|---------|---------|---------|-------|
| TensorFlow | ^2.10.x | ML inference (YAMNet) | Phase 4 |
| TensorFlow Hub | ^0.12.x | Pre-trained models | Phase 4 |
| pyloudnorm | ^0.1.x | EBU R128 loudness | Phase 5 |
| pyacoustid | ^1.x | Audio fingerprinting | Phase 6 |

---

## Data Flow & Integration Patterns

### Audio Import & Analysis Flow

```
1. USER INITIATES IMPORT
   ├─ YouTube URL → ytdl-core downloads MP3
   ├─ Local file → Copy to data/audio/
   └─ Folder → Batch import multiple files
         ↓
2. CREATE TRACK RECORD
   - Store in database: tracks table
   - Status: 'pending' → 'downloading' → 'ready'
         ↓
3. CREATE SLICE RECORD (optional, or user-created later)
   - Extract segment or use full track
   - Generate MP3 file: data/slices/{youtube_id}_{slice_id}.mp3
         ↓
4. QUEUE AUDIO ANALYSIS (AnalysisQueue - serialized)
   - Prevents parallel analysis overload
   - 60s timeout (will increase to 90-120s in future phases)
         ↓
5. SPAWN PYTHON SUBPROCESS
   - Command: python analyze_audio.py <audio_path>
   - Captures stdout (JSON output)
   - Filters TensorFlow warnings
         ↓
6. PYTHON ANALYSIS
   ├─ Load audio (44.1kHz, mono)
   ├─ Extract spectral features (Librosa)
   ├─ Extract energy features (Librosa)
   ├─ Extract tempo/BPM (Essentia RhythmExtractor2013)
   ├─ Detect sample type (one-shot vs loop)
   ├─ Heuristic instrument detection
   └─ Generate suggested tags
         ↓
7. RETURN JSON
   {
     "duration": 2.5,
     "spectral_centroid": 1500.5,
     "bpm": 120.0,
     "suggested_tags": ["kick", "punchy", "120-140bpm"],
     ...
   }
         ↓
8. BACKEND PROCESSING
   ├─ Parse JSON (snake_case → camelCase)
   ├─ Store in audioFeatures table
   ├─ Process tags: create if not exist, link via sliceTags
   └─ Update slice metadata
         ↓
9. FRONTEND REFRESH
   - React Query invalidates cache
   - UI updates with new tags and features
   - Sample appears in Sample Space visualization
```

### Tag Generation Logic

```python
# Python: analyze_audio.py - generate_tags()
def generate_tags(features):
    tags = []

    # Type tags
    if features['is_one_shot']: tags.append('one-shot')
    if features['is_loop']: tags.append('loop')

    # BPM tags (for loops only)
    if features['bpm'] and features['is_loop']:
        bpm = features['bpm']
        if bpm < 80: tags.extend(['slow', '60-80bpm'])
        elif bpm < 100: tags.extend(['downtempo', '80-100bpm'])
        elif bpm < 120: tags.extend(['midtempo', '100-120bpm'])
        elif bpm < 140: tags.extend(['uptempo', '120-140bpm'])
        else: tags.extend(['fast', '140+bpm'])

    # Spectral tags
    centroid = features['spectral_centroid']
    if centroid > 3500: tags.append('bright')
    elif centroid > 1500: tags.append('mid-range')
    else: tags.append('dark')

    # Energy tags
    if features['loudness'] > -10: tags.append('aggressive')
    elif features['loudness'] < -30: tags.append('ambient')

    # Instrument tags (from predictions)
    for pred in features.get('instrument_predictions', []):
        if pred['confidence'] > 0.55:
            tags.append(pred['name'])

    return list(dict.fromkeys(tags))  # Remove duplicates
```

### Database Migration Pattern

```typescript
// Backend: /backend/src/db/index.ts
// Runtime migration example (no migration files)

export function ensureDatabaseSchema(db: Database) {
  // 1. Create initial tables if not exist
  db.exec(`CREATE TABLE IF NOT EXISTS audio_features (...)`);

  // 2. Check for new columns
  const columns = db.prepare("PRAGMA table_info(audio_features)").all();

  // 3. Add columns if missing
  const hasNewColumn = columns.some(col => col.name === 'new_column');
  if (!hasNewColumn) {
    console.log('[DB] Migrating: Adding new_column to audio_features');
    db.exec("ALTER TABLE audio_features ADD COLUMN new_column REAL");
  }

  // Repeat for each new column in each phase
}
```

---

## Database Schema Reference

### Complete Schema (Current + Planned)

#### `tracks` Table
```sql
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  thumbnail_url TEXT NOT NULL,
  duration REAL DEFAULT 0,
  audio_path TEXT,              -- Full path to audio file
  peaks_path TEXT,              -- Waveform peaks JSON
  status TEXT DEFAULT 'pending', -- 'pending'|'downloading'|'ready'|'error'
  source TEXT DEFAULT 'youtube', -- 'youtube'|'local'
  original_path TEXT,           -- For local imports
  folder_path TEXT,             -- For folder imports
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `slices` Table
```sql
CREATE TABLE slices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  file_path TEXT,               -- Path to extracted MP3
  favorite INTEGER DEFAULT 0,   -- Boolean
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### `audio_features` Table (Extended with all planned features)
```sql
CREATE TABLE audio_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slice_id INTEGER NOT NULL UNIQUE REFERENCES slices(id) ON DELETE CASCADE,

  -- Basic Properties
  duration REAL NOT NULL,
  sample_rate INTEGER DEFAULT 44100,
  is_one_shot INTEGER DEFAULT 0,
  is_loop INTEGER DEFAULT 0,

  -- Tempo/Rhythm (Current)
  bpm REAL,
  beats_count INTEGER,
  onset_count INTEGER DEFAULT 0,

  -- Tempo/Rhythm (Phase 3 - Planned)
  onset_rate REAL,
  beat_strength REAL,
  rhythmic_regularity REAL,
  danceability REAL,

  -- Spectral Features (Current)
  spectral_centroid REAL,
  spectral_rolloff REAL,
  spectral_bandwidth REAL,
  spectral_contrast REAL,
  spectral_flux REAL,
  spectral_flatness REAL,
  zero_crossing_rate REAL,
  mfcc_mean TEXT,               -- JSON array

  -- Spectral Features (Phase 1 - Planned)
  spectral_crest REAL,
  mel_bands_mean TEXT,          -- JSON array
  mel_bands_std TEXT,           -- JSON array

  -- Energy/Dynamics (Current)
  rms_energy REAL,
  loudness REAL,
  dynamic_range REAL,

  -- Loudness (Phase 5 - Planned)
  loudness_integrated REAL,     -- EBU R128 LUFS
  loudness_range REAL,          -- EBU R128 LU
  loudness_momentary_max REAL,
  true_peak REAL,               -- dBTP

  -- Temporal Envelope (Current)
  attack_time REAL,
  kurtosis REAL,

  -- Temporal Envelope (Phase 3 - Planned)
  decay_time REAL,
  sustain_level REAL,
  release_time REAL,
  envelope_type TEXT,           -- 'percussive'|'plucked'|'sustained'|'pad'

  -- Key Detection (Current - needs implementation)
  key_estimate TEXT,            -- e.g., "C major"
  key_strength REAL,

  -- Timbral Features (Phase 1 - Planned)
  dissonance REAL,
  inharmonicity REAL,
  tristimulus TEXT,             -- JSON array [t1, t2, t3]
  spectral_complexity REAL,

  -- Perceptual Features (Phase 1 - Planned)
  brightness REAL,
  warmth REAL,
  hardness REAL,
  roughness REAL,
  sharpness REAL,

  -- Stereo Analysis (Phase 2 - Planned)
  stereo_width REAL,
  panning_center REAL,
  stereo_imbalance REAL,

  -- Harmonic/Percussive (Phase 2 - Planned)
  harmonic_percussive_ratio REAL,
  harmonic_energy REAL,
  percussive_energy REAL,
  harmonic_centroid REAL,
  percussive_centroid REAL,

  -- Sound Events (Phase 5 - Planned)
  event_count INTEGER,
  event_density REAL,

  -- Instrument Classification (Current)
  instrument_predictions TEXT,  -- JSON: [{name, confidence}, ...]

  -- ML Classification (Phase 4 - Planned)
  instrument_classes TEXT,      -- JSON: [{class, confidence}, ...]
  genre_classes TEXT,           -- JSON: [{genre, confidence}, ...]
  genre_primary TEXT,
  yamnet_embeddings TEXT,       -- JSON: 1024-dim array for similarity

  -- Fingerprinting (Phase 6 - Planned)
  chromaprint_fingerprint TEXT,
  similarity_hash TEXT,

  -- Metadata
  analysis_version TEXT DEFAULT '1.0',
  analysis_duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_audio_features_slice_id (slice_id)
);
```

#### `tags` Table
```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,          -- Hex color code
  category TEXT DEFAULT 'general'
    -- 'general'|'type'|'tempo'|'spectral'|'energy'|'instrument'
);
```

#### Junction Tables
```sql
-- Track Tags
CREATE TABLE track_tags (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, tag_id)
);

-- Slice Tags
CREATE TABLE slice_tags (
  slice_id INTEGER NOT NULL REFERENCES slices(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (slice_id, tag_id)
);
```

---

## Feature Extraction Methods

### Current Implementation

**Spectral Features (Librosa):**
- `spectral_centroid`: Brightness indicator (weighted mean of frequencies)
- `spectral_rolloff`: Frequency below which 85% of energy is contained
- `spectral_bandwidth`: Width of frequency spectrum
- `spectral_contrast`: Difference between peaks and valleys in spectrum
- `zero_crossing_rate`: Texture/noisiness (how often signal crosses zero)
- `mfcc`: Mel-Frequency Cepstral Coefficients (13 values, timbral texture)

**Energy Features (Librosa):**
- `rms_energy`: Root Mean Square energy (overall loudness)
- `loudness`: RMS converted to dB scale (approximation of perceived loudness)
- `dynamic_range`: Difference between loudest and softest parts

**Rhythm Features (Essentia):**
- `bpm`: Beats per minute (using RhythmExtractor2013, most accurate)
- `beats_count`: Number of beats detected
- `onset_count`: Number of onsets (attack transients)

**Instrument Detection (Heuristic):**
- Rule-based thresholds on spectral/energy features
- Low confidence (50-75%)
- Classes: kick, snare, hihat, bass, synth, vocal, percussion

### Planned Additions

**Phase 1 - Essentia Timbral Features:**
- `Dissonance`: Measures harmonic dissonance (roughness of sound)
- `Inharmonicity`: Deviation from perfect harmonic structure
- `Tristimulus`: 3-value tonal color descriptor (orchestral timbre)
- `SpectralComplexity`: Complexity of spectral envelope
- `Brightness`: Essentia's perceptual brightness (energy > 1500Hz)

**Phase 2 - HPSS (Librosa):**
- `librosa.effects.hpss()`: Separates harmonic and percussive components
- Analyze each independently for better classification

**Phase 3 - ADSR Envelope:**
- Analyze RMS envelope to extract attack/decay/sustain/release times
- Classify envelope type for better organization

**Phase 4 - YAMNet (TensorFlow):**
- 521-class audio event classifier
- Returns 1024-dim embeddings for similarity
- Desktop-runnable (~65MB model)

**Phase 5 - EBU R128 (pyloudnorm):**
- Professional broadcast loudness standard
- Integrated loudness (LUFS), loudness range (LU), true peak (dBTP)

**Phase 6 - Chromaprint (pyacoustid):**
- Acoustic fingerprinting for duplicate detection
- Perceptual hashing for similarity grouping

---

## Implementation Plan

### Overview
Upgrade audio analysis system with advanced Essentia features, ML-based classification, and audio fingerprinting for better tagging, clustering, and similarity detection.

## Priority Implementation Order

### Phase 0: Key Detection & BPM Display (User Priority)
**Goal:** Implement key detection and ensure BPM is displayed in frontend

**Database Changes:**
- Key columns already exist: `key_estimate` (TEXT), `key_strength` (REAL)
- No migration needed, just populate them

**Python Changes** (`/backend/src/python/analyze_audio.py`):
```python
def extract_key_features(y, sr):
    """Extract musical key using Essentia KeyExtractor"""
    if essentia is not None:
        try:
            key_extractor = es.KeyExtractor()
            key, scale, strength = key_extractor(y.astype('float32'))
            return {
                'key_estimate': f"{key} {scale}",  # e.g., "C major"
                'key_strength': float(strength)
            }
        except:
            pass
    return {'key_estimate': None, 'key_strength': None}
```
- Call in `analyze_audio()` after spectral features
- Return in features dict

**Frontend Changes:**
1. **Types** (`/frontend/src/types/index.ts`):
   - `AudioFeatures` interface already has `keyEstimate?` and `keyStrength?`
   - Verify BPM is included

2. **Display Components** (`/frontend/src/components/SourcesSampleList.tsx`, `SourcesSampleListRow.tsx`):
   - Add BPM column (already in data, just not displayed)
   - Add Key column
   - Format: BPM as integer, Key as string (e.g., "C major")

3. **API** - No changes needed, `/slices/features` already returns these fields

**Estimated Time:** 2-3 days

---

### Phase 1: Enhanced Timbral & Perceptual Features
**Goal:** Add Essentia's advanced timbral and perceptual features for rich tagging/clustering

**Features to Add:**

**Advanced Timbral Features:**
- `dissonance` - Harmonic dissonance (Essentia `Dissonance`)
- `inharmonicity` - Deviation from harmonic structure (Essentia `Inharmonicity`)
- `tristimulus` - 3-value tonal color (Essentia `Tristimulus`) - store as JSON
- `spectral_complexity` - Spectral envelope complexity (Essentia `SpectralComplexity`)
- `spectral_crest` - Spectral peakiness (Essentia `Crest`)

**Perceptual Features:**
- `brightness` - Energy above 1500Hz (Essentia `Brightness`)
- `warmth` - Low-frequency energy ratio (derived)
- `hardness` - Attack + brightness combination (derived)
- `roughness` - Based on dissonance (derived)
- `sharpness` - Spectral centroid-based (derived)

**Advanced Spectral Features:**
- `mel_bands_mean` - Mean of 40 mel bands (JSON array)
- `mel_bands_std` - Std dev of mel bands (JSON array)

**Database Migration** (`/backend/src/db/index.ts`):
```sql
ALTER TABLE audio_features ADD COLUMN dissonance REAL;
ALTER TABLE audio_features ADD COLUMN inharmonicity REAL;
ALTER TABLE audio_features ADD COLUMN tristimulus TEXT;
ALTER TABLE audio_features ADD COLUMN spectral_complexity REAL;
ALTER TABLE audio_features ADD COLUMN brightness REAL;
ALTER TABLE audio_features ADD COLUMN warmth REAL;
ALTER TABLE audio_features ADD COLUMN hardness REAL;
ALTER TABLE audio_features ADD COLUMN roughness REAL;
ALTER TABLE audio_features ADD COLUMN sharpness REAL;
ALTER TABLE audio_features ADD COLUMN spectral_crest REAL;
ALTER TABLE audio_features ADD COLUMN mel_bands_mean TEXT;
ALTER TABLE audio_features ADD COLUMN mel_bands_std TEXT;
```

**Python Functions** (`/backend/src/python/analyze_audio.py`):
- `extract_timbral_features_essentia(y, sr)` - Use Essentia extractors
- `extract_perceptual_features(spectral, energy, timbral)` - Derive features
- Update `extract_spectral_features()` - Add mel-spectrogram stats

**Tag Generation** (`featuresToTags()` in Python and TypeScript):
```python
if brightness > 0.7: tags.append('bright')
elif brightness < 0.3: tags.append('dull')
if warmth > 0.7: tags.append('warm')
elif warmth < 0.3: tags.append('cold')
if hardness > 0.7: tags.append('hard')
if dissonance > 0.6: tags.append('dissonant')
if spectral_complexity > 0.7: tags.append('complex')
```

**Frontend Changes:**
- Update `AudioFeatures` interface in `/frontend/src/types/index.ts`
- Add to feature matrix in `/frontend/src/utils/featureMatrix.ts`:
  - New group: `perceptual` (brightness, warmth, hardness, roughness, sharpness)
  - New group: `timbral` (dissonance, inharmonicity, spectral_complexity)

**Performance:** Increase Python timeout from 60s to 90s in `/backend/src/services/audioAnalysis.ts`

**Estimated Time:** 1-2 weeks

---

### Phase 2: Stereo Analysis & Harmonic/Percussive Separation
**Goal:** Analyze stereo characteristics and separate harmonic/percussive components

**Stereo Features:**
- `stereo_width` - L/R correlation (1 - |correlation|)
- `panning_center` - Dominant panning (0=left, 0.5=center, 1=right)
- `stereo_imbalance` - Energy difference between channels

**Harmonic/Percussive Features:**
- `harmonic_percussive_ratio` - Harmonic vs percussive energy
- `harmonic_energy`, `percussive_energy` - Component energies
- `harmonic_centroid`, `percussive_centroid` - Spectral centroid of each

**Database Migration:**
```sql
ALTER TABLE audio_features ADD COLUMN stereo_width REAL;
ALTER TABLE audio_features ADD COLUMN panning_center REAL;
ALTER TABLE audio_features ADD COLUMN stereo_imbalance REAL;
ALTER TABLE audio_features ADD COLUMN harmonic_percussive_ratio REAL;
ALTER TABLE audio_features ADD COLUMN harmonic_energy REAL;
ALTER TABLE audio_features ADD COLUMN percussive_energy REAL;
ALTER TABLE audio_features ADD COLUMN harmonic_centroid REAL;
ALTER TABLE audio_features ADD COLUMN percussive_centroid REAL;
```

**Python Functions:**
- `extract_stereo_features(audio_path, sr)` - Load stereo, calculate width/panning/imbalance
- `extract_hpss_features(y, sr)` - Use `librosa.effects.hpss()`, analyze components

**Tags:**
```python
if stereo_width > 0.6: tags.append('wide-stereo')
if harmonic_percussive_ratio > 3.0: tags.append('harmonic')
elif harmonic_percussive_ratio < 0.3: tags.append('percussive')
```

**Frontend:** Add to feature matrix (new groups: `stereo`, `harmonic`)

**Estimated Time:** 1 week

---

### Phase 3: Advanced Rhythm & Temporal Envelope (ADSR)
**Goal:** Enhanced rhythm detection and detailed envelope analysis

**Rhythm Features:**
- `onset_rate` - Onsets per second
- `beat_strength` - Onset envelope strength
- `rhythmic_regularity` - Variance in onset intervals
- `danceability` - Tempo + beat strength + regularity

**ADSR Envelope:**
- `attack_time` - Already in schema, ensure calculation
- `decay_time` - Peak to sustain
- `sustain_level` - Relative sustain
- `release_time` - Tail decay
- `envelope_type` - Classification: 'percussive'|'plucked'|'sustained'|'pad'

**Database Migration:**
```sql
ALTER TABLE audio_features ADD COLUMN onset_rate REAL;
ALTER TABLE audio_features ADD COLUMN beat_strength REAL;
ALTER TABLE audio_features ADD COLUMN rhythmic_regularity REAL;
ALTER TABLE audio_features ADD COLUMN danceability REAL;
ALTER TABLE audio_features ADD COLUMN decay_time REAL;
ALTER TABLE audio_features ADD COLUMN sustain_level REAL;
ALTER TABLE audio_features ADD COLUMN release_time REAL;
ALTER TABLE audio_features ADD COLUMN envelope_type TEXT;
```

**Python Functions:**
- `extract_rhythm_features(y, sr, duration, tempo)` - Calculate rhythm metrics
- `extract_adsr_envelope(y, sr)` - Analyze RMS envelope, classify type

**Tags:**
```python
if danceability > 0.7: tags.append('danceable')
if envelope_type == 'percussive': tags.append('percussive-envelope')
elif envelope_type == 'sustained': tags.append('sustained')
```

**Frontend:**
- Display `envelope_type` in sample table
- Add to feature matrix (new group: `rhythm`, `envelope`)

**Estimated Time:** 1 week

---

### Phase 4: ML-Based Instrument & Genre Classification
**Goal:** Replace heuristics with ML models. Desktop-runnable only.

**Models:**

**Instrument Recognition - YAMNet:**
- TensorFlow Hub model: https://tfhub.dev/google/yamnet/1
- 521 audio event classes (includes instruments)
- Size: ~65MB
- Returns: class predictions + 1024-dim embeddings
- Filter for instrument-related classes

**Genre Classification:**
- Option A: Essentia MusicExtractor (pre-trained)
- Option B: Lightweight CNN on mel-spectrograms

**Database Migration:**
```sql
ALTER TABLE audio_features ADD COLUMN instrument_classes TEXT; -- JSON
ALTER TABLE audio_features ADD COLUMN genre_classes TEXT; -- JSON
ALTER TABLE audio_features ADD COLUMN genre_primary TEXT;
ALTER TABLE audio_features ADD COLUMN yamnet_embeddings TEXT; -- For similarity
```

**Python Changes:**
- Add to `requirements.txt`: `tensorflow>=2.10.0`, `tensorflow-hub>=0.12.0`
- `extract_instrument_ml(audio_path, y, sr)` - YAMNet inference, filter instruments, return top 5 + embeddings
- `extract_genre_ml(y, sr)` - Genre classification
- Model caching: Load once globally, reuse

**Tags:**
```python
# Use ML predictions instead of heuristics
for instrument in instrument_classes:
    if instrument['confidence'] > 0.6:
        tags.append(instrument['class'])

if genre_primary:
    tags.append(genre_primary.lower())
```

**Performance:** Increase timeout to 120s

**Frontend:**
- Display top instrument and genre in table
- Show all predictions in detail modal
- Use YAMNet embeddings for clustering

**Estimated Time:** 2-3 weeks

---

### Phase 5: EBU R128 Loudness & Sound Event Detection
**Goal:** Professional loudness standards and event detection

**Features:**

**EBU R128 Loudness:**
- `loudness_integrated` - Integrated loudness (LUFS)
- `loudness_range` - Loudness range (LU)
- `loudness_momentary_max` - Peak momentary loudness
- `true_peak` - True peak level (dBTP)

**Event Detection:**
- `event_count` - Number of discrete events
- `event_density` - Events per second

**Database Migration:**
```sql
ALTER TABLE audio_features ADD COLUMN loudness_integrated REAL;
ALTER TABLE audio_features ADD COLUMN loudness_range REAL;
ALTER TABLE audio_features ADD COLUMN loudness_momentary_max REAL;
ALTER TABLE audio_features ADD COLUMN true_peak REAL;
ALTER TABLE audio_features ADD COLUMN event_count INTEGER;
ALTER TABLE audio_features ADD COLUMN event_density REAL;
```

**Python Changes:**
- Add to `requirements.txt`: `pyloudnorm>=0.1.0`
- `extract_loudness_ebu(y, sr)` - Use `pyloudnorm.Meter`
- `detect_sound_events(y, sr, duration)` - Onset detection with strict threshold

**Frontend:** Add to feature matrix (loudness for clustering)

**Estimated Time:** 1 week

---

### Phase 6: Audio Fingerprinting & Similarity Detection
**Goal:** Duplicate detection and similarity-based hierarchical organization

**Features:**

**Fingerprinting:**
- `chromaprint_fingerprint` - Acoustic fingerprint for duplicates
- `similarity_hash` - 32-bit perceptual hash from mel-spectrogram

**Similarity:**
- Use YAMNet embeddings (from Phase 4)
- Cosine similarity between embeddings

**Database Migration:**
```sql
ALTER TABLE audio_features ADD COLUMN chromaprint_fingerprint TEXT;
ALTER TABLE audio_features ADD COLUMN similarity_hash TEXT;
```

**Python Changes:**
- Add to `requirements.txt`: `pyacoustid`
- `extract_fingerprint(audio_path)` - Chromaprint + perceptual hash

**Backend API** (`/backend/src/routes/slices.ts`):
```typescript
// New endpoints
GET /api/slices/:id/similar?limit=20
  - Calculate cosine similarity on YAMNet embeddings
  - Return top N similar samples

GET /api/slices/duplicates
  - Group by similarity_hash
  - Return potential duplicates

GET /api/slices/hierarchy
  - Build hierarchy based on similarity clusters
  - Return tree structure for organization
```

**Frontend:**
- "Similar Samples" section in detail modal
- "Find Duplicates" action in sources view
- Similarity-based auto-collection feature

**Estimated Time:** 2 weeks

---

### Phase 7: Frontend UI Enhancements
**Goal:** Display all new features, add filtering/visualization

**Components to Update:**

1. **SourcesSampleList.tsx / SourcesSampleListRow.tsx:**
   - Add columns: BPM, Key, Envelope Type, Primary Genre, Primary Instrument
   - Make sortable where appropriate

2. **SourcesFeatureFilter.tsx (NEW):**
   - BPM range slider
   - Key dropdown
   - Envelope type checkboxes
   - Perceptual sliders (warmth, brightness, hardness)
   - Instrument/genre checkboxes
   - Applied filters affect sample list and space view

3. **SourcesDetailModal.tsx:**
   - Add tabs: Spectral, Rhythm, Perceptual, Classification, Similar
   - Spectral: Frequency spectrum visualization
   - Rhythm: ADSR envelope visualization
   - Perceptual: Radar chart (brightness, warmth, hardness, etc.)
   - Classification: Confidence bars for instruments/genres
   - Similar: List of similar samples with play buttons

4. **featureMatrix.ts:**
   - Add all ~50 new features
   - New feature groups: perceptual, timbral, envelope, rhythm, stereo, harmonic
   - Update `DEFAULT_WEIGHTS`, `FEATURE_LABELS`, `getFeatureValue()`

5. **FeatureWeightsPanel.tsx:**
   - Group features by category (collapsible sections)
   - Preset buttons: "Perceptual Focus", "Rhythm Focus", "Spectral Focus"

**Estimated Time:** 2-3 weeks (can parallel with Phases 4-6)

---

## Critical Files Summary

### Backend Python
- `/backend/src/python/analyze_audio.py` - All feature extraction (main changes)
- `/backend/requirements.txt` - New dependencies

### Backend TypeScript
- `/backend/src/db/index.ts` - Database migrations for each phase
- `/backend/src/db/schema.ts` - Schema type definitions (update as needed)
- `/backend/src/services/audioAnalysis.ts` - Timeout adjustments, type updates
- `/backend/src/routes/slices.ts` - Similarity API endpoints (Phase 6)

### Frontend
- `/frontend/src/types/index.ts` - AudioFeatures interface updates
- `/frontend/src/components/SourcesSampleList.tsx` - Table columns
- `/frontend/src/components/SourcesSampleListRow.tsx` - Row display
- `/frontend/src/components/SourcesDetailModal.tsx` - Detail enhancements
- `/frontend/src/components/SourcesFeatureFilter.tsx` - NEW filter component
- `/frontend/src/utils/featureMatrix.ts` - Feature integration for clustering
- `/frontend/src/utils/enrichAudioFeatures.ts` - May need updates

---

## Implementation Strategy

### Execution Order:
1. **Phase 0** (3 days) - Key & BPM display - **PRIORITY**
2. **Phase 1** (1-2 weeks) - Essentia timbral/perceptual foundation
3. **Phase 2** (1 week) - Stereo + HPSS
4. **Phase 3** (1 week) - Rhythm + ADSR
5. **Phase 4** (2-3 weeks) - ML models - **MOST COMPLEX**
6. **Phase 5** (1 week) - EBU R128 + Events
7. **Phase 6** (2 weeks) - Fingerprinting + Similarity
8. **Phase 7** (2-3 weeks) - Frontend UI (parallel with 4-6)

**Total Time: ~3 months**

### Performance Considerations:
- Python timeout progression: 60s → 90s (Phase 1) → 120s (Phase 4)
- ML model caching (load once, reuse)
- Parallel feature extraction where possible
- Incremental analysis: Track `analysis_version`, only re-analyze on version bump

### Backward Compatibility:
- All new columns are nullable
- Existing samples work without re-analysis
- Frontend gracefully handles missing features
- Runtime migrations check for column existence

---

## Verification & Testing

After each phase:

1. **Database Verification:**
   - Check new columns exist: `sqlite3 data/database.sqlite ".schema audio_features"`
   - Verify sample has features: `SELECT * FROM audio_features WHERE slice_id = 1`

2. **Python Analysis Test:**
   ```bash
   cd backend/src/python
   python analyze_audio.py /path/to/test.mp3
   # Verify JSON output has new fields
   ```

3. **Frontend Display:**
   - Import sample, check table shows new columns
   - Open detail modal, verify new tabs/visualizations
   - Check feature matrix includes new features

4. **End-to-End:**
   - Import audio file/folder
   - Wait for analysis completion
   - Verify tags generated correctly
   - Check Sample Space clustering uses new features
   - Test similarity search (Phase 6)

---

---

## Code Patterns & Examples

### Adding a New Audio Feature (Complete Example)

**Step 1: Python Analysis Function**
```python
# /backend/src/python/analyze_audio.py

def extract_new_feature(y, sr):
    """
    Extract new audio feature
    Args:
        y: Audio time series (mono, float32)
        sr: Sample rate (typically 44100)
    Returns:
        dict: Feature values
    """
    try:
        # Example: Using Essentia
        if essentia is not None:
            extractor = es.FeatureExtractor()
            result = extractor(y.astype('float32'))
            return {'new_feature': float(result)}

        # Fallback: Using Librosa
        feature_value = some_librosa_function(y=y, sr=sr)
        return {'new_feature': float(np.mean(feature_value))}

    except Exception as e:
        print(f"Warning: new_feature extraction failed: {e}", file=sys.stderr)
        return {'new_feature': None}

# Add to analyze_audio() main function
def analyze_audio(audio_path):
    # ... existing code ...

    new_feature_data = extract_new_feature(y, sr)

    features = {
        **basic,
        **spectral,
        **energy,
        **new_feature_data,  # Add here
        # ...
    }

    return features
```

**Step 2: Database Migration**
```typescript
// /backend/src/db/index.ts

export function ensureDatabaseSchema(db: Database) {
  // ... existing migrations ...

  // Add new column
  const audioFeaturesColumns = db.prepare("PRAGMA table_info(audio_features)").all();
  const hasNewFeature = audioFeaturesColumns.some(col => col.name === 'new_feature');

  if (!hasNewFeature) {
    console.log('[DB] Migrating: Adding new_feature to audio_features');
    db.exec("ALTER TABLE audio_features ADD COLUMN new_feature REAL");
  }
}
```

**Step 3: TypeScript Type Definition**
```typescript
// /frontend/src/types/index.ts

export interface AudioFeatures {
  // ... existing fields ...
  newFeature?: number;
}

// Backend type (if different naming)
// /backend/src/services/audioAnalysis.ts
interface AudioFeaturesDB {
  // ... existing fields ...
  new_feature?: number;
}
```

**Step 4: Frontend Feature Matrix**
```typescript
// /frontend/src/utils/featureMatrix.ts

export const DEFAULT_WEIGHTS: Record<string, number> = {
  // ... existing weights ...
  newFeature: 1.0,
};

export const FEATURE_LABELS: Record<string, string> = {
  // ... existing labels ...
  newFeature: 'New Feature',
};

export const FEATURE_GROUPS: Record<string, string[]> = {
  // ... existing groups ...
  custom: ['newFeature'],
};

export function getFeatureValue(
  feature: string,
  audioFeatures: AudioFeaturesWithMetadata
): number | undefined {
  // ... existing features ...
  if (feature === 'newFeature') return audioFeatures.newFeature;
  return undefined;
}
```

**Step 5: Tag Generation (Optional)**
```python
# /backend/src/python/analyze_audio.py - generate_tags()

def generate_tags(features):
    tags = []
    # ... existing tag logic ...

    # New feature tags
    new_feature = features.get('new_feature', 0)
    if new_feature > 0.8:
        tags.append('high-new-feature')
    elif new_feature < 0.2:
        tags.append('low-new-feature')

    return list(dict.fromkeys(tags))
```

### Frontend Display Pattern

**Adding Column to Sample List:**
```tsx
// /frontend/src/components/SourcesSampleListRow.tsx

export function SourcesSampleListRow({ sample, /* ... */ }: Props) {
  return (
    <div className="flex items-center gap-2">
      {/* ... existing columns ... */}

      {/* New column */}
      <span className="w-20 flex-shrink-0 text-right">
        <span className="text-xs text-slate-400">
          {sample.newFeature !== undefined
            ? sample.newFeature.toFixed(2)
            : '-'}
        </span>
      </span>

      {/* ... rest of row ... */}
    </div>
  );
}
```

**Adding to Detail Modal:**
```tsx
// /frontend/src/components/SourcesDetailModal.tsx

export function SourcesDetailModal({ slice }: Props) {
  return (
    <div>
      {/* ... existing content ... */}

      <div className="mt-4">
        <h3 className="text-sm font-medium">Audio Features</h3>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {/* ... existing features ... */}

          <div>
            <span className="text-xs text-slate-500">New Feature</span>
            <span className="block text-sm font-medium">
              {slice.audioFeatures?.newFeature?.toFixed(2) ?? 'N/A'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### API Endpoint Pattern

**Adding Similarity Endpoint (Phase 6 Example):**
```typescript
// /backend/src/routes/slices.ts

import { db } from '../db';
import { audioFeatures } from '../db/schema';
import { eq } from 'drizzle-orm';

// GET /api/slices/:id/similar
router.get('/:id/similar', async (req, res) => {
  try {
    const sliceId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 20;

    // Get target slice embeddings
    const targetFeatures = await db
      .select()
      .from(audioFeatures)
      .where(eq(audioFeatures.sliceId, sliceId))
      .get();

    if (!targetFeatures?.yamnetEmbeddings) {
      return res.status(404).json({ error: 'No embeddings found' });
    }

    const targetEmb = JSON.parse(targetFeatures.yamnetEmbeddings);

    // Get all other slices with embeddings
    const allFeatures = await db
      .select()
      .from(audioFeatures)
      .where(/* not target slice */)
      .all();

    // Calculate cosine similarity
    const similarities = allFeatures
      .filter(f => f.yamnetEmbeddings)
      .map(f => {
        const emb = JSON.parse(f.yamnetEmbeddings!);
        const similarity = cosineSimilarity(targetEmb, emb);
        return { sliceId: f.sliceId, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // Join with slice data
    const results = await Promise.all(
      similarities.map(async ({ sliceId, similarity }) => {
        const slice = await getSliceWithTrack(sliceId);
        return { ...slice, similarity };
      })
    );

    res.json(results);
  } catch (error) {
    console.error('Error finding similar slices:', error);
    res.status(500).json({ error: 'Failed to find similar slices' });
  }
});

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magA * magB);
}
```

### Batch Re-Analysis Script

```typescript
// /backend/src/scripts/reanalyze-all.ts
// Run with: npx tsx src/scripts/reanalyze-all.ts

import { db } from '../db';
import { slices, audioFeatures } from '../db/schema';
import { analyzeAudioFeatures, storeAudioFeatures } from '../services/audioAnalysis';
import { eq } from 'drizzle-orm';

async function reanalyzeAll() {
  const allSlices = await db.select().from(slices).all();

  console.log(`Re-analyzing ${allSlices.length} slices...`);

  for (const slice of allSlices) {
    try {
      console.log(`Analyzing slice ${slice.id}: ${slice.name}`);

      // Re-run analysis
      const features = await analyzeAudioFeatures(slice.filePath!);

      // Update database
      await storeAudioFeatures(slice.id, features);

      console.log(`✓ Completed slice ${slice.id}`);
    } catch (error) {
      console.error(`✗ Failed slice ${slice.id}:`, error);
    }

    // Rate limit (avoid overwhelming system)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('Re-analysis complete!');
}

reanalyzeAll().catch(console.error);
```

---

## Troubleshooting Guide

### Common Issues & Solutions

#### **Issue: Python analysis timeout**

**Symptoms:**
- Analysis fails after 60s
- Error: "Python process timeout"

**Solutions:**
1. Increase timeout in `/backend/src/services/audioAnalysis.ts`:
   ```typescript
   const result = await analyzeAudioFeatures(audioPath, { timeout: 120000 }); // 120s
   ```

2. Check for hanging Python process:
   ```bash
   ps aux | grep analyze_audio.py
   kill -9 <pid>
   ```

3. Reduce audio file size:
   - Convert to lower sample rate (22050Hz)
   - Trim to shorter duration for testing

#### **Issue: Essentia import error in Python**

**Symptoms:**
- Analysis runs but BPM is always null
- Python warning: "Essentia not available"

**Solutions:**
1. Install Essentia:
   ```bash
   cd backend
   pip install essentia
   # or
   conda install -c mtg essentia
   ```

2. Verify installation:
   ```bash
   python -c "import essentia; print(essentia.__version__)"
   ```

3. Check Python environment:
   - Ensure backend uses same Python as where Essentia is installed
   - Check `which python` vs configured Python path

#### **Issue: Database migration not running**

**Symptoms:**
- New column doesn't appear in database
- Queries fail with "no such column" error

**Solutions:**
1. Verify migration code is executed on startup:
   ```typescript
   // /backend/src/db/index.ts
   ensureDatabaseSchema(db); // This should run
   ```

2. Manually check database schema:
   ```bash
   sqlite3 data/database.sqlite ".schema audio_features"
   ```

3. Force migration by restarting backend:
   ```bash
   cd backend
   npm run dev
   ```

4. If stuck, manually add column:
   ```bash
   sqlite3 data/database.sqlite
   > ALTER TABLE audio_features ADD COLUMN new_column REAL;
   > .quit
   ```

#### **Issue: Frontend not showing new features**

**Symptoms:**
- API returns features but UI doesn't display them
- TypeScript errors in console

**Solutions:**
1. Update TypeScript types in `/frontend/src/types/index.ts`

2. Clear React Query cache:
   ```typescript
   queryClient.invalidateQueries(['allSlices']);
   ```

3. Check browser console for errors

4. Verify API response format:
   ```bash
   curl http://localhost:3000/api/slices/features | jq
   ```

#### **Issue: YAMNet model download fails (Phase 4)**

**Symptoms:**
- First analysis hangs indefinitely
- Error: "Failed to download model"

**Solutions:**
1. Pre-download model:
   ```python
   import tensorflow_hub as hub
   model = hub.load('https://tfhub.dev/google/yamnet/1')
   # Model cached at ~/.cache/tfhub_modules/
   ```

2. Use offline model:
   - Download model manually
   - Point to local path instead of URL

3. Check network/firewall:
   - Ensure TensorFlow Hub can access internet
   - Check proxy settings if behind corporate firewall

#### **Issue: Memory issues with ML models**

**Symptoms:**
- Backend crashes after multiple analyses
- Error: "JavaScript heap out of memory"

**Solutions:**
1. Increase Node.js heap size:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run dev
   ```

2. Implement model caching in Python (load once, reuse):
   ```python
   # Global model cache
   _yamnet_model = None

   def get_yamnet_model():
       global _yamnet_model
       if _yamnet_model is None:
           _yamnet_model = hub.load('...')
       return _yamnet_model
   ```

3. Limit concurrent analyses (already done via AnalysisQueue)

#### **Issue: Frontend clustering too slow**

**Symptoms:**
- Sample Space view takes >10s to load
- Browser becomes unresponsive

**Solutions:**
1. Reduce sample count with filtering

2. Optimize feature matrix calculation:
   ```typescript
   // Use memoization
   const featureMatrix = useMemo(
     () => buildFeatureMatrix(samples, weights),
     [samples, weights]
   );
   ```

3. Consider backend clustering for large datasets (future enhancement)

4. Use Web Workers for expensive calculations

#### **Issue: Tags not generating correctly**

**Symptoms:**
- Analysis completes but no tags created
- Tags array is empty

**Solutions:**
1. Check Python output:
   ```bash
   python backend/src/python/analyze_audio.py test.mp3 | jq '.suggested_tags'
   ```

2. Verify `featuresToTags()` logic:
   - Check threshold values
   - Ensure features are in expected ranges

3. Check tag creation in backend:
   - Look for errors in backend logs
   - Verify tags table has entries:
     ```bash
     sqlite3 data/database.sqlite "SELECT * FROM tags;"
     ```

### Performance Benchmarks

**Current System (Phase 0):**
- Analysis time: 2-5s per sample (1-3s audio)
- Memory usage: ~200MB Python process
- Throughput: ~12-30 samples/minute (serialized)

**Expected After Phase 4 (ML Models):**
- Analysis time: 5-15s per sample (first run: +10s for model load)
- Memory usage: ~800MB Python process (TensorFlow + models)
- Throughput: ~4-12 samples/minute

**Optimization Tips:**
- Batch analysis: Process folder imports in single Python session (reuse model)
- Parallel processing: Run multiple Python processes for independent batches
- Feature caching: Store intermediate results (spectrograms) for re-analysis

---

## Notes

- Keep existing heuristic instrument detection as fallback if ML fails
- YAMNet embeddings are crucial for similarity - prioritize Phase 4 for Phase 6
- Frontend clustering stays client-side (no backend changes needed)
- Consider batch re-analysis script for existing samples after each phase
- Monitor Python process memory usage with ML models loaded
- This document should be updated as implementation progresses
- For questions or issues, refer to library documentation links in Technical Stack section
