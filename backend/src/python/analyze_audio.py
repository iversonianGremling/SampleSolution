#!/usr/bin/env python3
"""
Audio analysis script using Essentia and Librosa
Analyzes audio files and extracts features for sample library tagging
"""

import sys
import json
import time
import warnings
import numpy as np
import os
import re
import hashlib

warnings.filterwarnings('ignore')

def env_flag(name, default=False):
    """Parse common truthy env var values."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}

# Runtime modes controlled by environment variables
DEBUG_MODE = env_flag('DEBUG_ANALYSIS', False)
SAFE_MODE = env_flag('AUDIO_ANALYSIS_SAFE_MODE', False)
DISABLE_ESSENTIA = SAFE_MODE or env_flag('AUDIO_ANALYSIS_DISABLE_ESSENTIA', False)
DISABLE_TENSORFLOW = SAFE_MODE or env_flag('AUDIO_ANALYSIS_DISABLE_TENSORFLOW', False)
DISABLE_FINGERPRINT = SAFE_MODE or env_flag('AUDIO_ANALYSIS_DISABLE_FINGERPRINT', False)

# Native numeric libraries can over-subscribe CPU threads and destabilize
# concurrent analyses under load; keep defaults conservative unless explicitly set.
for env_name in (
    'OMP_NUM_THREADS',
    'OPENBLAS_NUM_THREADS',
    'MKL_NUM_THREADS',
    'NUMEXPR_NUM_THREADS',
    'VECLIB_MAXIMUM_THREADS',
    'BLIS_NUM_THREADS',
    'NUMBA_NUM_THREADS',
):
    os.environ.setdefault(env_name, '1')

# In safe mode, keep numba from JIT-compiling code paths that can segfault on
# incompatible binary combos.
if SAFE_MODE:
    os.environ.setdefault('NUMBA_DISABLE_JIT', '1')

def debug_log(message):
    """Print debug message if debug mode is enabled"""
    if DEBUG_MODE:
        print(f"[DEBUG] {message}", file=sys.stderr)

try:
    import librosa
    import soundfile as sf
except ImportError as e:
    print(json.dumps({"error": f"Missing dependency: {e}. Install with: pip install librosa soundfile"}))
    sys.exit(1)


def safe_onset_detect(y=None, sr=22050, onset_envelope=None, hop_length=512,
                      units='frames', backtrack=False, **kwargs):
    """
    Drop-in replacement for librosa.onset.onset_detect that avoids the
    numba-compiled peak_pick (which segfaults with numba 0.63 + numpy 2.x).

    Uses librosa.onset.onset_strength for the envelope, then a pure-numpy
    reimplementation of the same peak_pick algorithm (Böck et al., 2012)
    with the same time-based defaults from librosa's hyper-parameter optimization.
    """
    # Get onset strength envelope
    if onset_envelope is None:
        onset_envelope = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)

    # Normalize envelope to [0, 1] (same as librosa with normalize=True)
    oenv = onset_envelope.astype(np.float64)
    oenv_min = np.min(oenv)
    oenv_max = np.max(oenv)
    if oenv_max > oenv_min:
        oenv = (oenv - oenv_min) / (oenv_max - oenv_min)
    else:
        return np.array([], dtype=int)

    # Compute defaults exactly as librosa does (time-based, from sr/hop_length)
    pre_max = int(kwargs.get('pre_max', 0.03 * sr // hop_length))       # 30ms
    post_max = int(kwargs.get('post_max', 0.00 * sr // hop_length + 1)) # 0ms + 1
    pre_avg = int(kwargs.get('pre_avg', 0.10 * sr // hop_length))       # 100ms
    post_avg = int(kwargs.get('post_avg', 0.10 * sr // hop_length + 1)) # 100ms + 1
    wait = int(kwargs.get('wait', 0.03 * sr // hop_length))             # 30ms
    delta = float(kwargs.get('delta', 0.07))

    # Pure-numpy peak picking — same 3-condition algorithm as librosa.util.peak_pick:
    #   1. x[n] == max(x[n - pre_max : n + post_max])
    #   2. x[n] >= mean(x[n - pre_avg : n + post_avg]) + delta
    #   3. n - previous_n > wait
    n = len(oenv)
    peaks = []
    last_peak = -wait - 1

    for i in range(pre_max, n - post_max):
        # Condition 1: local maximum
        win_start = max(0, i - pre_max)
        win_end = min(n, i + post_max + 1)
        if oenv[i] != np.max(oenv[win_start:win_end]):
            continue

        # Condition 2: above local mean + delta
        avg_start = max(0, i - pre_avg)
        avg_end = min(n, i + post_avg + 1)
        if oenv[i] < np.mean(oenv[avg_start:avg_end]) + delta:
            continue

        # Condition 3: minimum wait between peaks
        if i - last_peak <= wait:
            continue

        peaks.append(i)
        last_peak = i

    onset_frames = np.array(peaks, dtype=int)

    # Backtrack to nearest preceding energy minimum
    if backtrack and len(onset_frames) > 0 and y is not None:
        energy = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        backtracked = []
        for frame in onset_frames:
            search_start = max(0, frame - pre_max * 2)
            segment = energy[search_start:frame + 1]
            if len(segment) > 0:
                backtracked.append(search_start + int(np.argmin(segment)))
            else:
                backtracked.append(frame)
        onset_frames = np.array(backtracked, dtype=int)

    # Convert units
    if units == 'time':
        return librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)
    elif units == 'samples':
        return librosa.frames_to_samples(onset_frames, hop_length=hop_length)
    return onset_frames


if not DISABLE_ESSENTIA:
    try:
        import essentia
        import essentia.standard as es
    except ImportError:
        # Essentia is optional for analysis
        essentia = None
        es = None
else:
    essentia = None
    es = None

# TensorFlow imports (Phase 4)
if not DISABLE_TENSORFLOW:
    try:
        import tensorflow as tf
        import tensorflow_hub as hub
        # Suppress TensorFlow warnings
        os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
        tf.get_logger().setLevel('ERROR')
    except ImportError:
        tf = None
        hub = None
else:
    tf = None
    hub = None

# Acoustid/Chromaprint imports (Phase 6)
if not DISABLE_FINGERPRINT:
    try:
        import acoustid
        import chromaprint
    except ImportError:
        acoustid = None
        chromaprint = None
else:
    acoustid = None
    chromaprint = None

# Global model cache (loaded once, reused across analyses)
_yamnet_model = None
_yamnet_class_names = None


def preprocess_audio(y, sr):
    """Remove DC offset, trim silence, and peak-normalize the audio."""
    y_original = y.copy()          # Keep for EBU R128 (needs absolute levels)
    y = y - np.mean(y)             # DC offset removal
    y, trim_idx = librosa.effects.trim(y, top_db=30)  # Silence trimming
    peak = np.max(np.abs(y))
    if peak > 1e-8:
        y = y / peak               # Peak normalization
    return y, y_original, trim_idx


def analyze_audio(audio_path, analysis_level='advanced', filename=None):
    """
    Main audio analysis function
    Args:
        audio_path: Path to audio file
        analysis_level: 'advanced'
    Returns dict with all extracted features and suggested tags
    """
    start_time = time.time()
    debug_log(f"=== Starting audio analysis: {audio_path} (level: {analysis_level}) ===")
    if SAFE_MODE:
        debug_log("Safe mode enabled: skipping Essentia/TensorFlow/Chromaprint-backed stages")

    try:
        # Load audio
        step_start = time.time()
        y, sr = librosa.load(audio_path, sr=44100, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        debug_log(f"Audio loaded: duration={duration:.2f}s, sr={sr}Hz [{(time.time()-step_start)*1000:.0f}ms]")

        # Preprocess audio
        step_start = time.time()
        y, y_original, trim_idx = preprocess_audio(y, sr)
        duration = librosa.get_duration(y=y, sr=sr)
        debug_log(f"Audio preprocessed: trimmed duration={duration:.2f}s, trim_idx={trim_idx} [{(time.time()-step_start)*1000:.0f}ms]")

        # Extract features FIRST (needed for instrument and sample type detection)
        step_start = time.time()
        spectral_features = extract_spectral_features(y, sr, level=analysis_level)
        debug_log(f"Spectral features extracted [{(time.time()-step_start)*1000:.0f}ms]")

        step_start = time.time()
        energy_features = extract_energy_features(y, sr)
        debug_log(f"Energy features extracted [{(time.time()-step_start)*1000:.0f}ms]")

        # Detect instruments (needed for sample type classification)
        step_start = time.time()
        instrument_predictions = extract_instrument_predictions(
            y, sr, spectral_features, energy_features, duration
        )
        debug_log(f"Instrument predictions: {len(instrument_predictions)} instruments [{(time.time()-step_start)*1000:.0f}ms]")

        # NOW detect sample type with instrument context
        step_start = time.time()
        is_one_shot, is_loop, sample_type_confidence = detect_sample_type(
            y, sr, duration, filename, instrument_predictions
        )
        debug_log(f"Sample type detected: one_shot={is_one_shot}, loop={is_loop}, confidence={sample_type_confidence:.3f} [{(time.time()-step_start)*1000:.0f}ms]")

        # Extract additional features (all levels - cheap to compute)
        step_start = time.time()
        additional_features = extract_additional_features(y, sr)
        debug_log(f"Additional features extracted [{(time.time()-step_start)*1000:.0f}ms]")

        # Extract fundamental frequency for one-shots (excluding chords)
        fundamental_freq = None
        if is_one_shot:
            step_start = time.time()
            fundamental_freq = extract_fundamental_frequency(y, sr, filename, spectral_features)
            if fundamental_freq:
                debug_log(f"Fundamental frequency: {fundamental_freq:.1f} Hz [{(time.time()-step_start)*1000:.0f}ms]")
            else:
                debug_log(f"Fundamental frequency: None (chord or no pitch detected) [{(time.time()-step_start)*1000:.0f}ms]")

        # Extract key/scale features
        key_features = {'key_estimate': None, 'scale': None, 'key_strength': None}
        if analysis_level == 'advanced':
            step_start = time.time()
            if is_one_shot:
                # F0-anchored chroma analysis for one-shots; Essentia fallback for chords
                key_features = extract_scale_for_one_shot(y, sr, fundamental_freq=fundamental_freq)
                debug_log(f"One-shot scale detected: {key_features['key_estimate']} "
                          f"(strength={key_features['key_strength']}) [{(time.time()-step_start)*1000:.0f}ms]")
            else:
                key_features = extract_key_features(y, sr)
                debug_log(f"Key features extracted: {key_features['key_estimate']} [{(time.time()-step_start)*1000:.0f}ms]")

        # Estimate polyphony (approximate simultaneous note count)
        step_start = time.time()
        polyphony = estimate_polyphony(y, sr)
        debug_log(f"Polyphony estimated: {polyphony if polyphony is not None else 'n/a'} [{(time.time()-step_start)*1000:.0f}ms]")

        # Extract tempo only for loops (advanced only)
        tempo_features = {}
        if is_loop and duration > 1.5 and analysis_level == 'advanced':
            step_start = time.time()
            tempo_features = extract_tempo_features(y, sr)
            debug_log(f"Tempo extracted: {tempo_features.get('bpm')} BPM [{(time.time()-step_start)*1000:.0f}ms]")

        # Build features dict
        features = {
            'duration': float(duration),
            'sample_rate': int(sr),
            'is_one_shot': bool(is_one_shot),
            'is_loop': bool(is_loop),
            'sample_type_confidence': float(sample_type_confidence),
            'onset_count': int(count_onsets(y, sr)),
            'analysis_level': analysis_level,
            # Spectral
            'spectral_centroid': float(spectral_features['spectral_centroid']),
            'spectral_rolloff': float(spectral_features['spectral_rolloff']),
            'spectral_bandwidth': float(spectral_features['spectral_bandwidth']),
            'spectral_contrast': float(spectral_features['spectral_contrast']),
            'zero_crossing_rate': float(spectral_features['zero_crossing_rate']),
            'mfcc_mean': spectral_features['mfcc_mean'],
            # Energy
            'rms_energy': float(energy_features['rms_energy']),
            'loudness': float(energy_features['loudness']),
            'dynamic_range': float(energy_features['dynamic_range']),
            # Key Detection
            'key_estimate': key_features['key_estimate'],
            'scale': key_features.get('scale'),
            'key_strength': key_features['key_strength'],
            'polyphony': polyphony,
            # Tempo (optional)
            'bpm': tempo_features.get('bpm'),
            'beats_count': tempo_features.get('beats_count'),
            # Instruments
            'instrument_predictions': instrument_predictions,
            # Additional features
            'spectral_flux': additional_features.get('spectral_flux'),
            'spectral_flatness': additional_features.get('spectral_flatness'),
            'temporal_centroid': additional_features.get('temporal_centroid'),
            'crest_factor': additional_features.get('crest_factor'),
            # Fundamental frequency (one-shots only)
            'fundamental_frequency': fundamental_freq,
        }

        # Phase 6: Fingerprinting/hash for duplicate detection (all analysis levels)
        step_start = time.time()
        fingerprint_features = extract_fingerprint(audio_path, y, sr)
        debug_log(f"Phase 6: Audio fingerprinting [{(time.time()-step_start)*1000:.0f}ms]")
        features.update(fingerprint_features)

        # Advanced level: Add Phase 1 features (timbral, perceptual, spectral)
        if analysis_level == 'advanced':
            debug_log("--- Starting ADVANCED analysis phases ---")

            # Advanced spectral from basic extraction
            if 'mel_bands_mean' in spectral_features:
                features['mel_bands_mean'] = spectral_features['mel_bands_mean']
                features['mel_bands_std'] = spectral_features['mel_bands_std']

            # Timbral features (Essentia)
            step_start = time.time()
            timbral_features = extract_timbral_features(y, sr)
            debug_log(f"Phase 1: Timbral features (Essentia) [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(timbral_features)

            # Perceptual features (derived)
            step_start = time.time()
            perceptual_features = extract_perceptual_features(
                spectral_features, energy_features, timbral_features
            )
            debug_log(f"Phase 1: Perceptual features [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(perceptual_features)

            # Phase 2: Stereo analysis
            step_start = time.time()
            stereo_features = extract_stereo_features(audio_path, sr)
            debug_log(f"Phase 2: Stereo analysis [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(stereo_features)

            # Phase 2: Harmonic/Percussive separation
            step_start = time.time()
            hpss_features, y_percussive = extract_hpss_features(y, sr)
            debug_log(f"Phase 2: HPSS separation [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(hpss_features)

            # Transient features (reuse y_percussive from HPSS)
            step_start = time.time()
            transient_features = extract_transient_features(y_percussive, sr) if y_percussive is not None else {}
            debug_log(f"Transient features extracted [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(transient_features)

            # Phase 3: Advanced rhythm features
            step_start = time.time()
            rhythm_features = extract_rhythm_features(y, sr, duration, tempo_features)
            debug_log(f"Phase 3: Rhythm features [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(rhythm_features)

            # Phase 3: ADSR envelope
            step_start = time.time()
            adsr_features = extract_adsr_envelope(y, sr)
            debug_log(f"Phase 3: ADSR envelope [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(adsr_features)

            # Phase 4: ML-based instrument classification (PANNs CNN14 or YAMNet)
            step_start = time.time()
            if USE_YAMNET:
                ml_instrument_features = extract_instrument_ml(audio_path, y, sr)
                debug_log(f"Phase 4: YAMNet instrument classification [{(time.time()-step_start)*1000:.0f}ms]")
            else:
                ml_instrument_features = extract_instrument_ml_panns(audio_path, y, sr)
                debug_log(f"Phase 4: PANNs CNN14 instrument classification [{(time.time()-step_start)*1000:.0f}ms]")
                # If PANNs failed (not installed), fall back to YAMNet
                if ml_instrument_features.get('instrument_classes') is None:
                    debug_log("PANNs unavailable, falling back to YAMNet")
                    step_start = time.time()
                    ml_instrument_features = extract_instrument_ml(audio_path, y, sr)
                    debug_log(f"Phase 4: YAMNet fallback [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(ml_instrument_features)

            # Phase 4: Genre/mood classification (heuristics + YAMNet)
            # Pass pre-calculated features to avoid redundant computation
            step_start = time.time()
            genre_features = extract_genre_ml(
                y, sr,
                spectral_features,
                energy_features,
                tempo_features,
                ml_instrument_features.get('instrument_classes'),
                hpss_features.get('harmonic_percussive_ratio'),
                is_one_shot=is_one_shot
            )
            debug_log(f"Phase 4: Genre/mood classification [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(genre_features)

            # Phase 5: EBU R128 loudness analysis
            step_start = time.time()
            loudness_ebu_features = extract_loudness_ebu(y_original, sr)
            debug_log(f"Phase 5: EBU R128 loudness [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(loudness_ebu_features)

            # Phase 5: Sound event detection
            step_start = time.time()
            event_features = detect_sound_events(y, sr, duration)
            debug_log(f"Phase 5: Sound event detection [{(time.time()-step_start)*1000:.0f}ms]")
            features.update(event_features)

        # Generate tags from features
        step_start = time.time()
        suggested_tags = generate_tags(features)
        features['suggested_tags'] = suggested_tags
        debug_log(f"Tag generation: {len(suggested_tags)} tags [{(time.time()-step_start)*1000:.0f}ms]")

        # Add analysis metadata
        total_duration = (time.time() - start_time) * 1000
        features['analysis_duration_ms'] = int(total_duration)

        debug_log(f"=== Analysis complete: {total_duration:.0f}ms total ===")

        return features

    except Exception as e:
        debug_log(f"!!! Analysis FAILED after {(time.time()-start_time)*1000:.0f}ms: {str(e)}")
        raise Exception(f"Audio analysis failed: {str(e)}")


def detect_sample_type(y, sr, duration, filename=None, instrument_predictions=None):
    """
    Detect if audio is a one-shot or loop using multi-evidence voting.

    DESIGN PRINCIPLE: Default to one-shot. A loop must prove itself with
    strong, converging evidence. False negatives (loop classified as one-shot)
    are acceptable; false positives (one-shot classified as loop) are not.
    One-shot and loop are mutually exclusive.

    Args:
        y: Audio time series
        sr: Sample rate
        duration: Duration in seconds
        filename: Original filename (optional)
        instrument_predictions: Pre-calculated instrument predictions from heuristics (optional)

    Returns (is_one_shot, is_loop, confidence).
    """
    os_score = 0.0
    loop_score = 0.0

    # --- Hard rule: very short samples are ALWAYS one-shots ---
    # No percussion hit, crash, or shaker under 2s is a loop.
    if duration < 2.0:
        return (True, False, 1.0)

    # --- Percussion/one-shot keywords for both filename and instrument detection ---
    perc_keywords = ['kick', 'snare', 'hat', 'hihat', 'hi-hat', 'hh',
                     'crash', 'ride', 'tom', 'clap', 'rim', 'shaker',
                     'tambourine', 'cowbell', 'perc', 'conga', 'bongo',
                     'cymbal', 'openhat', 'closedhat', 'oh', 'ch']
    os_keywords = ['shot', 'hit', 'one', 'single', 'oneshot', 'one-shot',
                   'one_shot', 'stab', 'impact', 'fx', 'riser', 'sweep',
                   'boom', 'whoosh', 'transition']
    loop_keywords = ['loop', 'beat', 'groove', 'pattern', 'break', 'fill']

    is_percussion_sample = False

    # --- Check filename for keywords ---
    if filename:
        fname_lower = filename.lower()

        if any(kw in fname_lower for kw in perc_keywords):
            is_percussion_sample = True
            os_score += 5.0  # Very strong one-shot signal

        if any(kw in fname_lower for kw in os_keywords):
            os_score += 4.0

        if any(kw in fname_lower for kw in loop_keywords):
            loop_score += 4.0

    # --- NEW: Check instrument predictions (from heuristic analysis) ---
    # This catches percussion samples where the filename doesn't contain keywords
    # Example: "sample_001.wav" that's actually a clap would get detected here
    if instrument_predictions and not is_percussion_sample:
        for pred in instrument_predictions:
            instrument_name = pred.get('name', '').lower()
            confidence = pred.get('confidence', 0.0)

            # High-confidence percussion detection -> strong one-shot signal
            if confidence >= 0.60:
                for perc_kw in perc_keywords:
                    if perc_kw in instrument_name:
                        is_percussion_sample = True
                        os_score += 4.0  # Strong one-shot signal (slightly less than filename)
                        break
                if is_percussion_sample:
                    break  # Only apply bonus once

    # --- Evidence 1: RMS envelope shape (weight 2.0) ---
    rms = librosa.feature.rms(y=y)[0]

    # Trim RMS to the "active" region using two complementary methods:
    #   1. RMS threshold — frames below -30 dB relative to peak are noise/silence
    #   2. Onset detection — first/last detected event marks content boundaries
    # Onset detection can false-positive on vibrato/noise (known librosa issue),
    # RMS alone can't distinguish low-energy content from background noise.
    # We use the UNION of both (widest reasonable bounds) so neither method
    # alone can over-trim real content.
    rms_trimmed = rms
    if len(rms) > 10:
        # Method 1: RMS energy threshold
        rms_peak = np.max(rms)
        noise_threshold = rms_peak * 0.03  # ~-30 dB below peak
        active_mask = rms > noise_threshold
        active_indices = np.where(active_mask)[0]
        if len(active_indices) >= 2:
            rms_start = active_indices[0]
            rms_end = active_indices[-1]
        else:
            rms_start = 0
            rms_end = len(rms) - 1

        # Method 2: Onset detection (with stricter delta to reduce false positives)
        try:
            onset_frames = safe_onset_detect(
                y=y, sr=sr, units='frames', hop_length=512, delta=0.15
            )
        except Exception:
            onset_frames = np.array([])

        if len(onset_frames) >= 1:
            onset_start = onset_frames[0]
            onset_end = onset_frames[-1]
        else:
            onset_start = rms_start
            onset_end = rms_end

        # Union: take the EARLIER start and LATER end so we don't accidentally
        # clip real content that only one method detected
        trim_start = min(rms_start, onset_start)
        trim_end = max(rms_end, onset_end) + 1
        if trim_end - trim_start >= 10:
            rms_trimmed = rms[trim_start:trim_end]

        # If trimming removed a significant portion, the sample has silence
        # at the edges — this is strong evidence against a seamless loop
        trim_ratio = len(rms_trimmed) / len(rms)
        if trim_ratio < 0.75:
            os_score += 1.5  # >25% of frames are noise floor -> not a loop

    if len(rms_trimmed) > 10:
        peak_idx = np.argmax(rms_trimmed)
        peak_pos_ratio = peak_idx / len(rms_trimmed)
        tail_start = min(peak_idx + 5, len(rms_trimmed) - 1)
        tail_mean = np.mean(rms_trimmed[tail_start:]) + 1e-8
        peak_tail_ratio = rms_trimmed[peak_idx] / tail_mean

        # Clear decay from early peak -> one-shot
        if peak_pos_ratio < 0.3 and peak_tail_ratio > 3.0:
            os_score += 2.0
        # Riser (peak at end) -> one-shot variant
        elif peak_pos_ratio > 0.8:
            os_score += 1.5

        # Very flat RMS is loop evidence, but only a weak signal
        # (many sustained sounds like pads/strings have flat RMS and aren't loops)
        rms_cv = np.std(rms_trimmed) / (np.mean(rms_trimmed) + 1e-8)  # coefficient of variation
        if peak_tail_ratio < 1.3 and rms_cv < 0.15:
            loop_score += 1.0  # Very flat, low variance — mild loop signal

    # --- Evidence 2: Start-end similarity on active content (weight 1.5) ---
    # A seamless loop should have very similar energy at start and end.
    # Uses the trimmed RMS so that matching silence/noise at edges doesn't
    # produce a false high correlation.
    try:
        n_frames = len(rms_trimmed)
        window_frames = max(2, int(n_frames * 0.08))
        start_segment = rms_trimmed[:window_frames]
        end_segment = rms_trimmed[-window_frames:]
        if len(start_segment) == len(end_segment) and len(start_segment) > 2:
            corr = np.corrcoef(start_segment, end_segment)[0, 1]
            if not np.isnan(corr):
                if corr < 0.3:
                    os_score += 1.5  # Very different start/end -> one-shot
                elif corr > 0.85:
                    loop_score += 1.0  # Very high similarity needed for loop evidence
    except Exception:
        pass

    # --- Evidence 3: Onset periodicity (weight 1.5) ---
    # Loops have clearly periodic onsets (repeating rhythmic pattern)
    try:
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        if len(onset_env) > 20:
            autocorr = np.correlate(onset_env, onset_env, mode='full')
            autocorr = autocorr[len(autocorr) // 2:]
            if len(autocorr) > 1:
                autocorr = autocorr / (autocorr[0] + 1e-8)
                # Look for strong periodic peaks (skip first 10% to avoid lag-0 bleed)
                min_lag = max(2, int(len(autocorr) * 0.1))
                autocorr_tail = autocorr[min_lag:]
                if len(autocorr_tail) > 0:
                    max_ac = np.max(autocorr_tail)
                    if max_ac > 0.65:
                        loop_score += 1.5  # Strong periodicity -> loop evidence
                    elif max_ac < 0.3:
                        os_score += 1.0    # No periodicity at all -> one-shot evidence
    except Exception:
        pass

    # --- Evidence 4: Multiple onsets (required for loops) ---
    # A loop must contain multiple distinct rhythmic events
    try:
        onsets = safe_onset_detect(y=y, sr=sr, units='frames', hop_length=512)
        n_onsets = len(onsets)
        if n_onsets <= 1:
            os_score += 2.0  # Single onset = definitively one-shot
        elif n_onsets >= 4 and duration > 2.0:
            loop_score += 0.5  # Multiple onsets, mild loop evidence
    except Exception:
        pass

    # --- Evidence 5: Duration prior (conservative) ---
    if duration < 1.0:
        os_score += 1.0   # Sub-second -> strong one-shot lean
    elif duration > 8.0:
        loop_score += 0.5  # Long samples have slight loop lean (but not decisive)

    # --- Final decision ---
    # Loop requires MINIMUM threshold of evidence to overcome one-shot default.
    min_loop_threshold = 3.0  # Loop needs at least this much evidence to be considered

    # Special handling for percussion samples
    # If percussion detected BUT filename also contains "loop" or BPM, allow loop classification
    # Examples: "clap_loop.wav", "ride_128bpm.wav" should still be able to become loops
    percussion_override_applies = False
    if is_percussion_sample and filename:
        fname_lower = filename.lower()
        # Check if filename suggests it's intentionally a loop
        has_loop_hint = any(kw in fname_lower for kw in loop_keywords)
        has_bpm_hint = bool(re.search(r'\d+\s*bpm', fname_lower))

        if not (has_loop_hint or has_bpm_hint):
            # Percussion with NO loop hints -> require overwhelming evidence for loop
            percussion_override_applies = True

    if percussion_override_applies:
        # For percussion one-shots, require overwhelming evidence (basically impossible)
        # This prevents "clap.wav" or "ride_sample.wav" from being labeled as loops
        if loop_score > 8.0 and loop_score > os_score:
            is_loop = True
            is_one_shot = False
        else:
            is_loop = False
            is_one_shot = True
    else:
        # Normal logic for non-percussion or percussion with loop hints
        if loop_score >= min_loop_threshold and loop_score > os_score:
            is_loop = True
            is_one_shot = False
        else:
            is_loop = False
            is_one_shot = True  # Default: one-shot

    confidence = abs(os_score - loop_score) / (os_score + loop_score + 1e-8)
    return (is_one_shot, is_loop, confidence)


def count_onsets(y, sr):
    """Count number of onsets in audio"""
    try:
        onsets = safe_onset_detect(y=y, sr=sr, units='frames', hop_length=512)
        return len(onsets)
    except:
        return 0


def extract_tempo_features(y, sr):
    """
    Extract tempo/BPM using Essentia if available, fallback to Librosa
    """
    try:
        if essentia is not None:
            # Use Essentia's more accurate tempo extraction
            rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
            bpm, beats, beats_confidence, _, beats_intervals = rhythm_extractor(
                y.astype('float32')
            )
            return {
                'bpm': float(bpm) if bpm > 0 else None,
                'beats_count': int(len(beats)) if len(beats) > 0 else None,
            }
    except:
        pass

    # Fallback to Librosa
    try:
        # Estimate tempo from onset strength
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)

        # Get autocorrelation for tempo estimation
        tempogram = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr)

        # Find the most likely tempo
        if tempogram.shape[1] > 0:
            tempo = librosa.feature.tempo(onset_envelope=onset_env, sr=sr)[0]
            return {
                'bpm': float(tempo) if tempo > 0 else None,
                'beats_count': None,
            }
    except:
        pass

    return {'bpm': None, 'beats_count': None}


def extract_spectral_features(y, sr, level='advanced'):
    """Extract spectral characteristics"""
    # Spectral centroid - brightness indicator
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)

    # Spectral rolloff - frequency below which 85% of energy is concentrated
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)

    # Spectral bandwidth - width of spectrum
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)

    # Spectral contrast - difference between peaks and valleys
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr)

    # Zero crossing rate - texture/noisiness
    zcr = librosa.feature.zero_crossing_rate(y)

    # MFCC - timbral texture (Mel-Frequency Cepstral Coefficients)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)

    result = {
        'spectral_centroid': float(np.mean(centroid)),
        'spectral_rolloff': float(np.mean(rolloff)),
        'spectral_bandwidth': float(np.mean(bandwidth)),
        'spectral_contrast': float(np.mean(contrast)),
        'zero_crossing_rate': float(np.mean(zcr)),
        'mfcc_mean': [float(x) for x in np.mean(mfcc, axis=1)],
    }

    # Advanced level: Add mel bands statistics
    if level == 'advanced':
        mel_spec = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=40)
        mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max)
        result['mel_bands_mean'] = [float(x) for x in np.mean(mel_spec_db, axis=1)]
        result['mel_bands_std'] = [float(x) for x in np.std(mel_spec_db, axis=1)]

    return result


def extract_energy_features(y, sr):
    """Extract dynamics and energy envelope"""
    # RMS energy
    rms = librosa.feature.rms(y=y)
    rms_mean = float(np.mean(rms))

    # Loudness (LUFS-style approximation using dB scale)
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    loudness_mean = float(np.mean(rms_db))

    # Dynamic range
    dynamic_range = float(np.max(rms_db) - np.min(rms_db))

    # Onset strength (punchiness indicator)
    try:
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        onset_strength = float(np.mean(onset_env))
    except:
        onset_strength = 0.0

    return {
        'rms_energy': rms_mean,
        'loudness': loudness_mean,
        'dynamic_range': dynamic_range,
        'onset_strength': onset_strength,
    }


def extract_key_features(y, sr):
    """
    Extract musical key using Essentia KeyExtractor
    Returns key estimate (e.g., "C major") and strength/confidence
    """
    try:
        if essentia is not None:
            # Use Essentia's KeyExtractor for accurate key detection
            key_extractor = es.KeyExtractor()
            key, scale, strength = key_extractor(y.astype('float32'))

            # Format key estimate as "Key Scale" (e.g., "C major", "A minor")
            key_estimate = f"{key} {scale}" if key and scale else None

            return {
                'key_estimate': key_estimate,
                'scale': scale if scale else None,
                'key_strength': float(strength) if strength > 0 else None,
            }
    except Exception as e:
        # Silently handle errors - key detection is optional
        print(f"Warning: Key detection failed: {e}", file=sys.stderr)

    return {'key_estimate': None, 'scale': None, 'key_strength': None}


def estimate_polyphony(y, sr):
    """
    Approximate polyphony by counting strong harmonic peaks per frame.
    Returns an integer estimate (1..8) or None when unavailable.
    """
    try:
        # Focus on harmonic content for a more stable pitch peak count.
        y_harmonic = librosa.effects.harmonic(y)
        stft = np.abs(librosa.stft(y_harmonic, n_fft=4096, hop_length=1024))
        if stft.size == 0 or stft.shape[1] == 0:
            return None

        freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
        valid_idx = np.where((freqs >= 50) & (freqs <= 5000))[0]
        if len(valid_idx) == 0:
            return None

        stft = stft[valid_idx, :]
        if stft.shape[0] < 3:
            return None

        peak_counts = []
        for frame_idx in range(stft.shape[1]):
            spectrum = stft[:, frame_idx]
            peak = np.max(spectrum)
            if peak <= 1e-8:
                continue

            # Keep prominent local maxima only.
            threshold = peak * 0.2
            local_peaks = np.where(
                (spectrum[1:-1] > spectrum[:-2]) &
                (spectrum[1:-1] >= spectrum[2:]) &
                (spectrum[1:-1] >= threshold)
            )[0] + 1

            if len(local_peaks) == 0:
                continue

            mags = spectrum[local_peaks]
            prominent_count = int(np.sum(mags >= (np.max(mags) * 0.35)))
            peak_counts.append(max(1, min(prominent_count, 8)))

        if len(peak_counts) == 0:
            return None

        # Median improves stability against transient frames.
        return int(np.clip(np.round(np.median(peak_counts)), 1, 8))
    except Exception:
        return None


def extract_timbral_features(y, sr):
    """
    Extract advanced timbral features using Essentia (Phase 1)
    Returns dict with dissonance, inharmonicity, tristimulus, etc.
    """
    features = {}

    try:
        if essentia is not None:
            # Convert to float32 for Essentia
            audio_essentia = y.astype('float32')

            # Set up Essentia processing chain for spectral analysis
            w = es.Windowing(type='hann')
            spectrum = es.Spectrum()
            spectral_peaks = es.SpectralPeaks()

            # Initialize extractors ONCE outside the loop
            dissonance_extractor = es.Dissonance()
            inharmonicity_extractor = es.Inharmonicity()
            tristimulus_extractor = es.Tristimulus()

            # Process in frames to get average values
            # OPTIMIZED: Single loop for all three features instead of 3 separate loops
            frame_size = 2048
            hop_size = 512

            dissonance_values = []
            inharmonicity_values = []
            t1_values, t2_values, t3_values = [], [], []
            crest_values = []
            crest = es.Crest()

            num_frames = (len(audio_essentia) - frame_size) // hop_size
            debug_log(f"  Processing {num_frames} frames for timbral features...")
            frame_start = time.time()

            try:
                # Single pass through frames - extract all features at once
                for i in range(0, len(audio_essentia) - frame_size, hop_size):
                    frame = audio_essentia[i:i + frame_size]
                    windowed = w(frame)
                    spec = spectrum(windowed)
                    freqs, mags = spectral_peaks(spec)

                    if len(freqs) > 0:
                        # Dissonance - harmonic dissonance
                        try:
                            diss = dissonance_extractor(freqs, mags)
                            dissonance_values.append(diss)
                        except:
                            pass

                        # Inharmonicity - deviation from perfect harmonic structure
                        # Note: Only works for pitched sounds with clear fundamental frequency
                        try:
                            inharm = inharmonicity_extractor(freqs, mags)
                            if inharm > 0:  # Valid result
                                inharmonicity_values.append(inharm)
                        except:
                            # Skip frames without clear fundamental frequency
                            pass

                        # Tristimulus - 3-value tonal color descriptor
                        try:
                            t1, t2, t3 = tristimulus_extractor(freqs, mags)
                            t1_values.append(t1)
                            t2_values.append(t2)
                            t3_values.append(t3)
                        except:
                            pass

                    # Spectral Crest (computed for every frame, no freqs/mags dependency)
                    try:
                        crest_values.append(crest(spec))
                    except:
                        pass

                # Aggregate results
                debug_log(f"  Frame processing complete [{(time.time()-frame_start)*1000:.0f}ms] - dissonance:{len(dissonance_values)}, inharm:{len(inharmonicity_values)}, tristim:{len(t1_values)}")
                features['dissonance'] = float(np.mean(dissonance_values)) if dissonance_values else None
                features['inharmonicity'] = float(np.mean(inharmonicity_values)) if inharmonicity_values else None
                features['tristimulus'] = [
                    float(np.mean(t1_values)),
                    float(np.mean(t2_values)),
                    float(np.mean(t3_values))
                ] if t1_values else None

                features['spectral_crest'] = float(np.mean(crest_values)) if crest_values else None

            except Exception as e:
                debug_log(f"  Timbral feature extraction failed: {e}")
                print(f"Warning: Timbral feature extraction failed: {e}", file=sys.stderr)
                features['dissonance'] = None
                features['inharmonicity'] = None
                features['tristimulus'] = None
                features['spectral_crest'] = None

            # Spectral Complexity (still inside "if essentia is not None" block)
            try:
                complexity_extractor = es.SpectralComplexity()
                complexity = complexity_extractor(audio_essentia)
                features['spectral_complexity'] = float(complexity)
            except:
                features['spectral_complexity'] = None

        else:
            # Essentia not available - set all to None
            features['dissonance'] = None
            features['inharmonicity'] = None
            features['tristimulus'] = None
            features['spectral_complexity'] = None
            features['spectral_crest'] = None

    except Exception as e:
        # If Essentia fails entirely, return None for all
        print(f"Warning: Timbral feature extraction failed: {e}", file=sys.stderr)
        features = {
            'dissonance': None,
            'inharmonicity': None,
            'tristimulus': None,
            'spectral_complexity': None,
            'spectral_crest': None,
        }

    return features


def extract_perceptual_features(spectral_features, energy_features, timbral_features):
    """
    Extract perceptual features (Phase 1)
    These are derived from other features and normalized to 0-1 range
    """
    features = {}

    # Brightness - normalized spectral centroid
    # Typical range: 500-8000 Hz
    centroid = spectral_features['spectral_centroid']
    features['brightness'] = min(max((centroid - 500) / 7500, 0.0), 1.0)

    # Warmth - inverse of brightness, emphasizes low-frequency content
    # Based on spectral rolloff
    rolloff = spectral_features['spectral_rolloff']
    # Typical rolloff: 1000-12000 Hz
    # Lower rolloff = warmer sound
    warmth_raw = 1.0 - min(max((rolloff - 1000) / 11000, 0.0), 1.0)
    features['warmth'] = warmth_raw

    # Hardness - combination of attack (RMS energy) and brightness
    # High energy + high brightness = hard sound
    rms = energy_features['rms_energy']
    # Normalize RMS (typical: 0.01-0.3)
    rms_norm = min(max(rms / 0.3, 0.0), 1.0)
    features['hardness'] = (features['brightness'] * 0.6 + rms_norm * 0.4)

    # Roughness - based on dissonance if available, otherwise zero crossing rate
    if timbral_features.get('dissonance') is not None:
        # Essentia dissonance is typically 0-1
        features['roughness'] = min(max(timbral_features['dissonance'], 0.0), 1.0)
    else:
        # Fallback: high ZCR indicates roughness
        zcr = spectral_features['zero_crossing_rate']
        # Typical ZCR: 0.0-0.3
        features['roughness'] = min(max(zcr / 0.3, 0.0), 1.0)

    # Sharpness - spectral centroid weighted towards high frequencies
    # Similar to brightness but more extreme
    # High centroid = sharp sound
    features['sharpness'] = min(max((centroid - 2000) / 6000, 0.0), 1.0)

    return features


def extract_stereo_features(audio_path, sr):
    """
    Extract stereo analysis features (Phase 2)
    Loads audio in stereo to analyze L/R characteristics
    Returns dict with stereo_width, panning_center, stereo_imbalance
    """
    features = {
        'stereo_width': None,
        'panning_center': None,
        'stereo_imbalance': None,
    }

    try:
        # Load audio in STEREO (mono=False)
        y_stereo, _ = librosa.load(audio_path, sr=sr, mono=False)

        # If file is mono, return None for all stereo features
        if y_stereo.ndim == 1:
            return features

        # Extract left and right channels
        left = y_stereo[0]
        right = y_stereo[1]

        # Stereo Width: Based on L/R correlation
        # 1 - |correlation| gives width (0 = mono, 1 = wide)
        correlation = np.corrcoef(left, right)[0, 1]
        if not np.isnan(correlation):
            features['stereo_width'] = float(1.0 - abs(correlation))
        else:
            features['stereo_width'] = 0.0

        # Panning Center: Dominant panning position
        # 0 = left, 0.5 = center, 1 = right
        left_energy = np.sum(left ** 2)
        right_energy = np.sum(right ** 2)
        total_energy = left_energy + right_energy

        if total_energy > 0:
            # Normalize to 0-1 range (0.5 = center)
            features['panning_center'] = float(right_energy / total_energy)
        else:
            features['panning_center'] = 0.5

        # Stereo Imbalance: Energy difference between channels
        # 0 = balanced, 1 = completely in one channel
        if total_energy > 0:
            imbalance = abs(left_energy - right_energy) / total_energy
            features['stereo_imbalance'] = float(imbalance)
        else:
            features['stereo_imbalance'] = 0.0

    except Exception as e:
        print(f"Warning: Stereo feature extraction failed: {e}", file=sys.stderr)

    return features


def extract_hpss_features(y, sr):
    """
    Extract Harmonic/Percussive Separation features (Phase 2)
    Uses librosa.effects.hpss() to separate components and analyze each
    Returns (features_dict, y_percussive) tuple
    """
    features = {
        'harmonic_percussive_ratio': None,
        'harmonic_energy': None,
        'percussive_energy': None,
        'harmonic_centroid': None,
        'percussive_centroid': None,
    }
    y_percussive_out = None

    try:
        # Separate harmonic and percussive components
        y_harmonic, y_percussive = librosa.effects.hpss(y)
        y_percussive_out = y_percussive

        # Calculate energies
        harmonic_energy = float(np.sum(y_harmonic ** 2))
        percussive_energy = float(np.sum(y_percussive ** 2))

        features['harmonic_energy'] = harmonic_energy
        features['percussive_energy'] = percussive_energy

        # Calculate ratio (avoid division by zero)
        if percussive_energy > 1e-6:
            features['harmonic_percussive_ratio'] = float(harmonic_energy / percussive_energy)
        else:
            features['harmonic_percussive_ratio'] = 10.0  # Very harmonic

        # Calculate spectral centroids for each component
        try:
            harmonic_centroid = librosa.feature.spectral_centroid(y=y_harmonic, sr=sr)[0]
            features['harmonic_centroid'] = float(np.mean(harmonic_centroid))
        except:
            features['harmonic_centroid'] = None

        try:
            percussive_centroid = librosa.feature.spectral_centroid(y=y_percussive, sr=sr)[0]
            features['percussive_centroid'] = float(np.mean(percussive_centroid))
        except:
            features['percussive_centroid'] = None

    except Exception as e:
        print(f"Warning: HPSS feature extraction failed: {e}", file=sys.stderr)

    return features, y_percussive_out


def extract_rhythm_features(y, sr, duration, tempo_features):
    """
    Extract advanced rhythm features (Phase 3)
    Args:
        y: Audio time series
        sr: Sample rate
        duration: Duration in seconds
        tempo_features: Dict with 'bpm' and 'beats_count' from extract_tempo_features
    Returns dict with onset_rate, beat_strength, rhythmic_regularity, danceability
    """
    features = {
        'onset_rate': None,
        'beat_strength': None,
        'rhythmic_regularity': None,
        'danceability': None,
    }

    try:
        # Detect onsets
        onset_frames = safe_onset_detect(y=y, sr=sr, units='frames', hop_length=512)
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=512)

        # Onset Rate: Onsets per second
        if duration > 0:
            features['onset_rate'] = float(len(onset_times) / duration)
        else:
            features['onset_rate'] = 0.0

        # Beat Strength: Onset envelope strength
        try:
            onset_env = librosa.onset.onset_strength(y=y, sr=sr)
            features['beat_strength'] = float(np.mean(onset_env))
        except:
            features['beat_strength'] = 0.0

        # Rhythmic Regularity: Variance in onset intervals (lower = more regular)
        # We use coefficient of variation (std/mean) to normalize across different tempos
        if len(onset_times) > 2:
            intervals = np.diff(onset_times)
            if len(intervals) > 0 and np.mean(intervals) > 0:
                # Coefficient of variation (inverted and clamped to 0-1)
                cv = np.std(intervals) / np.mean(intervals)
                # Convert to regularity score: lower variance = higher regularity
                regularity = max(0.0, 1.0 - min(cv, 1.0))
                features['rhythmic_regularity'] = float(regularity)
            else:
                features['rhythmic_regularity'] = 0.0
        else:
            features['rhythmic_regularity'] = 0.0

        # Danceability: Combination of tempo, beat strength, and regularity
        # Only calculate for samples with detected tempo
        bpm = tempo_features.get('bpm')
        if bpm is not None and bpm > 0:
            # Normalize BPM to 0-1 range (optimal dance tempo: 100-140 BPM)
            bpm_score = 0.0
            if 100 <= bpm <= 140:
                bpm_score = 1.0  # Optimal range
            elif 80 <= bpm < 100:
                bpm_score = 0.5 + (bpm - 80) / 40  # 0.5 to 1.0
            elif 140 < bpm <= 180:
                bpm_score = 1.0 - (bpm - 140) / 80  # 1.0 to 0.5
            elif bpm < 80:
                bpm_score = bpm / 80  # 0 to 0.5
            else:
                bpm_score = max(0.0, 0.5 - (bpm - 180) / 180)  # Decreasing after 180

            # Normalize beat strength (typical range: 0-3.0)
            beat_strength_score = min(features['beat_strength'] / 3.0, 1.0) if features['beat_strength'] else 0.0

            # Combine: BPM (40%), beat strength (30%), regularity (30%)
            danceability = (
                bpm_score * 0.4 +
                beat_strength_score * 0.3 +
                features['rhythmic_regularity'] * 0.3
            )
            features['danceability'] = float(min(max(danceability, 0.0), 1.0))
        else:
            features['danceability'] = None

    except Exception as e:
        print(f"Warning: Rhythm feature extraction failed: {e}", file=sys.stderr)

    return features


def extract_adsr_envelope(y, sr):
    """
    Extract ADSR envelope features (Phase 3)
    Analyzes the RMS envelope to extract attack, decay, sustain, release times
    Args:
        y: Audio time series
        sr: Sample rate
    Returns dict with attack_time, decay_time, sustain_level, release_time, envelope_type
    """
    features = {
        'attack_time': None,
        'decay_time': None,
        'sustain_level': None,
        'release_time': None,
        'envelope_type': None,
    }

    try:
        # Calculate RMS envelope
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]

        if len(rms) < 10:
            return features  # Too short to analyze

        # Smooth the envelope
        from scipy.ndimage import gaussian_filter1d
        rms_smooth = gaussian_filter1d(rms, sigma=2)

        # Find peak
        peak_idx = np.argmax(rms_smooth)
        peak_value = rms_smooth[peak_idx]

        if peak_value < 1e-6:
            return features  # Signal too quiet

        # Convert frame index to time
        hop_length = 512
        frame_to_time = lambda idx: (idx * hop_length) / sr

        # Attack Time: Time from start to peak
        # Find where envelope crosses 10% of peak
        attack_threshold = peak_value * 0.1
        attack_start_idx = 0
        for i in range(peak_idx):
            if rms_smooth[i] >= attack_threshold:
                attack_start_idx = i
                break

        features['attack_time'] = float(frame_to_time(peak_idx - attack_start_idx))

        # Decay Time: Time from peak to sustain level
        # Sustain is the relatively stable level after decay
        # Find sustain level by averaging the middle 40-80% of the tail
        if peak_idx < len(rms_smooth) - 5:
            tail = rms_smooth[peak_idx:]
            tail_mid_start = int(len(tail) * 0.4)
            tail_mid_end = int(len(tail) * 0.8)

            if tail_mid_end > tail_mid_start:
                sustain_level = np.mean(tail[tail_mid_start:tail_mid_end])
            else:
                sustain_level = tail[-1] if len(tail) > 0 else peak_value * 0.1

            # Normalize sustain level relative to peak
            features['sustain_level'] = float(sustain_level / peak_value)

            # Find decay time: time from peak to sustain level
            decay_threshold = peak_value - (peak_value - sustain_level) * 0.8
            decay_end_idx = peak_idx
            for i in range(peak_idx, len(rms_smooth)):
                if rms_smooth[i] <= decay_threshold:
                    decay_end_idx = i
                    break

            features['decay_time'] = float(frame_to_time(decay_end_idx - peak_idx))

            # Release Time: Time from sustain to 10% of peak
            release_threshold = peak_value * 0.1
            release_start_idx = decay_end_idx
            release_end_idx = len(rms_smooth) - 1

            for i in range(decay_end_idx, len(rms_smooth)):
                if rms_smooth[i] <= release_threshold:
                    release_end_idx = i
                    break

            features['release_time'] = float(frame_to_time(release_end_idx - release_start_idx))
        else:
            # Short tail - minimal decay/sustain/release
            features['sustain_level'] = 0.0
            features['decay_time'] = 0.0
            features['release_time'] = 0.0

        # Classify Envelope Type based on ADSR characteristics
        attack = features['attack_time']
        decay = features['decay_time']
        sustain = features['sustain_level']
        release = features['release_time']

        if attack is not None and sustain is not None:
            # Percussive: Fast attack, low sustain, fast decay
            if attack < 0.01 and sustain < 0.2 and decay < 0.1:
                features['envelope_type'] = 'percussive'
            # Plucked: Fast attack, medium decay, low sustain
            elif attack < 0.02 and sustain < 0.4 and decay < 0.3:
                features['envelope_type'] = 'plucked'
            # Pad: Very slow attack and/or very slow release (check BEFORE sustained)
            elif attack > 0.1 or (release is not None and release > 0.5):
                features['envelope_type'] = 'pad'
            # Sustained: Slow attack or high sustain level
            elif attack > 0.05 or sustain > 0.6:
                features['envelope_type'] = 'sustained'
            else:
                features['envelope_type'] = 'hybrid'
        else:
            features['envelope_type'] = None

    except Exception as e:
        print(f"Warning: ADSR envelope extraction failed: {e}", file=sys.stderr)

    return features


def load_yamnet_model():
    """
    Load YAMNet model from TensorFlow Hub (cached globally)
    Returns: (model, class_names)
    """
    global _yamnet_model, _yamnet_class_names

    if _yamnet_model is not None:
        debug_log("YAMNet model already cached")
        return _yamnet_model, _yamnet_class_names

    if tf is None or hub is None:
        debug_log("TensorFlow/Hub not available, skipping YAMNet")
        return None, None

    try:
        load_start = time.time()
        debug_log("Loading YAMNet model from TensorFlow Hub...")
        print("Loading YAMNet model... (this may take a few seconds on first run)", file=sys.stderr)
        _yamnet_model = hub.load('https://tfhub.dev/google/yamnet/1')
        debug_log(f"YAMNet model downloaded/loaded [{(time.time()-load_start)*1000:.0f}ms]")

        # Load class names (CSV format: index,mid,display_name)
        import csv
        class_map_path = _yamnet_model.class_map_path().numpy().decode('utf-8')
        with open(class_map_path) as f:
            reader = csv.reader(f)
            next(reader)  # Skip header row
            _yamnet_class_names = []
            for row in reader:
                if len(row) >= 3:
                    name = row[2].strip()
                else:
                    # Fallback: try splitting by comma manually
                    parts = row[0].split(',')
                    name = parts[2].strip() if len(parts) >= 3 else parts[-1].strip()
                # Validate: skip entries that look like raw ontology IDs
                if '/m/' in name or name.isdigit():
                    name = f"unknown_class_{len(_yamnet_class_names)}"
                _yamnet_class_names.append(name)

        print(f"YAMNet model loaded successfully ({len(_yamnet_class_names)} classes)", file=sys.stderr)
        debug_log(f"YAMNet total load time: {(time.time()-load_start)*1000:.0f}ms")
        return _yamnet_model, _yamnet_class_names
    except Exception as e:
        debug_log(f"YAMNet loading failed: {e}")
        print(f"Warning: Failed to load YAMNet model: {e}", file=sys.stderr)
        return None, None


def extract_instrument_ml(audio_path, y, sr):
    """
    Extract instrument/audio event classification using YAMNet (Phase 4)
    Args:
        audio_path: Path to audio file
        y: Audio time series (mono, float32)
        sr: Sample rate
    Returns:
        dict with instrument_classes (list) and yamnet_embeddings (1024-dim array)
    """
    features = {
        'instrument_classes': None,
        'yamnet_embeddings': None,
    }

    try:
        model, class_names = load_yamnet_model()
        if model is None or class_names is None:
            debug_log("YAMNet not available, skipping ML instrument extraction")
            return features

        # YAMNet expects 16kHz mono audio
        resample_start = time.time()
        if sr != 16000:
            y_16k = librosa.resample(y, orig_sr=sr, target_sr=16000)
            debug_log(f"  Resampled audio to 16kHz [{(time.time()-resample_start)*1000:.0f}ms]")
        else:
            y_16k = y

        # Convert to float32
        waveform = y_16k.astype(np.float32)

        # Run inference
        inference_start = time.time()
        debug_log(f"  Running YAMNet inference on {len(waveform)} samples...")
        scores, embeddings, spectrogram = model(waveform)
        debug_log(f"  YAMNet inference complete [{(time.time()-inference_start)*1000:.0f}ms]")

        # Get mean scores across all frames
        mean_scores = np.mean(scores.numpy(), axis=0)

        # Get top predictions
        top_indices = np.argsort(mean_scores)[::-1][:20]  # Top 20

        # Filter for instrument-related classes
        # Blocklist: generic/useless YAMNet classes that don't help identify instruments
        yamnet_blocklist = {
            'music', 'singing', 'song', 'speech', 'tender music', 'sad music',
            'happy music', 'music of asia', 'music of africa', 'music of latin america',
            'pop music', 'rock music', 'hip hop music', 'electronic music',
            'christian music', 'wedding music', 'new-age music', 'independent music',
            'theme music', 'background music', 'video game music', 'christmas music',
            'dance music', 'soul music', 'gospel music', 'disco', 'funk',
            'musical instrument', 'plucked string instrument', 'bowed string instrument',
            'wind instrument, woodwind instrument', 'sound effect', 'noise',
            'inside, small room', 'outside, urban or manmade', 'outside, rural or natural',
            'silence', 'white noise', 'pink noise', 'static',
        }

        # YAMNet class categories we care about (actual instruments/sounds)
        instrument_keywords = [
            'guitar', 'drum', 'bass', 'piano', 'keyboard', 'synth',
            'violin', 'brass', 'trumpet', 'saxophone', 'flute', 'organ',
            'percussion', 'cymbal',
            'snare', 'kick', 'hi-hat', 'tom', 'clap', 'cowbell', 'shaker',
            'tambourine', 'bell', 'chime', 'pluck', 'strum', 'string',
            'marimba', 'xylophone', 'harmonica', 'harp', 'ukulele', 'banjo',
            'cello', 'viola', 'trombone', 'tuba', 'clarinet', 'oboe',
            'bass drum', 'gong', 'tabla', 'bongo', 'conga', 'woodblock',
            'glockenspiel', 'vibraphone', 'steelpan', 'accordion',
            'synthesizer', 'electric piano', 'drum kit', 'drum machine',
        ]

        instrument_predictions = []
        for idx in top_indices:
            class_name = class_names[idx]
            confidence = float(mean_scores[idx])
            class_lower = class_name.lower()

            # Skip blocklisted generic classes
            if class_lower in yamnet_blocklist:
                continue

            # Skip entries with AudioSet ontology IDs leaking through
            if '/m/' in class_name or class_name.replace(' ', '').replace(',', '').isdigit():
                continue

            # Check if this class is instrument-related
            if any(keyword in class_lower for keyword in instrument_keywords):
                instrument_predictions.append({
                    'class': class_name,
                    'confidence': confidence
                })

            # Limit to top 10 instrument predictions
            if len(instrument_predictions) >= 10:
                break

        features['instrument_classes'] = instrument_predictions

        # Get mean embedding across all frames (1024-dim vector for similarity)
        mean_embedding = np.mean(embeddings.numpy(), axis=0)
        features['yamnet_embeddings'] = mean_embedding.tolist()

    except Exception as e:
        print(f"Warning: YAMNet inference failed: {e}", file=sys.stderr)

    return features


USE_YAMNET = env_flag('AUDIO_ANALYSIS_USE_YAMNET', False)

_panns_model = None
_panns_labels = None

def load_panns_model():
    """
    Load PANNs CNN14 model for audio classification and embedding extraction.
    Returns: (model, labels) or (None, None) on failure.
    """
    global _panns_model, _panns_labels

    if _panns_model is not None:
        debug_log("PANNs model already cached")
        return _panns_model, _panns_labels

    try:
        load_start = time.time()
        debug_log("Loading PANNs CNN14 model...")
        print("Loading PANNs CNN14 model... (this may take a few seconds on first run)", file=sys.stderr)

        from panns_inference import AudioTagging
        _panns_model = AudioTagging(checkpoint_path=None, device='cpu')

        # AudioSet 527 class labels
        import panns_inference
        labels_path = os.path.join(os.path.dirname(panns_inference.__file__), 'class_labels_indices.csv')
        _panns_labels = []
        if os.path.exists(labels_path):
            import csv
            with open(labels_path) as f:
                reader = csv.reader(f)
                next(reader)  # skip header
                for row in reader:
                    if len(row) >= 3:
                        _panns_labels.append(row[2].strip())
                    else:
                        _panns_labels.append(f"class_{len(_panns_labels)}")
        else:
            # Fallback: use numbered labels
            _panns_labels = [f"class_{i}" for i in range(527)]

        print(f"PANNs CNN14 model loaded ({len(_panns_labels)} classes) [{(time.time()-load_start)*1000:.0f}ms]", file=sys.stderr)
        return _panns_model, _panns_labels
    except ImportError as e:
        debug_log(f"PANNs not available (missing panns_inference package): {e}")
        print(f"Warning: PANNs not available, falling back to YAMNet: {e}", file=sys.stderr)
        return None, None
    except Exception as e:
        debug_log(f"PANNs loading failed: {e}")
        print(f"Warning: Failed to load PANNs model: {e}", file=sys.stderr)
        return None, None


def extract_instrument_ml_panns(audio_path, y, sr):
    """
    Extract instrument/audio classification and embeddings using PANNs CNN14.
    Returns dict with instrument_classes, ml_embeddings, ml_embedding_model.
    """
    features = {
        'instrument_classes': None,
        'ml_embeddings': None,
        'ml_embedding_model': None,
    }

    try:
        model, labels = load_panns_model()
        if model is None or labels is None:
            debug_log("PANNs not available, skipping")
            return features

        # PANNs expects 32kHz mono audio
        resample_start = time.time()
        if sr != 32000:
            y_32k = librosa.resample(y, orig_sr=sr, target_sr=32000)
            debug_log(f"  Resampled audio to 32kHz [{(time.time()-resample_start)*1000:.0f}ms]")
        else:
            y_32k = y

        # Run inference — expects [batch, samples] shape
        waveform = y_32k[np.newaxis, :].astype(np.float32)
        inference_start = time.time()
        debug_log(f"  Running PANNs inference on {waveform.shape[1]} samples...")
        clipwise_output, embedding = model.inference(waveform)
        debug_log(f"  PANNs inference done [{(time.time()-inference_start)*1000:.0f}ms]")

        # clipwise_output shape: [1, 527]  — class predictions
        # embedding shape: [1, 2048]        — 2048-dim embeddings
        predictions = clipwise_output[0]
        emb = embedding[0]

        # Extract top instrument predictions
        instrument_keywords = [
            'drum', 'percussion', 'bass', 'guitar', 'piano', 'keyboard', 'organ',
            'synth', 'violin', 'cello', 'flute', 'trumpet', 'saxophone', 'horn',
            'singing', 'vocal', 'voice', 'speech', 'rap', 'choir',
            'clap', 'snap', 'cymbal', 'hi-hat', 'snare', 'kick',
            'bell', 'gong', 'harmonica', 'banjo', 'ukulele', 'harp',
            'marimba', 'xylophone', 'vibraphone', 'tambourine',
            'sound effect', 'noise', 'explosion', 'whoosh',
        ]

        sorted_indices = np.argsort(predictions)[::-1]
        instrument_predictions = []
        for idx in sorted_indices[:50]:
            confidence = float(predictions[idx])
            if confidence < 0.05:
                break
            class_name = labels[idx] if idx < len(labels) else f"class_{idx}"
            class_lower = class_name.lower()
            if any(kw in class_lower for kw in instrument_keywords):
                instrument_predictions.append({
                    'class': class_name,
                    'confidence': confidence
                })
                if len(instrument_predictions) >= 10:
                    break

        features['instrument_classes'] = instrument_predictions
        features['ml_embeddings'] = emb.tolist()
        features['ml_embedding_model'] = 'panns_cnn14'

    except Exception as e:
        print(f"Warning: PANNs inference failed: {e}", file=sys.stderr)

    return features


def extract_genre_ml(y, sr, spectral_features=None, energy_features=None, tempo_features=None, yamnet_instruments=None, hpss_ratio=None, is_one_shot=False):
    """
    Extract genre and mood classification using audio feature heuristics (Phase 4)
    Args:
        y: Audio time series (mono, float32)
        sr: Sample rate
        spectral_features: Pre-calculated spectral features dict (optional, avoids recalculation)
        energy_features: Pre-calculated energy features dict (optional, avoids recalculation)
        tempo_features: Pre-calculated tempo features dict (optional, avoids recalculation)
        yamnet_instruments: Optional YAMNet instrument classifications to boost genre detection
        hpss_ratio: Optional pre-calculated harmonic/percussive ratio from Phase 2
        is_one_shot: If True, skip genre classification (unreliable for isolated samples)
    Returns:
        dict with genre_classes, genre_primary, mood_classes
    """
    features = {
        'genre_classes': None,
        'genre_primary': None,
        'mood_classes': None,
    }

    # Genre on isolated one-shot samples is unreliable — skip
    if is_one_shot:
        return features

    try:
        # Use pre-calculated features if available, otherwise calculate
        if spectral_features:
            spectral_centroid = spectral_features['spectral_centroid']
            spectral_rolloff = spectral_features['spectral_rolloff']
            zero_crossing_rate = spectral_features['zero_crossing_rate']
        else:
            spectral_centroid = np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))
            spectral_rolloff = np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))
            zero_crossing_rate = np.mean(librosa.feature.zero_crossing_rate(y))

        if energy_features:
            rms_mean = energy_features['rms_energy']
            loudness = energy_features['loudness']
            dynamic_range = energy_features['dynamic_range']
        else:
            rms = librosa.feature.rms(y=y)
            rms_mean = np.mean(rms)
            rms_db = librosa.amplitude_to_db(rms, ref=np.max)
            loudness = np.mean(rms_db)
            dynamic_range = np.max(rms_db) - np.min(rms_db)

        # Get tempo from pre-calculated or calculate if needed
        if tempo_features and tempo_features.get('bpm'):
            tempo = tempo_features['bpm']
        else:
            try:
                tempo = librosa.feature.tempo(y=y, sr=sr)[0]
            except:
                tempo = 120.0

        # Use pre-calculated HPSS ratio if available (from Phase 2),
        # otherwise approximate with zero crossing rate
        if hpss_ratio is not None:
            hp_ratio = hpss_ratio
        else:
            # Fallback: Use zero crossing rate as proxy for percussiveness
            percussiveness = zero_crossing_rate * 10  # Scale to roughly 0-2 range
            hp_ratio = 1.0 / (percussiveness + 0.1)  # Inverse for harmonic/percussive ratio

        # Genre classification based on audio features
        genre_scores = {}

        # Boost genre scores based on YAMNet instrument detections
        yamnet_genre_hints = {}
        if yamnet_instruments:
            for instrument in yamnet_instruments:
                class_name = instrument['class'].lower()
                confidence = instrument['confidence']

                # Map YAMNet classes to genre hints
                if any(x in class_name for x in ['techno', 'electronic', 'synthesizer', 'synth']):
                    yamnet_genre_hints['electronic'] = yamnet_genre_hints.get('electronic', 0) + confidence * 0.3
                if any(x in class_name for x in ['rock', 'guitar', 'electric guitar', 'distortion']):
                    yamnet_genre_hints['rock'] = yamnet_genre_hints.get('rock', 0) + confidence * 0.3
                if any(x in class_name for x in ['hip hop', 'rap', 'trap']):
                    yamnet_genre_hints['hip-hop'] = yamnet_genre_hints.get('hip-hop', 0) + confidence * 0.3
                if any(x in class_name for x in ['jazz', 'saxophone', 'trumpet', 'brass']):
                    yamnet_genre_hints['jazz'] = yamnet_genre_hints.get('jazz', 0) + confidence * 0.3
                if any(x in class_name for x in ['classical', 'orchestra', 'violin', 'cello', 'piano']):
                    yamnet_genre_hints['classical'] = yamnet_genre_hints.get('classical', 0) + confidence * 0.3
                if any(x in class_name for x in ['house', 'disco']):
                    yamnet_genre_hints['house'] = yamnet_genre_hints.get('house', 0) + confidence * 0.3
                if any(x in class_name for x in ['drum and bass', 'jungle']):
                    yamnet_genre_hints['drum-and-bass'] = yamnet_genre_hints.get('drum-and-bass', 0) + confidence * 0.3
                if any(x in class_name for x in ['dubstep', 'bass music']):
                    yamnet_genre_hints['dubstep'] = yamnet_genre_hints.get('dubstep', 0) + confidence * 0.3
                if any(x in class_name for x in ['ambient', 'drone']):
                    yamnet_genre_hints['ambient'] = yamnet_genre_hints.get('ambient', 0) + confidence * 0.3

        # Electronic/EDM: High energy, strong percussive, 120-140 BPM, bright
        if 100 <= tempo <= 140 and spectral_centroid > 2000 and hp_ratio < 1.5:
            genre_scores['electronic'] = 0.7 + min((rms_mean / 0.3) * 0.2, 0.2)

        # Hip-Hop/Trap: 60-100 BPM, strong bass, percussive
        if 60 <= tempo <= 100 and spectral_rolloff < 3000 and hp_ratio < 1.0:
            # Use inverse hp_ratio as percussiveness metric
            percussiveness_score = 1.0 / (hp_ratio + 0.1) if hp_ratio > 0 else 1.0
            genre_scores['hip-hop'] = 0.65 + min(percussiveness_score * 0.15, 0.25)

        # House/Techno: 120-130 BPM, 4/4 kick pattern, repetitive
        if 118 <= tempo <= 132 and hp_ratio < 0.8 and rms_mean > 0.1:
            genre_scores['house'] = 0.6 + min((130 - abs(tempo - 125)) / 30, 0.3)

        # Drum & Bass: 160-180 BPM, very percussive, high energy
        if 160 <= tempo <= 185 and hp_ratio < 0.5 and rms_mean > 0.15:
            genre_scores['drum-and-bass'] = 0.75

        # Ambient/Downtempo: Slow, low energy, harmonic, sustained
        if tempo < 100 and hp_ratio > 2.0 and loudness < -20:
            genre_scores['ambient'] = 0.6 + min((hp_ratio / 5.0) * 0.3, 0.3)

        # Rock/Metal: Mid-high energy, distorted (high ZCR), 100-160 BPM
        if 100 <= tempo <= 160 and zero_crossing_rate > 0.1 and dynamic_range > 20:
            genre_scores['rock'] = 0.55 + min((zero_crossing_rate / 0.2) * 0.25, 0.25)

        # Jazz/Funk: Complex rhythms, harmonic, 80-140 BPM, dynamic
        if 80 <= tempo <= 140 and hp_ratio > 1.2 and dynamic_range > 25:
            genre_scores['jazz'] = 0.5 + min((dynamic_range / 40) * 0.3, 0.3)

        # Pop: Moderate everything, 100-130 BPM, balanced
        if 100 <= tempo <= 130 and 0.8 < hp_ratio < 1.5 and -20 < loudness < -5:
            genre_scores['pop'] = 0.5

        # Classical: Very harmonic, wide dynamic range, variable tempo
        if hp_ratio > 3.0 and dynamic_range > 30:
            genre_scores['classical'] = 0.65

        # Dubstep: 140 BPM (half-time 70), very bass-heavy, dynamic
        if 135 <= tempo <= 145 and spectral_rolloff < 2500 and dynamic_range > 25:
            genre_scores['dubstep'] = 0.7

        # Boost scores with YAMNet instrument hints
        for genre, boost in yamnet_genre_hints.items():
            if genre in genre_scores:
                genre_scores[genre] = min(genre_scores[genre] + boost, 0.95)
            else:
                # YAMNet detected instruments for a genre we didn't score
                genre_scores[genre] = boost

        # Create genre classes list
        if genre_scores:
            genre_classes = [
                {'genre': genre, 'confidence': float(confidence)}
                for genre, confidence in sorted(genre_scores.items(), key=lambda x: x[1], reverse=True)
            ]
            features['genre_classes'] = genre_classes[:5]  # Top 5
            features['genre_primary'] = genre_classes[0]['genre'] if genre_classes else None

        # Mood classification based on audio features
        mood_scores = {}

        # Energetic/Aggressive: High energy, loud, bright
        if rms_mean > 0.1 and loudness > -15 and spectral_centroid > 2500:
            mood_scores['energetic'] = 0.7 + min((rms_mean / 0.3) * 0.2, 0.2)

        # Calm/Relaxed: Low energy, soft, warm (low centroid)
        if rms_mean < 0.08 and loudness < -25 and spectral_centroid < 2000:
            mood_scores['calm'] = 0.75

        # Dark/Moody: Low brightness, low energy, sustained
        if spectral_centroid < 1500 and hp_ratio > 1.5 and loudness < -20:
            mood_scores['dark'] = 0.65 + min((2000 - spectral_centroid) / 2000 * 0.25, 0.25)

        # Uplifting/Happy: Bright, major key characteristics, energetic
        if spectral_centroid > 3000 and tempo > 110 and loudness > -20:
            mood_scores['uplifting'] = 0.6 + min((spectral_centroid / 6000) * 0.3, 0.3)

        # Melancholic/Sad: Harmonic, slow, moderate energy
        if hp_ratio > 2.0 and tempo < 100 and -30 < loudness < -15:
            mood_scores['melancholic'] = 0.6

        # Intense/Driving: High energy, fast tempo, percussive
        if tempo > 130 and rms_mean > 0.12 and hp_ratio < 1.0:
            mood_scores['intense'] = 0.7

        # Atmospheric/Ethereal: Harmonic, reverberant, wide dynamic range
        if hp_ratio > 2.5 and dynamic_range > 30 and spectral_centroid > 2000:
            mood_scores['atmospheric'] = 0.65

        # Aggressive/Angry: Very loud, harsh (high ZCR), distorted
        if loudness > -10 and zero_crossing_rate > 0.15:
            mood_scores['aggressive'] = 0.7 + min((zero_crossing_rate / 0.25) * 0.2, 0.2)

        # Peaceful/Serene: Very soft, harmonic, smooth (low ZCR)
        if loudness < -30 and zero_crossing_rate < 0.05 and hp_ratio > 2.0:
            mood_scores['peaceful'] = 0.75

        # Mysterious/Suspenseful: Dark, dynamic, moderate tempo
        if spectral_centroid < 1800 and dynamic_range > 20 and 60 < tempo < 100:
            mood_scores['mysterious'] = 0.6

        # Create mood classes list
        if mood_scores:
            mood_classes = [
                {'mood': mood, 'confidence': float(confidence)}
                for mood, confidence in sorted(mood_scores.items(), key=lambda x: x[1], reverse=True)
            ]
            features['mood_classes'] = mood_classes[:5]  # Top 5

    except Exception as e:
        print(f"Warning: Genre/mood extraction failed: {e}", file=sys.stderr)

    return features


def extract_instrument_predictions(y, sr, spectral_features, energy_features, duration):
    """
    Detect likely instruments using spectral and energy heuristics
    Returns list of {name, confidence} predictions
    """
    predictions = []

    centroid = spectral_features['spectral_centroid']
    rolloff = spectral_features['spectral_rolloff']
    zcr = spectral_features['zero_crossing_rate']
    rms = energy_features['rms_energy']
    onset_strength = energy_features['onset_strength']

    # Kick drum: low centroid, high energy, strong onset, short duration
    if centroid < 1500 and onset_strength > 0.3 and rms > 0.05 and duration < 1.5:
        predictions.append({'name': 'kick', 'confidence': 0.75})

    # Snare: mid centroid, high zcr, strong onset, short duration
    elif 1500 < centroid < 4000 and zcr > 0.08 and onset_strength > 0.25 and duration < 1.0:
        predictions.append({'name': 'snare', 'confidence': 0.70})

    # Hi-hat/cymbals: very high centroid, high zcr, metallic sound
    if centroid > 5000 and zcr > 0.12:
        predictions.append({'name': 'hihat', 'confidence': 0.65})

    # Bass: very low centroid, sustained energy, low zcr
    if centroid < 800 and rolloff < 2000 and zcr < 0.05:
        predictions.append({'name': 'bass', 'confidence': 0.70})

    # Synth/pad: mid-high centroid, lower zcr (harmonic content)
    if 2000 < centroid < 6000 and zcr < 0.06 and duration > 1.0:
        predictions.append({'name': 'synth', 'confidence': 0.60})

    # Vocal detection: high spectral centroid, variable zcr, mid energy
    if centroid > 3000 and 0.08 < zcr < 0.15 and 0.05 < rms < 0.3:
        predictions.append({'name': 'vocal', 'confidence': 0.50})

    # Percussion (general): high onset strength, variable spectral content
    if onset_strength > 0.4 and duration < 2.0:
        predictions.append({'name': 'percussion', 'confidence': 0.55})

    # Remove duplicates and sort by confidence
    seen = set()
    unique_predictions = []
    for pred in sorted(predictions, key=lambda x: x['confidence'], reverse=True):
        if pred['name'] not in seen:
            seen.add(pred['name'])
            unique_predictions.append(pred)

    return unique_predictions[:5]  # Return top 5 predictions


def extract_loudness_ebu(y, sr):
    """
    Extract EBU R128 loudness features using pyloudnorm (Phase 5)
    Args:
        y: Audio time series (mono, float32)
        sr: Sample rate
    Returns:
        dict with loudness_integrated, loudness_range, loudness_momentary_max, true_peak
    """
    features = {
        'loudness_integrated': None,
        'loudness_range': None,
        'loudness_momentary_max': None,
        'true_peak': None,
    }

    try:
        # Import pyloudnorm
        try:
            import pyloudnorm as pyln
        except ImportError:
            print("Warning: pyloudnorm not available, skipping EBU R128 analysis", file=sys.stderr)
            return features

        # Create BS.1770 meter (EBU R128 standard)
        meter = pyln.Meter(sr)  # Creates meter with the correct sample rate

        # Measure integrated loudness (LUFS)
        loudness = meter.integrated_loudness(y)
        features['loudness_integrated'] = float(loudness)

        # Loudness Range (LU) - requires segmented analysis
        # Split audio into 3-second segments and measure
        segment_length = 3.0  # seconds
        segment_samples = int(segment_length * sr)

        if len(y) >= segment_samples:
            # Calculate momentary loudness for each segment
            momentary_loudnesses = []
            for i in range(0, len(y) - segment_samples + 1, segment_samples // 2):
                segment = y[i:i + segment_samples]
                try:
                    seg_loudness = meter.integrated_loudness(segment)
                    if not np.isnan(seg_loudness) and not np.isinf(seg_loudness):
                        momentary_loudnesses.append(seg_loudness)
                except:
                    pass

            if len(momentary_loudnesses) > 0:
                # Loudness Range (LU) = difference between 95th and 10th percentile
                momentary_array = np.array(momentary_loudnesses)
                p95 = np.percentile(momentary_array, 95)
                p10 = np.percentile(momentary_array, 10)
                features['loudness_range'] = float(p95 - p10)
                features['loudness_momentary_max'] = float(np.max(momentary_array))
            else:
                features['loudness_range'] = 0.0
                features['loudness_momentary_max'] = loudness
        else:
            # Too short for range calculation
            features['loudness_range'] = 0.0
            features['loudness_momentary_max'] = loudness

        # True Peak (dBTP) - maximum sample value in dB
        # True peak detection requires oversampling to catch inter-sample peaks
        # For simplicity, we'll use the maximum absolute sample value
        true_peak_linear = np.max(np.abs(y))
        if true_peak_linear > 0:
            # Convert to dBTP (decibels relative to full scale)
            true_peak_db = 20 * np.log10(true_peak_linear)
            features['true_peak'] = float(true_peak_db)
        else:
            features['true_peak'] = -np.inf

    except Exception as e:
        print(f"Warning: EBU R128 loudness extraction failed: {e}", file=sys.stderr)

    return features


def detect_sound_events(y, sr, duration):
    """
    Detect discrete sound events using superflux onset detection (Phase 5).

    Uses the superflux method (Böck & Widmer, 2013) which applies maximum
    filtering to the onset strength envelope, suppressing false positives
    from vibrato and spectral modulation — a known weakness of standard
    spectral flux onset detection. Additionally validates detected onsets
    against the RMS energy envelope to discard events that fall in
    noise-floor regions.

    Args:
        y: Audio time series
        sr: Sample rate
        duration: Duration in seconds
    Returns:
        dict with event_count, event_density
    """
    features = {
        'event_count': None,
        'event_density': None,
    }
    hop_length = 512

    try:
        # --- Superflux onset detection ---
        # Compute mel spectrogram for superflux (higher resolution than default)
        S = librosa.feature.melspectrogram(
            y=y, sr=sr, hop_length=hop_length,
            n_fft=1024, n_mels=138, fmin=27.5, fmax=min(16000, sr // 2)
        )
        # Superflux onset strength: lag and max_size suppress vibrato artifacts
        odf_sf = librosa.onset.onset_strength(
            S=librosa.power_to_db(S, ref=np.max),
            sr=sr, hop_length=hop_length,
            lag=2,        # Compare across 2-frame lag (superflux)
            max_size=3    # Maximum filter kernel size (superflux)
        )
        # Detect onsets from the superflux envelope
        onset_frames = safe_onset_detect(
            onset_envelope=odf_sf,
            sr=sr,
            units='frames',
            hop_length=hop_length,
            backtrack=True,
            delta=0.2,  # Stricter peak picking
        )

        # --- RMS energy validation ---
        # Discard onsets that land in noise-floor regions (below -24 dB of peak)
        rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        rms_peak = np.max(rms) if len(rms) > 0 else 0.0
        noise_floor = rms_peak * 0.06  # ~-24 dB

        if len(onset_frames) > 0 and len(rms) > 0:
            valid_onsets = []
            for frame in onset_frames:
                rms_idx = min(frame, len(rms) - 1)
                # Check a small neighborhood (±2 frames) for local energy
                window_start = max(0, rms_idx - 2)
                window_end = min(len(rms), rms_idx + 3)
                local_rms = np.max(rms[window_start:window_end])
                if local_rms > noise_floor:
                    valid_onsets.append(frame)
            onset_frames = np.array(valid_onsets)

        # --- Group nearby onsets (<100ms) into single events ---
        if len(onset_frames) > 1:
            onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)
            min_event_gap = 0.1  # 100ms minimum between events
            unique_events = [onset_times[0]]
            for onset_time in onset_times[1:]:
                if onset_time - unique_events[-1] >= min_event_gap:
                    unique_events.append(onset_time)
            event_count = len(unique_events)
        else:
            event_count = len(onset_frames)

        features['event_count'] = int(event_count)
        features['event_density'] = float(event_count / duration) if duration > 0 else 0.0

    except Exception as e:
        print(f"Warning: Sound event detection failed: {e}", file=sys.stderr)

    return features


def extract_fingerprint(audio_path, y, sr):
    """
    Extract audio fingerprint for duplicate detection and similarity (Phase 6)
    Args:
        audio_path: Path to audio file
        y: Audio time series (mono, float32)
        sr: Sample rate
    Returns:
        dict with chromaprint_fingerprint and similarity_hash
    """
    features = {
        'chromaprint_fingerprint': None,
        'similarity_hash': None,
    }

    try:
        # SHA-256 content hash fallback for short clips and environments
        # where chromaprint is unavailable.
        try:
            sha256 = hashlib.sha256()
            with open(audio_path, 'rb') as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b''):
                    sha256.update(chunk)
            features['similarity_hash'] = sha256.hexdigest()
        except Exception as e:
            print(f"Warning: Similarity hash failed: {e}", file=sys.stderr)

        # Chromaprint fingerprint for exact/near duplicate detection
        if acoustid is not None:
            try:
                # Use pyacoustid to generate chromaprint fingerprint
                # acoustid.fingerprint_file returns (duration, fingerprint)
                duration_fp, fingerprint = acoustid.fingerprint_file(audio_path)
                # Ensure fingerprint is a string (may be bytes)
                if isinstance(fingerprint, bytes):
                    fingerprint = fingerprint.decode('utf-8')
                features['chromaprint_fingerprint'] = fingerprint
            except Exception as e:
                print(f"Warning: Chromaprint fingerprinting failed: {e}", file=sys.stderr)

    except Exception as e:
        print(f"Warning: Fingerprint extraction failed: {e}", file=sys.stderr)

    return features


def extract_additional_features(y, sr):
    """
    Extract additional audio features: spectral flux, spectral flatness,
    temporal centroid, and crest factor.
    """
    features = {
        'spectral_flux': None,
        'spectral_flatness': None,
        'temporal_centroid': None,
        'crest_factor': None,
    }

    try:
        # Spectral flux: L2 norm of frame-to-frame STFT magnitude difference, mean
        S = np.abs(librosa.stft(y))
        if S.shape[1] > 1:
            diff = np.diff(S, axis=1)
            flux_per_frame = np.sqrt(np.sum(diff ** 2, axis=0))
            features['spectral_flux'] = float(np.mean(flux_per_frame))

        # Spectral flatness
        flatness = librosa.feature.spectral_flatness(y=y)
        features['spectral_flatness'] = float(np.mean(flatness))

        # Temporal centroid: sum(t * rms(t)) / sum(rms(t)), normalized 0-1
        rms = librosa.feature.rms(y=y)[0]
        if np.sum(rms) > 1e-8:
            t = np.arange(len(rms), dtype=np.float64)
            temporal_centroid = np.sum(t * rms) / np.sum(rms)
            # Normalize to 0-1
            features['temporal_centroid'] = float(temporal_centroid / (len(rms) - 1)) if len(rms) > 1 else 0.5

        # Crest factor: 20 * log10(peak / rms) in dB
        rms_total = np.sqrt(np.mean(y ** 2))
        peak_val = np.max(np.abs(y))
        if rms_total > 1e-8:
            features['crest_factor'] = float(20.0 * np.log10(peak_val / rms_total))

    except Exception as e:
        print(f"Warning: Additional feature extraction failed: {e}", file=sys.stderr)

    return features


def extract_fundamental_frequency(y, sr, filename=None, spectral_features=None):
    """
    Extract fundamental frequency (F0) for one-shot samples.
    Skips analysis if chord is detected or filename implies chord.

    Args:
        y: Audio time series
        sr: Sample rate
        filename: Original filename (optional)
        spectral_features: Pre-calculated spectral features (optional)

    Returns:
        Fundamental frequency in Hz (float) or None if chord/no pitch detected
    """
    # Check if filename implies a chord or polyphonic content
    if filename:
        fname_lower = filename.lower()
        chord_keywords = ['chord', 'chrd', 'triad', 'maj', 'min', 'dim', 'aug',
                          'sus', '7th', 'ninth', '11th', '13th',
                          'polyphonic', 'poly', 'stack']
        if any(kw in fname_lower for kw in chord_keywords):
            return None  # Skip F0 for chords

    try:
        # Use librosa.pyin (probabilistic YIN) for robust F0 tracking
        # pyin is more robust than autocorrelation for musical signals
        f0, voiced_flag, voiced_probs = librosa.pyin(
            y,
            fmin=librosa.note_to_hz('C2'),  # ~65 Hz (low bass)
            fmax=librosa.note_to_hz('C7'),  # ~2093 Hz (high treble)
            sr=sr,
            frame_length=2048,
            hop_length=512
        )

        # Filter out unvoiced frames and NaN values
        valid_f0 = f0[~np.isnan(f0)]

        if len(valid_f0) == 0:
            return None  # No fundamental frequency detected (noise/unpitched)

        # Check for chord: if F0 varies significantly, likely a chord or polyphonic content
        f0_std = np.std(valid_f0)
        f0_mean = np.mean(valid_f0)

        # If standard deviation is > 10% of mean, likely chord, vibrato, or pitch glide
        # For monophonic sounds (single note), F0 should be relatively stable
        if f0_std / (f0_mean + 1e-8) > 0.10:
            # Could be chord, vibrato, or glide - check spectral complexity
            if spectral_features:
                # High spectral contrast suggests multiple simultaneous notes (chord)
                contrast = spectral_features.get('spectral_contrast', 0)
                if contrast > 30:  # High contrast = likely chord
                    return None

        # Return median F0 (more robust than mean for outliers)
        return float(np.median(valid_f0))

    except Exception as e:
        print(f"Warning: Fundamental frequency extraction failed: {e}", file=sys.stderr)
        return None


# Chroma templates (12 semitones, root at index 0)
_MAJOR_TEMPLATE = np.array([1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], dtype=float)
_MINOR_TEMPLATE = np.array([1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1], dtype=float)  # natural minor
_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def extract_scale_for_one_shot(y, sr, fundamental_freq=None):
    """
    Detect scale/mode for a one-shot sample.

    If fundamental_freq is provided (monophonic one-shot):
        - Compute chroma_cens, rotate so the root note is at index 0,
          then compare cosine similarity against major/minor templates.
        - This is F0-anchored scale detection.

    If fundamental_freq is None (chord or polyphonic one-shot):
        - Fall back to Essentia KeyExtractor (same as loops).
    """
    try:
        if fundamental_freq is not None:
            # Convert Hz → MIDI pitch class (0=C … 11=B)
            root_bin = int(round(librosa.hz_to_midi(fundamental_freq))) % 12
            note_name = _NOTE_NAMES[root_bin]

            # Energy-normalised chroma — robust to loudness variations
            chroma = librosa.feature.chroma_cens(y=y, sr=sr, hop_length=512)
            mean_chroma = np.median(chroma, axis=1)  # shape (12,)

            # Rotate so the detected root sits at index 0
            rotated = np.roll(mean_chroma, -root_bin)

            def cosine_sim(a, b):
                denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-8
                return float(np.dot(a, b) / denom)

            sim_major = cosine_sim(rotated, _MAJOR_TEMPLATE)
            sim_minor = cosine_sim(rotated, _MINOR_TEMPLATE)

            if sim_major >= sim_minor:
                scale = 'major'
                strength = sim_major
            else:
                scale = 'minor'
                strength = sim_minor

            # Require minimum confidence to avoid spurious results
            if strength < 0.5:
                return {'key_estimate': None, 'scale': None, 'key_strength': None}

            return {
                'key_estimate': f"{note_name} {scale}",
                'scale': scale,
                'key_strength': round(strength, 4),
            }

        else:
            # Chord / polyphonic one-shot — fall back to Essentia KeyExtractor
            if essentia is not None:
                key_extractor = es.KeyExtractor()
                key, scale, strength = key_extractor(y.astype('float32'))
                key_estimate = f"{key} {scale}" if key and scale else None
                return {
                    'key_estimate': key_estimate,
                    'scale': scale if scale else None,
                    'key_strength': float(strength) if strength and strength > 0 else None,
                }

    except Exception as e:
        print(f"Warning: One-shot scale detection failed: {e}", file=sys.stderr)

    return {'key_estimate': None, 'scale': None, 'key_strength': None}


def extract_transient_features(y_percussive, sr):
    """
    Extract transient features from the percussive component.
    Analyzes the first 50ms of the percussive component.
    Args:
        y_percussive: Percussive component from HPSS (already separated)
        sr: Sample rate
    Returns:
        dict with transient_spectral_centroid, transient_spectral_flatness
    """
    features = {
        'transient_spectral_centroid': None,
        'transient_spectral_flatness': None,
    }

    try:
        if y_percussive is None or len(y_percussive) == 0:
            return features

        # Take first 50ms of percussive component
        n_samples_50ms = int(0.05 * sr)
        transient = y_percussive[:n_samples_50ms]

        if len(transient) < 512:
            return features

        # Spectral centroid of transient
        centroid = librosa.feature.spectral_centroid(y=transient, sr=sr)
        features['transient_spectral_centroid'] = float(np.mean(centroid))

        # Spectral flatness of transient
        flatness = librosa.feature.spectral_flatness(y=transient)
        features['transient_spectral_flatness'] = float(np.mean(flatness))

    except Exception as e:
        print(f"Warning: Transient feature extraction failed: {e}", file=sys.stderr)

    return features


def classify_percussion_subtype(transient_centroid, transient_flatness, crest_factor, attack_time):
    """
    Classify percussion subtype based on transient characteristics.
    Args:
        transient_centroid: Spectral centroid of transient (Hz)
        transient_flatness: Spectral flatness of transient (0-1)
        crest_factor: Crest factor in dB
        attack_time: Attack time in seconds
    Returns:
        (subtype, confidence) tuple
    """
    if transient_centroid is None or transient_flatness is None:
        return (None, 0.0)

    # Kick: centroid < 200 Hz, low flatness, crest > 15
    if transient_centroid < 200 and transient_flatness < 0.3 and crest_factor is not None and crest_factor > 15:
        return ('kick', 0.8)

    # Hi-hat: centroid > 5000 Hz, low flatness, short decay
    if transient_centroid > 5000 and transient_flatness < 0.4 and attack_time is not None and attack_time < 0.01:
        return ('hi-hat', 0.75)

    # Ride: centroid > 3000 Hz, low flatness, longer decay
    if transient_centroid > 3000 and transient_flatness < 0.4 and attack_time is not None and attack_time >= 0.01:
        return ('ride', 0.65)

    # Snare: 200-5000 Hz centroid, flatness > 0.5
    if 200 <= transient_centroid <= 5000 and transient_flatness > 0.5:
        return ('snare', 0.7)

    # Clap: Broadband, flatness > 0.4
    if transient_flatness > 0.4 and 500 < transient_centroid < 8000:
        return ('clap', 0.6)

    # Tom: 100-800 Hz centroid, low flatness, crest > 10
    if 100 <= transient_centroid <= 800 and transient_flatness < 0.3 and crest_factor is not None and crest_factor > 10:
        return ('tom', 0.65)

    return (None, 0.0)


def generate_tags(features):
    """
    Convert numeric features to instrument tags only.
    Type/character/general tags have been removed — oneshot/loop is now a DB column,
    and character/energy tags are redundant with numeric features.
    """
    tags = []

    # Instrument tags from heuristic predictions (high confidence only)
    for pred in features.get('instrument_predictions', []):
        if pred['confidence'] > 0.55:
            tags.append(pred['name'])

    # ML Instrument tags (Phase 4) — only instrument classifications
    tag_blocklist = {
        'music', 'singing', 'song', 'speech', 'tender music', 'sad music',
        'happy music', 'music of asia', 'music of africa', 'music of latin america',
        'pop music', 'rock music', 'hip hop music', 'electronic music',
        'christian music', 'wedding music', 'new-age music', 'independent music',
        'theme music', 'background music', 'video game music', 'christmas music',
        'dance music', 'soul music', 'gospel music', 'disco', 'funk',
        'musical instrument', 'plucked string instrument', 'bowed string instrument',
        'wind instrument, woodwind instrument', 'sound effect', 'noise',
    }
    if features.get('instrument_classes') is not None:
        for instrument in features['instrument_classes']:
            if instrument['confidence'] >= 0.6:
                class_name = instrument['class'].lower()
                class_name = class_name.replace('musical instrument, ', '')
                class_name = class_name.replace('music, ', '')
                if class_name in tag_blocklist or '/m/' in class_name:
                    continue
                tags.append(class_name)

    # Return unique tags (preserving order)
    return list(dict.fromkeys(tags))


def worker_loop():
    """
    Persistent worker mode: reads newline-delimited JSON from stdin, writes
    newline-delimited JSON to stdout.

    Protocol:
      → {"id": "req-1", "cmd": "analyze", "audio_path": "...", "level": "advanced", "filename": "..."}
      ← {"id": "req-1", "result": {...}}
      ← {"id": "req-1", "error": "..."}

    Special commands:
      → {"id": "x", "cmd": "ping"}        ← {"id": "x", "result": "pong"}
      → {"id": "x", "cmd": "shutdown"}    ← {"id": "x", "result": "bye"} then exit
    """
    # Signal that all imports are done and worker is ready
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        req_id = None
        try:
            request = json.loads(line)
            req_id = request.get("id", None)
            cmd = request.get("cmd", "analyze")

            if cmd == "ping":
                response = {"id": req_id, "result": "pong"}
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                continue

            if cmd == "shutdown":
                response = {"id": req_id, "result": "bye"}
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                break

            if cmd == "analyze":
                audio_path = request.get("audio_path")
                level = request.get("level", "advanced")
                filename = request.get("filename", None)

                if not audio_path:
                    response = {"id": req_id, "error": "Missing audio_path"}
                    sys.stdout.write(json.dumps(response) + "\n")
                    sys.stdout.flush()
                    continue

                if not os.path.exists(audio_path):
                    response = {"id": req_id, "error": f"File not found: {audio_path}"}
                    sys.stdout.write(json.dumps(response) + "\n")
                    sys.stdout.flush()
                    continue

                if not os.path.isfile(audio_path):
                    response = {"id": req_id, "error": f"Path is not a file: {audio_path}"}
                    sys.stdout.write(json.dumps(response) + "\n")
                    sys.stdout.flush()
                    continue

                try:
                    result = analyze_audio(audio_path, analysis_level=level, filename=filename)
                    response = {"id": req_id, "result": result}
                except Exception as e:
                    response = {"id": req_id, "error": str(e)}

                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                continue

            # Unknown command
            response = {"id": req_id, "error": f"Unknown command: {cmd}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()

        except json.JSONDecodeError as e:
            response = {"id": req_id, "error": f"Invalid JSON: {str(e)}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
        except Exception as e:
            response = {"id": req_id, "error": f"Worker error: {str(e)}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


def main():
    """Entry point for the script"""
    import argparse

    parser = argparse.ArgumentParser(description='Analyze audio file features')
    parser.add_argument('audio_file', nargs='?', default=None, help='Path to audio file')
    parser.add_argument('--level', choices=['advanced'],
                        default='advanced', help='Analysis level (default: advanced)')
    parser.add_argument('--filename', default=None,
                        help='Original filename (used for sample type detection hints)')
    parser.add_argument('--worker', action='store_true',
                        help='Run in persistent worker mode (JSON stdin/stdout)')

    args = parser.parse_args()

    if args.worker:
        worker_loop()
        return

    if not args.audio_file:
        parser.error('audio_file is required (unless using --worker mode)')

    # Validate file exists and is readable
    if not os.path.exists(args.audio_file):
        print(json.dumps({"error": f"File not found: {args.audio_file}"}))
        sys.exit(1)

    if not os.path.isfile(args.audio_file):
        print(json.dumps({"error": f"Path is not a file: {args.audio_file}"}))
        sys.exit(1)

    try:
        results = analyze_audio(args.audio_file, analysis_level=args.level, filename=args.filename)
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
