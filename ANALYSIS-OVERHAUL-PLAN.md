# Audio Analysis Overhaul — Implementation Plan

> Comprehensive plan for rewriting the audio analysis pipeline. Written for future reference and continuity across sessions.

## Context

The current `analyze_audio.py` has critical issues: broken one-shot/loop detection (`duration > 3.0` = always loop), terrible percussion instrument classification (claps/rides/snares constantly mislabeled), no audio preprocessing (DC offset, normalization), heuristic-based genre with hardcoded thresholds, redundant similarity hash (YAMNet embeddings are strictly better), and no filename-based tagging despite filenames being the most reliable source of sample type information. The clustering pipeline uses k-means (requires knowing k) with min-max normalization (outlier-sensitive) and uniform feature weights (no discriminative weighting).

This plan rewrites the analysis foundation, adds filename-based tagging as the primary classification method, introduces academically-validated features for percussion discrimination, replaces min-max with robust scaling, adds HDBSCAN clustering, and implements LMNN metric learning for optimal feature weights.

### Academic References

| Method | Reference | Used for |
|---|---|---|
| HPSS transient analysis | Fitzgerald (2010) "Harmonic/Percussive Separation" | Percussion subtype classification |
| HDBSCAN | Campello, Moulavi & Sander (2013) | Variable-density clustering without k |
| LMNN | Weinberger & Saul (2009) "Distance Metric Learning for Large Margin NN" | Optimal feature weight learning |
| Robust scaling | Standard sklearn preprocessing | Outlier-resistant normalization |
| Spectral flatness / Wiener entropy | Johnston (1988), standardized in MPEG-7 | Tonal vs noisy discrimination |
| Temporal centroid | Peeters (2004) "A large set of audio features" | Energy distribution in time |
| Onset periodicity autocorrelation | Ellis (2007) "Beat Tracking by Dynamic Programming" | Loop detection |
| MFCC-based timbre description | Logan (2000) "Mel Frequency Cepstral Coefficients" | Timbral similarity |
| Self-similarity / start-end correlation | Foote (2000), Muller (2015) "Fundamentals of MIR" | Loop detection, structure analysis |

---

## Architecture Overview

```
Import Flow (new):
  File upload → Parse filename/folder for tags (instant) → Queue audio analysis → Python subprocess

Analysis Flow (modified):
  Load audio → Preprocess (DC removal, normalize, trim) → Multi-evidence sample type detection
  → Spectral features → Energy features → NEW additional features (flux, flatness, temporal centroid, crest)
  → Key detection → Tempo (loops only) → HPSS → NEW transient features (from percussive component)
  → Timbral features (Essentia) → Perceptual features → Stereo → Rhythm → ADSR
  → YAMNet (if available) → NEW percussion subtype classifier → Genre (loops only) → Tags

Visualization Flow (modified):
  Features → Robust scaling (not min-max) → Weighted matrix (MIR-informed defaults or LMNN-learned)
  → UMAP/t-SNE/PCA → HDBSCAN/DBSCAN/k-means → WebGL scatter
```

---

## Phase 1: Python — Preprocessing + Bug Fixes + New Features + Improved Detection

All changes in `/backend/src/python/analyze_audio.py` (1789 lines).

**Test**: `python analyze_audio.py <sample.wav> --level advanced --filename <name.wav>` → verify JSON output.

### 1.1 Add audio preprocessing

**Location**: New function, called in `analyze_audio()` immediately after `librosa.load()` (line 77), before `detect_sample_type()`.

```python
def preprocess_audio(y, sr):
    """Preprocess audio: DC offset removal, silence trimming, peak normalization."""
    y_original = y.copy()          # Keep for EBU R128 (needs absolute levels)
    y = y - np.mean(y)             # DC offset removal
    y, trim_idx = librosa.effects.trim(y, top_db=30)  # Silence trimming
    peak = np.max(np.abs(y))
    if peak > 1e-8:
        y = y / peak               # Peak normalization
    return y, y_original, trim_idx
```

Modify `analyze_audio()`:
- Call `y, y_original, trim_idx = preprocess_audio(y, sr)` after load
- Recalculate `duration = librosa.get_duration(y=y, sr=sr)` on trimmed signal
- Pass `y_original` to `extract_loudness_ebu()` (LUFS is an absolute measurement)
- Store original duration as `duration_original` in features for reference

### 1.2 Rewrite `detect_sample_type()` — Multi-evidence voting

**Location**: Replace function at lines 249-283.

New signature: `detect_sample_type(y, sr, duration, filename=None)` returning `(is_one_shot, is_loop, confidence)`

Evidence signals:

| Evidence | Weight | One-shot signal | Loop signal |
|---|---|---|---|
| RMS envelope decay | 2.0 | Peak in first 30% of signal AND peak/tail_mean ratio > 4x | Flat or periodic RMS envelope |
| RMS inverted envelope | 1.0 | Peak in last 20% of signal → riser one-shot | — |
| Start-end correlation | 1.5 | `np.correlate(first_100ms, last_100ms)` < 0.3 | Correlation > 0.7 (seamless loop point) |
| Onset periodicity | 1.5 | No peaks in autocorrelation of onset strength envelope | Clear periodic peaks with prominence > 0.3 |
| Spectral flux variance | 0.5 | Spectral flux decreasing over time | Stable or periodic spectral flux |
| Filename keywords | 3.0 | Contains "shot"/"hit"/"one"/"single" | Contains "loop"/"beat"/"groove"/"pattern" |
| Duration prior | 0.3 | < 0.5s slight lean | > 10s slight lean. Never deterministic |

