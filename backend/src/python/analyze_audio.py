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

warnings.filterwarnings('ignore')

try:
    import librosa
    import soundfile as sf
except ImportError as e:
    print(json.dumps({"error": f"Missing dependency: {e}. Install with: pip install librosa soundfile"}))
    sys.exit(1)

try:
    import essentia
    import essentia.standard as es
except ImportError:
    # Essentia is optional for basic analysis
    essentia = None

# TensorFlow imports (Phase 4)
try:
    import tensorflow as tf
    import tensorflow_hub as hub
    # Suppress TensorFlow warnings
    tf.get_logger().setLevel('ERROR')
    import os
    os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
except ImportError:
    tf = None
    hub = None

# Acoustid/Chromaprint imports (Phase 6)
try:
    import acoustid
    import chromaprint
except ImportError:
    acoustid = None
    chromaprint = None

# Global model cache (loaded once, reused across analyses)
_yamnet_model = None
_yamnet_class_names = None


def analyze_audio(audio_path, analysis_level='standard'):
    """
    Main audio analysis function
    Args:
        audio_path: Path to audio file
        analysis_level: 'quick', 'standard', or 'advanced'
    Returns dict with all extracted features and suggested tags
    """
    start_time = time.time()

    try:
        # Load audio
        y, sr = librosa.load(audio_path, sr=44100, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        # Calculate basic properties
        is_one_shot, is_loop = detect_sample_type(y, sr, duration)

        # Extract features (all levels)
        spectral_features = extract_spectral_features(y, sr, level=analysis_level)
        energy_features = extract_energy_features(y, sr)

        # Extract key features (standard and advanced only)
        key_features = {'key_estimate': None, 'key_strength': None}
        if analysis_level in ['standard', 'advanced']:
            key_features = extract_key_features(y, sr)

        # Extract tempo only for loops (standard and advanced only)
        tempo_features = {}
        if is_loop and duration > 1.5 and analysis_level in ['standard', 'advanced']:
            tempo_features = extract_tempo_features(y, sr)

        # Detect instruments (all levels)
        instrument_predictions = extract_instrument_predictions(
            y, sr, spectral_features, energy_features, duration
        )

        # Build features dict
        features = {
            'duration': float(duration),
            'sample_rate': int(sr),
            'is_one_shot': bool(is_one_shot),
            'is_loop': bool(is_loop),
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
            'key_strength': key_features['key_strength'],
            # Tempo (optional)
            'bpm': tempo_features.get('bpm'),
            'beats_count': tempo_features.get('beats_count'),
            # Instruments
            'instrument_predictions': instrument_predictions,
        }

        # Advanced level: Add Phase 1 features (timbral, perceptual, spectral)
        if analysis_level == 'advanced':
            # Advanced spectral from basic extraction
            if 'mel_bands_mean' in spectral_features:
                features['mel_bands_mean'] = spectral_features['mel_bands_mean']
                features['mel_bands_std'] = spectral_features['mel_bands_std']

            # Timbral features (Essentia)
            timbral_features = extract_timbral_features(y, sr)
            features.update(timbral_features)

            # Perceptual features (derived)
            perceptual_features = extract_perceptual_features(
                spectral_features, energy_features, timbral_features
            )
            features.update(perceptual_features)

            # Phase 2: Stereo analysis
            stereo_features = extract_stereo_features(audio_path, sr)
            features.update(stereo_features)

            # Phase 2: Harmonic/Percussive separation
            hpss_features = extract_hpss_features(y, sr)
            features.update(hpss_features)

            # Phase 3: Advanced rhythm features
            rhythm_features = extract_rhythm_features(y, sr, duration, tempo_features)
            features.update(rhythm_features)

            # Phase 3: ADSR envelope
            adsr_features = extract_adsr_envelope(y, sr)
            features.update(adsr_features)

            # Phase 4: ML-based instrument classification (YAMNet)
            ml_instrument_features = extract_instrument_ml(audio_path, y, sr)
            features.update(ml_instrument_features)

            # Phase 4: Genre/mood classification (Essentia)
            genre_features = extract_genre_ml(y, sr)
            features.update(genre_features)

            # Phase 5: EBU R128 loudness analysis
            loudness_ebu_features = extract_loudness_ebu(y, sr)
            features.update(loudness_ebu_features)

            # Phase 5: Sound event detection
            event_features = detect_sound_events(y, sr, duration)
            features.update(event_features)

            # Phase 6: Audio fingerprinting and similarity detection
            fingerprint_features = extract_fingerprint(audio_path, y, sr)
            features.update(fingerprint_features)

        # Generate tags from features
        suggested_tags = generate_tags(features)
        features['suggested_tags'] = suggested_tags

        # Add analysis metadata
        features['analysis_duration_ms'] = int((time.time() - start_time) * 1000)

        return features

    except Exception as e:
        raise Exception(f"Audio analysis failed: {str(e)}")


def detect_sample_type(y, sr, duration):
    """
    Detect if audio is a one-shot or loop

    Heuristics:
    - One-shot: duration < 1.5s AND single prominent onset OR low onset density
    - Loop: duration > 2s OR repeating patterns
    """
    if duration >= 1.5:
        # Could be either - check onset patterns
        onsets = librosa.onset.onset_detect(y=y, sr=sr, units='frames', hop_length=512)
        onset_density = len(onsets) / duration

        # If very dense onsets (lots of events), it's likely a loop
        is_loop = onset_density > 2.0 or duration > 3.0
        return False, is_loop

    # Very short samples are likely one-shots
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units='frames', hop_length=512)

    if len(onsets) <= 2:
        # Few onsets = one-shot
        return True, False

    # Check energy decay (percussive one-shots have rapid decay)
    rms = librosa.feature.rms(y=y)[0]
    if len(rms) > 10:
        peak_idx = np.argmax(rms)
        if peak_idx < len(rms) - 5:
            decay_ratio = rms[peak_idx] / (np.mean(rms[peak_idx + 5:]) + 1e-6)
            if decay_ratio > 3.0:
                return True, False

    # Default to one-shot for very short samples
    return True, False


