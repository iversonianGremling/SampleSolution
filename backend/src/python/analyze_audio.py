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