Implementation:
```python
def detect_sample_type(y, sr, duration, filename=None):
    os_score = 0.0  # one-shot evidence
    lp_score = 0.0  # loop evidence

    # 1. RMS envelope analysis
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    if len(rms) > 10:
        peak_idx = np.argmax(rms)
        peak_pos = peak_idx / len(rms)  # Normalized position 0-1
        tail_start = min(peak_idx + max(5, len(rms)//5), len(rms)-1)
        tail_mean = np.mean(rms[tail_start:]) + 1e-8
        decay_ratio = rms[peak_idx] / tail_mean

        if peak_pos < 0.3 and decay_ratio > 4.0:
            os_score += 2.0  # Strong decay = one-shot
        elif peak_pos > 0.8:
            os_score += 1.0  # Riser = one-shot (inverted envelope)
        elif decay_ratio < 2.0:
            lp_score += 1.0  # Flat envelope = loop lean

    # 2. Start-end similarity
    n_corr = min(int(0.1 * sr), len(y) // 4)  # 100ms or quarter of signal
    if n_corr > 50:
        start = y[:n_corr]
        end = y[-n_corr:]
        corr = np.abs(np.corrcoef(start, end)[0, 1])
        if not np.isnan(corr):
            if corr > 0.7:
                lp_score += 1.5
            elif corr < 0.3:
                os_score += 0.5

    # 3. Onset periodicity (autocorrelation)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    if len(onset_env) > 20:
        autocorr = np.correlate(onset_env, onset_env, mode='full')
        autocorr = autocorr[len(autocorr)//2:]  # Positive lags only
        autocorr = autocorr / (autocorr[0] + 1e-8)  # Normalize
        from scipy.signal import find_peaks
        peaks, props = find_peaks(autocorr[1:], prominence=0.3, distance=5)
        if len(peaks) >= 2:
            lp_score += 1.5  # Periodic onsets = loop
        elif len(peaks) == 0:
            os_score += 0.5

    # 4. Filename override (strongest single signal)
    if filename:
        fname_lower = filename.lower()
        loop_kw = ['loop', 'beat', 'groove', 'pattern', 'break']
        shot_kw = ['shot', 'hit', 'one-shot', 'oneshot', 'one_shot', 'single']
        if any(kw in fname_lower for kw in loop_kw):
            lp_score += 3.0
        if any(kw in fname_lower for kw in shot_kw):
            os_score += 3.0

    # 5. Duration prior (weak)
    if duration < 0.5:
        os_score += 0.3
    elif duration > 10.0:
        lp_score += 0.3

    is_one_shot = os_score >= lp_score
    is_loop = not is_one_shot
    total = os_score + lp_score + 1e-8
    confidence = abs(os_score - lp_score) / total

    return is_one_shot, is_loop, float(confidence)
```

Add `--filename` argument to `main()` argparse and pass to `analyze_audio()`.

### 1.3 Add new audio features

#### `extract_additional_features(y, sr)` — Called at ALL analysis levels (cheap)

```python
def extract_additional_features(y, sr):
    features = {}

    # Spectral flux: rate of spectral change
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    flux = np.sqrt(np.sum(np.diff(S, axis=1)**2, axis=0))
    features['spectral_flux'] = float(np.mean(flux))

    # Spectral flatness: tonal vs noisy (Wiener entropy)
    flatness = librosa.feature.spectral_flatness(y=y)
    features['spectral_flatness'] = float(np.mean(flatness))

    # Temporal centroid: center of mass of energy in time (0-1)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    times = np.arange(len(rms))
    rms_sum = np.sum(rms) + 1e-8
    tc = np.sum(times * rms) / rms_sum
    features['temporal_centroid'] = float(tc / (len(rms) - 1 + 1e-8))  # Normalize to 0-1

    # Crest factor: peak-to-RMS ratio in dB
    peak = np.max(np.abs(y))
    rms_val = np.sqrt(np.mean(y**2))
    if rms_val > 1e-8:
        features['crest_factor'] = float(20 * np.log10(peak / rms_val))
    else:
        features['crest_factor'] = 0.0

    return features
```

#### `extract_transient_features(y_percussive, sr)` — Called in advanced block after HPSS

```python
def extract_transient_features(y_percussive, sr):
    """Analyze the first 50ms of the percussive HPSS component."""
    features = {
        'transient_spectral_centroid': None,
        'transient_spectral_flatness': None,
    }
    n_samples = min(int(0.05 * sr), len(y_percussive))  # 50ms
    if n_samples < 256:
        return features  # Too short for spectral analysis

    transient = y_percussive[:n_samples]

    try:
        centroid = librosa.feature.spectral_centroid(y=transient, sr=sr, n_fft=min(1024, n_samples))
        features['transient_spectral_centroid'] = float(np.mean(centroid))
    except:
        pass

    try:
        flatness = librosa.feature.spectral_flatness(y=transient, n_fft=min(1024, n_samples))
        features['transient_spectral_flatness'] = float(np.mean(flatness))
    except:
        pass

    return features
```