def count_onsets(y, sr):
    """Count number of onsets in audio"""
    try:
        onsets = librosa.onset.onset_detect(y=y, sr=sr, units='frames', hop_length=512)
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


def extract_spectral_features(y, sr, level='standard'):
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
                'key_strength': float(strength) if strength > 0 else None,
            }
    except Exception as e:
        # Silently handle errors - key detection is optional
        print(f"Warning: Key detection failed: {e}", file=sys.stderr)

    return {'key_estimate': None, 'key_strength': None}


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

            # Dissonance - harmonic dissonance
            try:
                dissonance_extractor = es.Dissonance()
                dissonance = dissonance_extractor(audio_essentia)
                features['dissonance'] = float(dissonance)
            except:
                features['dissonance'] = None

            # Inharmonicity - deviation from perfect harmonic structure
            try:
                inharmonicity_extractor = es.Inharmonicity()
                inharmonicity = inharmonicity_extractor(audio_essentia)
                features['inharmonicity'] = float(inharmonicity)
            except:
                features['inharmonicity'] = None

            # Tristimulus - 3-value tonal color descriptor
            try:
                tristimulus_extractor = es.Tristimulus()
                t1, t2, t3 = tristimulus_extractor(audio_essentia)
                features['tristimulus'] = [float(t1), float(t2), float(t3)]
            except:
                features['tristimulus'] = None

            # Spectral Complexity
            try:
                complexity_extractor = es.SpectralComplexity()
                complexity = complexity_extractor(audio_essentia)
                features['spectral_complexity'] = float(complexity)
            except:
                features['spectral_complexity'] = None

            # Spectral Crest - peakiness of spectrum
            try:
                # Use windowing and spectrum
                w = es.Windowing(type='hann')
                spectrum = es.Spectrum()
                crest = es.Crest()

                # Process in frames
                frame_size = 2048
                hop_size = 512
                crest_values = []

                for i in range(0, len(audio_essentia) - frame_size, hop_size):
                    frame = audio_essentia[i:i + frame_size]
                    windowed = w(frame)
                    spec = spectrum(windowed)
                    crest_values.append(crest(spec))

                if crest_values:
                    features['spectral_crest'] = float(np.mean(crest_values))
                else:
                    features['spectral_crest'] = None
            except:
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
    Returns dict with harmonic/percussive ratios, energies, and centroids
    """
    features = {
        'harmonic_percussive_ratio': None,
        'harmonic_energy': None,
        'percussive_energy': None,
        'harmonic_centroid': None,
        'percussive_centroid': None,
    }

    try:
        # Separate harmonic and percussive components
        y_harmonic, y_percussive = librosa.effects.hpss(y)

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

    return features


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
        onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units='frames', hop_length=512)
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
            # Sustained: Slow attack or high sustain level
            elif attack > 0.05 or sustain > 0.6:
                features['envelope_type'] = 'sustained'
            # Pad: Very slow attack and/or very slow release
            elif attack > 0.1 or (release is not None and release > 0.5):
                features['envelope_type'] = 'pad'
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
        return _yamnet_model, _yamnet_class_names

    if tf is None or hub is None:
        return None, None

    try:
        print("Loading YAMNet model... (this may take a few seconds on first run)", file=sys.stderr)
        _yamnet_model = hub.load('https://tfhub.dev/google/yamnet/1')

        # Load class names
        class_map_path = _yamnet_model.class_map_path().numpy().decode('utf-8')
        with open(class_map_path) as f:
            _yamnet_class_names = [line.strip() for line in f]

        print(f"YAMNet model loaded successfully ({len(_yamnet_class_names)} classes)", file=sys.stderr)
        return _yamnet_model, _yamnet_class_names
    except Exception as e:
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
            return features

        # YAMNet expects 16kHz mono audio
        if sr != 16000:
            y_16k = librosa.resample(y, orig_sr=sr, target_sr=16000)
        else:
            y_16k = y

        # Convert to float32
        waveform = y_16k.astype(np.float32)

        # Run inference
        scores, embeddings, spectrogram = model(waveform)

        # Get mean scores across all frames
        mean_scores = np.mean(scores.numpy(), axis=0)

        # Get top predictions
        top_indices = np.argsort(mean_scores)[::-1][:20]  # Top 20

        # Filter for instrument-related classes
        # YAMNet class categories we care about
        instrument_keywords = [
            'music', 'guitar', 'drum', 'bass', 'piano', 'keyboard', 'synth',
            'violin', 'brass', 'trumpet', 'saxophone', 'flute', 'organ',
            'vocal', 'singing', 'speech', 'voice', 'percussion', 'cymbal',
            'snare', 'kick', 'hi-hat', 'tom', 'clap', 'cowbell', 'shaker',
            'tambourine', 'bell', 'chime', 'pluck', 'strum', 'string'
        ]

        instrument_predictions = []
        for idx in top_indices:
            class_name = class_names[idx]
            confidence = float(mean_scores[idx])

            # Check if this class is instrument-related
            if any(keyword in class_name.lower() for keyword in instrument_keywords):
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


def extract_genre_ml(y, sr):
    """
    Extract genre and mood classification using Essentia MusicExtractor (Phase 4)
    Args:
        y: Audio time series (mono, float32)
        sr: Sample rate
    Returns:
        dict with genre_classes, genre_primary, mood_classes
    """
    features = {
        'genre_classes': None,
        'genre_primary': None,
        'mood_classes': None,
    }

    try:
        if essentia is None:
            return features

        # Essentia MusicExtractor works on audio files, not numpy arrays
        # We'll use a different approach with individual extractors

        # Genre classification using Essentia's pre-trained models
        # Note: This requires essentia-tensorflow models which may not be available
        # For now, we'll skip this and rely on YAMNet for classification
        # In production, you'd use:
        # - essentia.standard.TensorflowPredictMusiCNN for genre
        # - essentia.standard.TensorflowPredictVGGish for features

        # Placeholder: We'll implement this when essentia-tensorflow is set up
        # For now, return None to indicate not available

    except Exception as e:
        print(f"Warning: Genre extraction failed: {e}", file=sys.stderr)

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
    Detect discrete sound events using onset detection (Phase 5)
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

    try:
        # Use onset detection with strict threshold to identify discrete events
        # Higher threshold means only significant onsets are counted as "events"
        onset_frames = librosa.onset.onset_detect(
            y=y,
            sr=sr,
            units='frames',
            hop_length=512,
            backtrack=True,
            # Use stronger threshold for event detection (not just any onset)
            delta=0.2,  # Stricter peak picking
        )

        # Count events
        event_count = len(onset_frames)
        features['event_count'] = int(event_count)

        # Event density (events per second)
        if duration > 0:
            features['event_density'] = float(event_count / duration)
        else:
            features['event_density'] = 0.0

        # Additional filtering: group onsets that are very close together
        # (< 100ms apart) into single events
        if len(onset_frames) > 1:
            onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=512)

            # Group nearby onsets
            min_event_gap = 0.1  # 100ms minimum between events
            unique_events = []
            last_time = -1.0

            for onset_time in onset_times:
                if onset_time - last_time >= min_event_gap:
                    unique_events.append(onset_time)
                    last_time = onset_time

            # Update with filtered count
            features['event_count'] = int(len(unique_events))
            if duration > 0:
                features['event_density'] = float(len(unique_events) / duration)

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
        dict with chromaprint_fingerprint, similarity_hash
    """
    features = {
        'chromaprint_fingerprint': None,
        'similarity_hash': None,
    }

    try:
        # Chromaprint fingerprint for exact/near duplicate detection
        if chromaprint is not None:
            try:
                # Chromaprint expects 16-bit PCM audio
                # Convert float32 [-1, 1] to int16 [-32768, 32767]
                audio_int16 = (y * 32767).astype(np.int16)

                # Generate fingerprint
                fpcalc = chromaprint.Chromaprint()
                fpcalc.start(sr, 1)  # sample_rate, num_channels=1 (mono)
                fpcalc.feed(audio_int16.tobytes())
                fpcalc.finish()

                fingerprint = fpcalc.get_fingerprint()
                features['chromaprint_fingerprint'] = fingerprint
            except Exception as e:
                print(f"Warning: Chromaprint fingerprinting failed: {e}", file=sys.stderr)

        # Perceptual hash from mel-spectrogram for similarity detection
        try:
            # Generate mel-spectrogram (compact representation)
            mel_spec = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=32, n_fft=2048)

            # Convert to dB scale
            mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max)

            # Downsample temporally (average across time to get 32x32 matrix)
            target_frames = 32
            if mel_spec_db.shape[1] > target_frames:
                # Average every N frames to get target number
                frames_per_bucket = mel_spec_db.shape[1] // target_frames
                downsampled = []
                for i in range(target_frames):
                    start_idx = i * frames_per_bucket
                    end_idx = start_idx + frames_per_bucket
                    if end_idx <= mel_spec_db.shape[1]:
                        downsampled.append(np.mean(mel_spec_db[:, start_idx:end_idx], axis=1))
                mel_spec_compact = np.array(downsampled).T  # 32x32
            else:
                # Pad if too short
                mel_spec_compact = np.pad(
                    mel_spec_db,
                    ((0, 0), (0, max(0, target_frames - mel_spec_db.shape[1]))),
                    mode='constant',
                    constant_values=np.min(mel_spec_db)
                )[:, :target_frames]

            # Create binary hash: 1 if above median, 0 if below
            median_val = np.median(mel_spec_compact)
            binary_matrix = (mel_spec_compact > median_val).astype(int)

            # Flatten and convert to hexadecimal string (compact representation)
            binary_flat = binary_matrix.flatten()

            # Convert binary array to hex string (more compact than storing 1024 bits)
            # Group into bytes (8 bits each)
            hex_chars = []
            for i in range(0, len(binary_flat), 8):
                byte_chunk = binary_flat[i:i+8]
                # Pad if last chunk is incomplete
                if len(byte_chunk) < 8:
                    byte_chunk = np.pad(byte_chunk, (0, 8 - len(byte_chunk)), mode='constant')
                # Convert to integer then to hex
                byte_val = int(''.join(str(b) for b in byte_chunk), 2)
                hex_chars.append(f'{byte_val:02x}')

            features['similarity_hash'] = ''.join(hex_chars)

        except Exception as e:
            print(f"Warning: Perceptual hash generation failed: {e}", file=sys.stderr)

    except Exception as e:
        print(f"Warning: Fingerprint extraction failed: {e}", file=sys.stderr)

    return features