#### Integration into `analyze_audio()`

After spectral features extraction (line 89), add:
```python
additional_features = extract_additional_features(y, sr)
features.update(additional_features)
```

In the advanced block, after `extract_hpss_features()` (line 176), add:
```python
# Reuse percussive component for transient analysis
y_harm, y_perc = librosa.effects.hpss(y)  # Or pass from hpss_features
transient_features = extract_transient_features(y_perc, sr)
features.update(transient_features)
```

Note: HPSS is already computed in `extract_hpss_features()` but doesn't return the separated signals. Modify `extract_hpss_features()` to also return `y_harmonic, y_percussive` so we don't compute HPSS twice.

### 1.4 Fix existing bugs

1. **`generate_tags()` line 1577**: `onset_strength = features['rms_energy']` should use the actual onset strength:
   ```python
   onset_strength = features.get('onset_strength', features['rms_energy'])
   ```

2. **ADSR `envelope_type` ordering** (lines 899-913): Reorder classification checks. Currently:
   ```
   percussive → plucked → sustained → pad → hybrid
   ```
   Change to:
   ```
   percussive → plucked → pad → sustained → hybrid
   ```
   The 'sustained' check (`attack > 0.05 or sustain > 0.6`) is broader and catches pads. 'pad' (`attack > 0.1 or release > 0.5`) should be tested first.

3. **ADSR context**: Add `is_one_shot` parameter to `extract_adsr_envelope()`. When analyzing a loop/non-one-shot, the ADSR describes the full file envelope, not a single sound. Prefix `envelope_type` with `"file-"` (e.g., `"file-sustained"`).

4. **Spectral crest double loop**: The crest computation (lines 522-538) iterates through all frames separately from the main timbral loop (lines 463-495). Move crest computation into the main loop body to halve iteration cost:
   ```python
   # Inside existing frame loop at line 463:
   # ... existing dissonance, inharmonicity, tristimulus ...
   # Add:
   crest_values.append(crest(spec))
   ```
   Remove the separate crest loop entirely.

### 1.5 Improve instrument classification

#### Expand YAMNet keywords

In `extract_instrument_ml()` line 1005, expand `instrument_keywords`:
```python
instrument_keywords = [
    'music', 'guitar', 'drum', 'bass', 'piano', 'keyboard', 'synth',
    'violin', 'brass', 'trumpet', 'saxophone', 'flute', 'organ',
    'vocal', 'singing', 'speech', 'voice', 'percussion', 'cymbal',
    'snare', 'kick', 'hi-hat', 'tom', 'clap', 'cowbell', 'shaker',
    'tambourine', 'bell', 'chime', 'pluck', 'strum', 'string',
    # NEW additions:
    'marimba', 'xylophone', 'harmonica', 'harp', 'ukulele', 'banjo',
    'cello', 'viola', 'trombone', 'tuba', 'clarinet', 'oboe',
    'bass drum', 'gong', 'tabla', 'bongo', 'conga', 'woodblock',
    'glockenspiel', 'vibraphone', 'steelpan', 'accordion', 'sitar',
    'bagpipes', 'whistle', 'click', 'tick', 'scratch', 'noise',
]
```

#### New percussion subtype classifier

Uses transient spectral features from HPSS percussive component:

```python
def classify_percussion_subtype(features):
    """Classify percussion type using transient spectral features."""
    tc = features.get('transient_spectral_centroid')
    tf = features.get('transient_spectral_flatness')
    cf = features.get('crest_factor')
    attack = features.get('attack_time')

    if tc is None or tf is None:
        return []

    scores = {}

    # Kick: low-frequency transient, high crest factor
    if tc < 300:
        base = 0.7
        if cf is not None and cf > 15: base += 0.1
        if attack is not None and attack < 0.01: base += 0.1
        scores['kick'] = min(base, 0.95)

    # Snare: broadband noise burst (high flatness), mid-frequency
    if tf > 0.4 and 200 < tc < 5000:
        scores['snare'] = 0.75 if tf > 0.6 else 0.60

    # Clap: broadband, detect multiple close transients
    # (Need onset_intervals passed in from onset detection)
    if tf > 0.3 and tc > 500:
        scores['clap'] = 0.55  # Lower base, boosted by onset pattern

    # Hi-hat: high-frequency, metallic (low flatness = resonant)
    if tc > 5000 and tf < 0.5:
        scores['hihat'] = 0.70

    # Ride: similar to hi-hat but broader frequency range
    if 3000 < tc < 8000 and tf < 0.4:
        scores['ride'] = 0.55

    # Tom: mid-low frequency, tonal transient
    if 100 < tc < 800 and tf < 0.3:
        scores['tom'] = 0.60

    return [{'name': k, 'confidence': v}
            for k, v in sorted(scores.items(), key=lambda x: -x[1])]
```

In `analyze_audio()`: When YAMNet is available, use YAMNet predictions as primary instrument classification. Merge with `classify_percussion_subtype()` for percussion refinement. Skip the heuristic `extract_instrument_predictions()` entirely.

### 1.6 Drop similarity hash

In `extract_fingerprint()` (line 1443): Remove the entire "Perceptual hash from mel-spectrogram" block (lines 1472-1520). Keep chromaprint only. Set `similarity_hash` to `None` in the return dict (or remove the key entirely).

Rationale: YAMNet embeddings (1024-dim) serve the perceptual similarity purpose better. Chromaprint handles exact/near-duplicate detection. The mel-spectrogram hash is redundant with both.

### 1.7 Genre classification: skip for one-shots

In `extract_genre_ml()`: Add `is_one_shot` parameter. If one-shot, skip all genre/mood heuristics and return empty:
```python
if is_one_shot:
    return {'genre_classes': None, 'genre_primary': None, 'mood_classes': None}
```

Genre classification on isolated one-shot samples is unreliable — a kick drum has no genre. Character tags (dark/bright/warm from perceptual features) are more meaningful for one-shots and are already computed.

---

## Phase 2: Backend TypeScript — Filename Tagging + Schema + Pipeline

### 2.1 Create filename/folder tag parser

**File**: `/backend/src/services/audioAnalysis.ts`

New function:
```typescript
export function parseFilenameTags(
  filename: string,
  folderPath: string | null
): Array<{tag: string; confidence: number; source: 'filename' | 'folder'; category: string}>
```

Keyword dictionary organized by tag category:

```typescript
const SAMPLE_KEYWORDS: Record<string, { keywords: string[]; category: string }> = {
  // Percussion
  kick:        { keywords: ['kick', '808', 'bd', 'bassdrum', 'base drum'], category: 'instrument' },
  snare:       { keywords: ['snare', 'sd', 'snr'], category: 'instrument' },
  clap:        { keywords: ['clap', 'clp'], category: 'instrument' },
  rim:         { keywords: ['rim', 'rimshot'], category: 'instrument' },
  hihat:       { keywords: ['hihat', 'hh', 'hat', 'hi-hat', 'open hat', 'closed hat'], category: 'instrument' },
  ride:        { keywords: ['ride', 'rd'], category: 'instrument' },
  crash:       { keywords: ['crash'], category: 'instrument' },
  perc:        { keywords: ['perc', 'percussion'], category: 'instrument' },
  tom:         { keywords: ['tom'], category: 'instrument' },
  shaker:      { keywords: ['shaker', 'tambourine', 'cowbell', 'conga', 'bongo', 'woodblock'], category: 'instrument' },
  cymbal:      { keywords: ['cymbal', 'cym'], category: 'instrument' },

  // Melodic
  piano:       { keywords: ['piano', 'keys', 'rhodes', 'wurlitzer'], category: 'instrument' },
  synth:       { keywords: ['synth', 'synthesizer'], category: 'instrument' },
  pad:         { keywords: ['pad'], category: 'instrument' },
  lead:        { keywords: ['lead'], category: 'instrument' },
  pluck:       { keywords: ['pluck', 'plk'], category: 'instrument' },
  chord:       { keywords: ['chord', 'chrd', 'stab'], category: 'instrument' },
  arp:         { keywords: ['arp', 'arpeggio'], category: 'instrument' },
  bass:        { keywords: ['bass', 'sub', '808 bass'], category: 'instrument' },
  guitar:      { keywords: ['guitar', 'gtr', 'acoustic guitar', 'electric guitar'], category: 'instrument' },
  strings:     { keywords: ['strings', 'violin', 'cello', 'viola'], category: 'instrument' },
  brass:       { keywords: ['brass', 'horn', 'trumpet', 'trombone'], category: 'instrument' },
  flute:       { keywords: ['flute'], category: 'instrument' },
  sax:         { keywords: ['sax', 'saxophone'], category: 'instrument' },
  organ:       { keywords: ['organ'], category: 'instrument' },
  bell:        { keywords: ['bell', 'chime', 'glockenspiel', 'vibraphone', 'marimba'], category: 'instrument' },

  // Vocal
  vocal:       { keywords: ['vocal', 'vox', 'voice', 'acapella', 'adlib', 'spoken', 'chant', 'choir'], category: 'instrument' },

  // FX
  riser:       { keywords: ['riser', 'rise', 'uplifter'], category: 'general' },
  sweep:       { keywords: ['sweep'], category: 'general' },
  impact:      { keywords: ['impact'], category: 'general' },
  noise:       { keywords: ['noise', 'white noise', 'pink noise'], category: 'general' },
  whoosh:      { keywords: ['whoosh', 'swoosh'], category: 'general' },
  fx:          { keywords: ['fx', 'sfx', 'effect'], category: 'general' },
  foley:       { keywords: ['foley'], category: 'general' },
  texture:     { keywords: ['texture', 'atmosphere', 'atmos', 'ambience', 'ambient'], category: 'general' },
  transition:  { keywords: ['transition', 'downlifter', 'swell', 'boom'], category: 'general' },

  // Processing
  tape:        { keywords: ['tape'], category: 'general' },
  vinyl:       { keywords: ['vinyl'], category: 'general' },
  lofi:        { keywords: ['lofi', 'lo-fi', 'lo fi'], category: 'general' },
  saturated:   { keywords: ['saturated', 'sat', 'distorted', 'dist'], category: 'general' },
  filtered:    { keywords: ['filtered'], category: 'general' },

  // Character
  dark:        { keywords: ['dark'], category: 'spectral' },
  bright:      { keywords: ['bright'], category: 'spectral' },
  warm:        { keywords: ['warm'], category: 'spectral' },
  analog:      { keywords: ['analog', 'analogue'], category: 'general' },
  vintage:     { keywords: ['vintage'], category: 'general' },
  clean:       { keywords: ['clean'], category: 'general' },
  dirty:       { keywords: ['dirty'], category: 'general' },

  // Sample type
  loop:        { keywords: ['loop', 'beat', 'groove', 'pattern', 'break'], category: 'type' },
  'one-shot':  { keywords: ['oneshot', 'one-shot', 'one_shot', 'shot', 'single', 'hit'], category: 'type' },
  fill:        { keywords: ['fill', 'roll'], category: 'type' },
  top:         { keywords: ['top', 'toploop'], category: 'type' },
}
```