def generate_tags(features):
    """
    Convert numeric features to semantic tags
    """
    tags = []

    # Type tags
    if features['is_one_shot']:
        tags.append('one-shot')
    if features['is_loop']:
        tags.append('loop')

    # BPM tags (only for loops with detected tempo)
    if features['bpm'] is not None and features['is_loop']:
        bpm = features['bpm']

        # Tempo categories
        if bpm < 80:
            tags.extend(['slow', '60-80bpm'])
        elif bpm < 100:
            tags.extend(['downtempo', '80-100bpm'])
        elif bpm < 120:
            tags.extend(['midtempo', '100-120bpm'])
        elif bpm < 140:
            tags.extend(['uptempo', '120-140bpm'])
        else:
            tags.extend(['fast', '140+bpm'])

    # Spectral tags (brightness/frequency content)
    centroid = features['spectral_centroid']
    rolloff = features['spectral_rolloff']

    if centroid > 3500:
        tags.append('bright')
    elif centroid > 1500:
        tags.append('mid-range')
    else:
        tags.append('dark')

    if rolloff < 2000:
        tags.append('bass-heavy')
    elif rolloff > 8000:
        tags.append('high-freq')

    # Energy/dynamics tags
    loudness = features['loudness']
    onset_strength = features['rms_energy']
    dynamic_range = features['dynamic_range']

    # Punch and softness
    if features['is_one_shot'] and onset_strength > 0.1:
        tags.append('punchy')
    elif onset_strength < 0.05:
        tags.append('soft')

    # Overall energy
    if loudness > -10:
        tags.append('aggressive')
    elif loudness < -30:
        tags.append('ambient')

    # Dynamics
    if dynamic_range > 30:
        tags.append('dynamic')
    elif dynamic_range < 10:
        tags.append('compressed')

    # Texture tags (based on zero crossing rate)
    zcr = features['zero_crossing_rate']
    if zcr > 0.12:
        tags.append('noisy')
    elif zcr < 0.05:
        tags.append('smooth')

    # Instrument tags (high confidence only)
    for pred in features.get('instrument_predictions', []):
        if pred['confidence'] > 0.55:
            tags.append(pred['name'])

    # Perceptual tags (Phase 1 - advanced level only)
    if features.get('brightness') is not None:
        brightness = features['brightness']
        if brightness > 0.7:
            tags.append('bright')
        elif brightness < 0.3:
            tags.append('dull')

    if features.get('warmth') is not None:
        warmth = features['warmth']
        if warmth > 0.7:
            tags.append('warm')
        elif warmth < 0.3:
            tags.append('cold')

    if features.get('hardness') is not None:
        hardness = features['hardness']
        if hardness > 0.7:
            tags.append('hard')
        elif hardness < 0.3:
            tags.append('soft-timbre')

    if features.get('roughness') is not None:
        roughness = features['roughness']
        if roughness > 0.6:
            tags.append('rough')

    if features.get('sharpness') is not None:
        sharpness = features['sharpness']
        if sharpness > 0.7:
            tags.append('sharp')

    # Timbral tags (Phase 1)
    if features.get('dissonance') is not None and features['dissonance'] > 0.6:
        tags.append('dissonant')

    if features.get('spectral_complexity') is not None and features['spectral_complexity'] > 0.7:
        tags.append('complex')

    # Stereo tags (Phase 2)
    if features.get('stereo_width') is not None:
        stereo_width = features['stereo_width']
        if stereo_width > 0.6:
            tags.append('wide-stereo')
        elif stereo_width < 0.2:
            tags.append('mono')

    # Harmonic/Percussive tags (Phase 2)
    if features.get('harmonic_percussive_ratio') is not None:
        hp_ratio = features['harmonic_percussive_ratio']
        if hp_ratio > 3.0:
            tags.append('harmonic')
        elif hp_ratio < 0.3:
            tags.append('percussive')

    # Rhythm tags (Phase 3)
    if features.get('danceability') is not None:
        danceability = features['danceability']
        if danceability > 0.7:
            tags.append('danceable')
        elif danceability < 0.3:
            tags.append('non-danceable')

    if features.get('rhythmic_regularity') is not None:
        regularity = features['rhythmic_regularity']
        if regularity > 0.7:
            tags.append('rhythmic')
        elif regularity < 0.3:
            tags.append('irregular')

    # Envelope tags (Phase 3)
    if features.get('envelope_type') is not None:
        envelope_type = features['envelope_type']
        if envelope_type == 'percussive':
            tags.append('percussive-envelope')
        elif envelope_type == 'plucked':
            tags.append('plucked')
        elif envelope_type == 'sustained':
            tags.append('sustained')
        elif envelope_type == 'pad':
            tags.append('pad')

    # ML Instrument tags (Phase 4)
    # Use ML predictions instead of heuristics if available
    if features.get('instrument_classes') is not None:
        for instrument in features['instrument_classes']:
            if instrument['confidence'] >= 0.6:  # 60% threshold
                # Clean up class name for tagging
                class_name = instrument['class'].lower()
                # Remove common prefixes/suffixes
                class_name = class_name.replace('musical instrument, ', '')
                class_name = class_name.replace('music, ', '')
                # Add as tag
                tags.append(class_name)

    # Genre tags (Phase 4)
    if features.get('genre_primary') is not None:
        tags.append(features['genre_primary'].lower())

    if features.get('genre_classes') is not None:
        for genre in features['genre_classes']:
            if genre['confidence'] >= 0.6:  # 60% threshold
                tags.append(genre['genre'].lower())

    # Mood tags (Phase 4)
    if features.get('mood_classes') is not None:
        for mood in features['mood_classes']:
            if mood['confidence'] >= 0.6:  # 60% threshold
                tags.append(mood['mood'].lower())

    # EBU R128 Loudness tags (Phase 5)
    if features.get('loudness_integrated') is not None:
        loudness_integrated = features['loudness_integrated']
        # LUFS ranges: -23 is broadcast standard, -14 is streaming standard
        if loudness_integrated > -10:
            tags.append('very-loud')
        elif loudness_integrated > -14:
            tags.append('loud')
        elif loudness_integrated > -23:
            tags.append('moderate-loudness')
        else:
            tags.append('quiet')

    if features.get('loudness_range') is not None:
        loudness_range = features['loudness_range']
        # Loudness Range in LU: >20 = very dynamic, <5 = very compressed
        if loudness_range > 20:
            tags.append('very-dynamic')
        elif loudness_range > 10:
            tags.append('dynamic-loudness')
        elif loudness_range < 5:
            tags.append('compressed-loudness')

    # Event Detection tags (Phase 5)
    if features.get('event_density') is not None:
        event_density = features['event_density']
        # Events per second
        if event_density > 5:
            tags.append('event-dense')
        elif event_density > 2:
            tags.append('multi-event')
        elif event_density < 0.5:
            tags.append('single-event')

    # Return unique tags
    return list(dict.fromkeys(tags))  # Preserve order while removing duplicates


def main():
    """Entry point for the script"""
    import argparse

    parser = argparse.ArgumentParser(description='Analyze audio file features')
    parser.add_argument('audio_file', help='Path to audio file')
    parser.add_argument('--level', choices=['quick', 'standard', 'advanced'],
                        default='standard', help='Analysis level (default: standard)')

    args = parser.parse_args()

    # Validate file exists and is readable
    import os
    if not os.path.exists(args.audio_file):
        print(json.dumps({"error": f"File not found: {args.audio_file}"}))
        sys.exit(1)

    if not os.path.isfile(args.audio_file):
        print(json.dumps({"error": f"Path is not a file: {args.audio_file}"}))
        sys.exit(1)

    try:
        results = analyze_audio(args.audio_file, analysis_level=args.level)
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