Tokenization strategy:
```typescript
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase split
    .replace(/[_\-\.]/g, ' ')              // separator normalization
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1)
}
```

Match against tokens from filename (confidence 0.90) and each folder path segment (confidence 0.85). Also match multi-word keywords against the full lowercased string (e.g., "open hat", "bass drum").

### 2.2 Update DB schema

**File**: `/backend/src/db/schema.ts`

Add new columns to `audioFeatures` table:
```typescript
temporalCentroid: real('temporal_centroid'),
crestFactor: real('crest_factor'),
transientSpectralCentroid: real('transient_spectral_centroid'),
transientSpectralFlatness: real('transient_spectral_flatness'),
sampleTypeConfidence: real('sample_type_confidence'),
```

Note: `spectralFlux` and `spectralFlatness` already exist in the schema but are currently not populated by the Python script. This plan populates them — no schema change needed for these.

Drop `similarityHash` column:
- SQLite 3.35.0+ supports `ALTER TABLE DROP COLUMN` directly
- For older versions: create new table without column, copy data, drop old, rename

Add `'filename'` to tag category handling in `getTagMetadata()`:
```typescript
filename: '#f472b6',  // Pink
```

### 2.3 Update audioAnalysis.ts pipeline

**File**: `/backend/src/services/audioAnalysis.ts`

In `analyzeAudioFeatures()` snake_case→camelCase mapping, add:
```typescript
spectralFlux: result.spectral_flux,          // Now populated
spectralFlatness: result.spectral_flatness,  // Now populated
temporalCentroid: result.temporal_centroid,
crestFactor: result.crest_factor,
transientSpectralCentroid: result.transient_spectral_centroid,
transientSpectralFlatness: result.transient_spectral_flatness,
sampleTypeConfidence: result.sample_type_confidence,
```

In `storeAudioFeatures()`: Add new fields to the values object.

In `getAudioFeatures()`: Add new fields to the retrieval mapping.

Remove `similarityHash` from all three functions.

Pass original filename to Python:
```typescript
const args = [PYTHON_SCRIPT, audioPath, '--level', level, '--filename', path.basename(originalPath)]
```

### 2.4 Integrate filename tagging into import pipeline

**File**: `/backend/src/routes/import.ts`

In `/import/file`, `/import/files`, `/import/folder` handlers — AFTER creating the slice, BEFORE queuing audio analysis:

```typescript
// After slice creation, before analysis queue
const filenameTags = parseFilenameTags(originalName, folderPath)
for (const ft of filenameTags) {
  const tagMeta = getTagMetadata(ft.tag)
  // Create tag if not exists
  const existingTag = await db.select().from(tags).where(eq(tags.name, ft.tag)).get()
  const tagId = existingTag?.id ?? (await db.insert(tags).values({
    name: ft.tag,
    color: tagMeta.color,
    category: ft.category,
  }).returning().get()).id

  // Link to slice
  await db.insert(sliceTags).values({
    sliceId: slice.id,
    tagId: tagId,
  }).onConflictDoNothing()
}
```

**File**: `/backend/src/routes/slices.ts`

In `autoTagSlice()`: After audio analysis tags are generated, deduplicate against existing filename-derived tags before inserting.

### 2.5 Pass filename to Python

In `analyzeAudioFeatures()`, add the original filename as a CLI argument:
```typescript
const args = [scriptPath, audioPath, '--level', level]
if (originalFilename) {
  args.push('--filename', originalFilename)
}
```

In `analyze_audio.py` main(), add:
```python
parser.add_argument('--filename', default=None, help='Original filename for metadata-based detection')
```

Pass to `analyze_audio()` and then to `detect_sample_type()`.

---

## Phase 3: Frontend — New Features + Robust Scaling + Better Defaults

### 3.1 Update frontend types

**File**: `/frontend/src/types/index.ts`

Add to `AudioFeatures` interface:
```typescript
temporalCentroid?: number | null
crestFactor?: number | null
transientSpectralCentroid?: number | null
transientSpectralFlatness?: number | null
sampleTypeConfidence?: number | null
```

Add to `FeatureWeights` interface:
```typescript
temporalCentroid: number
crestFactor: number
transientSpectralCentroid: number
transientSpectralFlatness: number
```

Remove `similarityHash` from `AudioFeatures`.

### 3.2 Update featureMatrix.ts

**File**: `/frontend/src/utils/featureMatrix.ts`

#### Updated default weights (MIR-literature-informed)

```typescript
export const DEFAULT_WEIGHTS: FeatureWeights = {
  // Spectral
  spectralCentroid: 1.2,       // Strong brightness indicator
  spectralRolloff: 0.8,        // Useful but correlated with centroid
  spectralBandwidth: 0.8,      // Useful but correlated
  spectralContrast: 0.8,
  spectralFlux: 0.8,           // Rate of spectral change
  spectralFlatness: 0.8,       // Tonal vs noisy
  spectralCrest: 0.8,
  zeroCrossingRate: 0.7,       // Useful but noisy

  // Energy
  rmsEnergy: 0.5,              // Should be normalized out for type clustering
  loudness: 0.5,
  dynamicRange: 0.8,

  // Envelope
  attackTime: 1.3,             // Critical for percussive vs sustained
  decayTime: 1.0,
  sustainLevel: 1.0,
  releaseTime: 0.8,
  temporalCentroid: 1.2,       // NEW: energy center in time
  crestFactor: 1.1,            // NEW: transient-heavy vs compressed

  // Transient (NEW group)
  transientSpectralCentroid: 1.5,  // NEW: Most discriminative for percussion
  transientSpectralFlatness: 1.3,  // NEW: Noisy vs tonal transients

  // Timbral
  dissonance: 1.0,
  inharmonicity: 1.0,
  spectralComplexity: 0.8,

  // Perceptual (derived, correlated with spectral)
  brightness: 0.6,
  warmth: 0.6,
  hardness: 0.6,
  roughness: 0.6,
  sharpness: 0.6,

  // Harmonic/Percussive
  harmonicPercussiveRatio: 1.2,  // Fundamental percussive vs harmonic
  harmonicEnergy: 0.8,
  percussiveEnergy: 0.8,
  harmonicCentroid: 0.8,
  percussiveCentroid: 0.8,

  // Rhythm
  bpm: 0.3,                    // Only relevant for loops
  onsetCount: 0.5,
  onsetRate: 0.5,
  beatStrength: 0.5,
  rhythmicRegularity: 0.5,
  danceability: 0.5,

  // Stereo (rarely discriminative for sample type)
  stereoWidth: 0.3,
  panningCenter: 0.3,
  stereoImbalance: 0.3,

  // Tonal
  keyStrength: 0.3,

  // Other
  kurtosis: 0.5,

  // EBU R128
  loudnessIntegrated: 0.5,
  loudnessRange: 0.5,
  loudnessMomentaryMax: 0.3,
  truePeak: 0.3,

  // Events
  eventCount: 0.5,
  eventDensity: 0.5,
}
```

#### New feature group

```typescript
export const FEATURE_GROUPS = {
  // ... existing groups ...
  transient: {
    label: 'Transient (Advanced)',
    features: ['transientSpectralCentroid', 'transientSpectralFlatness'],
  },
  // Move temporalCentroid and crestFactor into existing envelope group
}
```

#### New labels

```typescript
temporalCentroid: 'Temporal Center',
crestFactor: 'Crest Factor (dB)',
transientSpectralCentroid: 'Transient Brightness',
transientSpectralFlatness: 'Transient Noisiness',
```

#### Add robust scaling

```typescript
export type NormalizationMethod = 'minmax' | 'robust' | 'zscore'

function robustNormalize(value: number, median: number, iqr: number): number {
  if (iqr === 0) return 0.5
  // Center at 0.5, spread by IQR. Most values stay in 0-1.
  return 0.5 + (value - median) / (iqr * 2)
}

function zscoreNormalize(value: number, mean: number, std: number): number {
  if (std === 0) return 0
  return (value - mean) / std
}
```

Modify `buildFeatureMatrix()` signature:
```typescript
export function buildFeatureMatrix(
  samples: AudioFeatures[],
  weights: FeatureWeights,
  normalization: NormalizationMethod = 'robust'  // NEW parameter
)
```

First pass: compute sorted values → Q1, median, Q3, IQR per feature:
```typescript
const sorted = validValues.slice().sort((a, b) => a - b)
const q1 = sorted[Math.floor(sorted.length * 0.25)]
const q3 = sorted[Math.floor(sorted.length * 0.75)]
const median = sorted[Math.floor(sorted.length * 0.5)]
const iqr = q3 - q1
const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length
const std = Math.sqrt(validValues.reduce((a, b) => a + (b - mean) ** 2, 0) / validValues.length)
```

Second pass: apply selected normalization method.

#### Update presets

Update all 6 existing presets with the new features and adjusted weights. Add new presets if useful:
```typescript
{ id: 'transient', name: 'Transient Focus',
  description: 'Optimized for percussion subtype discrimination',
  weights: { ...DEFAULT_WEIGHTS, transientSpectralCentroid: 2.0, transientSpectralFlatness: 2.0, attackTime: 2.0, crestFactor: 1.5, ... } }
```

### 3.3 Update FeatureWeightsPanel

**File**: `/frontend/src/components/FeatureWeightsPanel.tsx`

Add normalization method selector in Advanced section:
- Three buttons: "Min-Max", "Robust" (default, highlighted), "Z-Score"
- Props: `normalizationMethod: NormalizationMethod`, `onNormalizationMethodChange`
- Place above the Projection method selector

### 3.4 Wire through SampleSpaceView

**File**: `/frontend/src/components/SampleSpaceView.tsx`

```typescript
const [normalizationMethod, setNormalizationMethod] = useState<NormalizationMethod>('robust')
```

Pass to `buildFeatureMatrix()` and to `FeatureWeightsPanel` as props.

---

## Phase 4: Frontend — HDBSCAN Clustering

### 4.1 Add dependency

```bash
cd frontend && npm install hdbscanjs
```

If `hdbscanjs` is unsuitable (check API compatibility), alternatives:
- Implement minimal HDBSCAN: mutual reachability graph → Prim's MST → condensed tree → DBSCAN* extraction
- Use `ml-hdbscan` if available

### 4.2 Update useClustering.ts

**File**: `/frontend/src/hooks/useClustering.ts`

```typescript
export type ClusterMethod = 'dbscan' | 'kmeans' | 'hdbscan'

interface UseClusteringOptions {
  method: ClusterMethod
  epsilon?: number       // DBSCAN
  minPoints?: number     // DBSCAN
  k?: number             // K-Means
  minClusterSize?: number  // HDBSCAN (NEW)
  minSamples?: number      // HDBSCAN (NEW)
}
```

Add HDBSCAN case:
```typescript
case 'hdbscan': {
  const hdbscan = new HDBSCAN({
    minClusterSize: opts.minClusterSize ?? 5,
    minSamples: opts.minSamples ?? 3,
  })
  const result = hdbscan.fit(points)
  // Convert to cluster assignment array with -1 for noise
  // ...
}
```

### 4.3 Update FeatureWeightsPanel

Add `'hdbscan'` to clustering method buttons. When HDBSCAN selected:
- Show `minClusterSize` slider (range 2-20, default 5)
- Hide epsilon (DBSCAN) and k (k-means) sliders
- Add tooltip: "HDBSCAN automatically finds clusters of varying density"

---

## Phase 5: LMNN Weight Learning

### 5.1 Create learn_weights.py

**File**: New `/backend/src/python/learn_weights.py`

```python
#!/usr/bin/env python3
"""Learn optimal feature weights using LMNN metric learning."""
import sys
import json
import numpy as np

def learn_weights(features, labels, feature_names):
    from metric_learn import LMNN

    X = np.array(features, dtype=np.float64)
    y = np.array(labels)

    # Normalize features before learning
    means = np.mean(X, axis=0)
    stds = np.std(X, axis=0) + 1e-8
    X_norm = (X - means) / stds

    # LMNN with diagonal constraint (produces weight vector)
    lmnn = LMNN(k=3, learn_rate=1e-6, max_iter=200)
    lmnn.fit(X_norm, y)

    # Extract learned transformation
    L = lmnn.components_
    # For weight vector: use column norms of L (how much each feature is scaled)
    weights = np.sqrt(np.sum(L**2, axis=0))
    # Normalize so mean weight = 1.0
    weights = weights / (np.mean(weights) + 1e-8)

    # Evaluate accuracy via leave-one-out k-NN
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.model_selection import cross_val_score
    X_transformed = lmnn.transform(X_norm)
    knn = KNeighborsClassifier(n_neighbors=3)
    scores = cross_val_score(knn, X_transformed, y, cv=min(5, len(y)))
    accuracy = float(np.mean(scores))

    return {
        'weights': {name: float(w) for name, w in zip(feature_names, weights)},
        'accuracy': accuracy,
        'n_samples': len(features),
        'n_classes': len(set(labels)),
    }

if __name__ == '__main__':
    data = json.loads(sys.stdin.read())
    result = learn_weights(data['features'], data['labels'], data['feature_names'])
    print(json.dumps(result, indent=2))
```

### 5.2 Add Python dependency

**File**: `/backend/requirements.txt`

Add:
```
metric-learn>=0.7.0
scikit-learn>=1.3.0
```

### 5.3 Backend endpoints

**File**: `/backend/src/routes/slices.ts` (or new `/backend/src/routes/weights.ts`)

```
POST /api/weights/learn
```
1. Query all samples that have both audio features AND filename-derived tags
2. Use the filename-derived instrument/type tag as the label
3. Build feature matrix (same features as frontend featureMatrix.ts)
4. Spawn `learn_weights.py` with JSON on stdin
5. Parse JSON output
6. Store learned weights as JSON file: `{DATA_DIR}/learned_weights.json`

```
GET /api/weights/learned
```
1. Read `{DATA_DIR}/learned_weights.json`
2. Return weights object (or 404 if not yet learned)

### 5.4 Frontend "ML Optimized" preset

**File**: `/frontend/src/components/FeatureWeightsPanel.tsx`

On component mount, fetch `/api/weights/learned`. If available:
- Add 7th preset button "ML Optimized" with a special icon/color
- Clicking applies the learned weights
- Show accuracy metric in tooltip: "Trained on N samples, K-NN accuracy: 85%"

If not available: show grayed-out button with tooltip "Import labeled samples and click 'Learn Weights' to generate"

Add "Learn Weights" button (calls POST /api/weights/learn). Show loading spinner during training. Show success/error notification.

---

## Dependencies to Add

| Package | Where | Purpose |
|---|---|---|
| `metric-learn>=0.7.0` | `/backend/requirements.txt` | LMNN distance metric learning |
| `scikit-learn>=1.3.0` | `/backend/requirements.txt` | k-NN evaluation, cross-validation |
| `hdbscanjs` (or equivalent) | `/frontend/package.json` | HDBSCAN clustering |

No other new dependencies. All new audio features use existing librosa/numpy.

---

## DB Migration Strategy

SQLite migrations via Drizzle:

1. `ALTER TABLE audio_features ADD COLUMN temporal_centroid REAL` — nullable, safe
2. `ALTER TABLE audio_features ADD COLUMN crest_factor REAL`
3. `ALTER TABLE audio_features ADD COLUMN transient_spectral_centroid REAL`
4. `ALTER TABLE audio_features ADD COLUMN transient_spectral_flatness REAL`
5. `ALTER TABLE audio_features ADD COLUMN sample_type_confidence REAL`
6. Drop `similarity_hash`: Check SQLite version. ≥3.35.0 → `ALTER TABLE DROP COLUMN`. Otherwise table recreation.
7. Generate and run migration: `npx drizzle-kit generate` → `npx drizzle-kit push`

Existing data: New columns are NULL until re-analysis. Use existing bulk re-analyze endpoint.

---

## Testing Strategy

| Phase | Test method | What to verify |
|---|---|---|
| 1 | `python analyze_audio.py kick.wav --level advanced --filename "Kick_Tight_808.wav"` | New features present in JSON, correct one-shot detection, no similarity_hash, fixed ADSR ordering, spectral_flux/flatness populated |
| 1 | Run on known samples: kick, snare, clap, pad, loop | Correct is_one_shot/is_loop for each, correct percussion subtype |
| 2 | Import "808_kick_dark.wav" from "Hip Hop/Drums/" folder | Filename tags (kick, 808, dark) appear instantly with 'filename' category |
| 2 | Re-analyze same sample | No duplicate tags, audio tags coexist with filename tags |
| 3 | Open sample space view | New feature sliders in correct groups, robust scaling toggle works, updated default weights |
| 3 | Compare min-max vs robust on dataset with outliers | Robust produces tighter, more meaningful clusters |
| 4 | Select HDBSCAN in clustering dropdown | Clusters form automatically, noise points colored gray, minClusterSize slider works |
| 5 | Import 200+ labeled samples → POST /api/weights/learn | "ML Optimized" preset appears, accuracy reported, applying preset changes visualization |

---

## File Modification Summary

| File | Phase | Changes |
|---|---|---|
| `/backend/src/python/analyze_audio.py` | 1 | Preprocessing, rewrite detect_sample_type, 4 new features + 2 transient features, fix 4 bugs, expand YAMNet keywords, percussion classifier, drop similarity hash, skip genre for one-shots |
| `/backend/src/services/audioAnalysis.ts` | 2 | Add parseFilenameTags(), new feature snake→camel mappings, pass --filename, remove similarityHash |
| `/backend/src/db/schema.ts` | 2 | 5 new columns, drop similarityHash |
| `/backend/src/routes/import.ts` | 2 | Call parseFilenameTags() before analysis queue |
| `/backend/src/routes/slices.ts` | 2,5 | Deduplicate tags in autoTagSlice(), weight learning endpoints |
| `/frontend/src/types/index.ts` | 3 | New fields in AudioFeatures + FeatureWeights |
| `/frontend/src/utils/featureMatrix.ts` | 3 | New features + weights + labels + groups, robust scaling, NormalizationMethod |
| `/frontend/src/hooks/useClustering.ts` | 4 | HDBSCAN method + params |
| `/frontend/src/components/FeatureWeightsPanel.tsx` | 3,4,5 | Normalization selector, HDBSCAN UI, ML Optimized preset, Learn Weights button |
| `/frontend/src/components/SampleSpaceView.tsx` | 3 | Wire normalization state |
| `/backend/src/python/learn_weights.py` | 5 | New file: LMNN weight learning script |
| `/backend/requirements.txt` | 5 | Add metric-learn, scikit-learn |
| `/frontend/package.json` | 4 | Add hdbscanjs |
