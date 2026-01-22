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


def analyze_audio(audio_path):
    """
    Main audio analysis function
    Returns dict with all extracted features and suggested tags
    """
    start_time = time.time()

    try:
        # Load audio
        y, sr = librosa.load(audio_path, sr=44100, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        # Calculate basic properties
        is_one_shot, is_loop = detect_sample_type(y, sr, duration)

        # Extract features
        spectral_features = extract_spectral_features(y, sr)
        energy_features = extract_energy_features(y, sr)

        # Extract tempo only for loops
        tempo_features = {}
        if is_loop and duration > 1.5:
            tempo_features = extract_tempo_features(y, sr)

        # Detect instruments
        instrument_predictions = extract_instrument_predictions(
            y, sr, spectral_features, energy_features, duration
        )

        # Generate tags
        features = {
            'duration': float(duration),
            'sample_rate': int(sr),
            'is_one_shot': bool(is_one_shot),
            'is_loop': bool(is_loop),
            'onset_count': int(count_onsets(y, sr)),
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
            # Tempo (optional)
            'bpm': tempo_features.get('bpm'),
            'beats_count': tempo_features.get('beats_count'),
            # Instruments
            'instrument_predictions': instrument_predictions,
        }

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


def extract_spectral_features(y, sr):
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

    return {
        'spectral_centroid': float(np.mean(centroid)),
        'spectral_rolloff': float(np.mean(rolloff)),
        'spectral_bandwidth': float(np.mean(bandwidth)),
        'spectral_contrast': float(np.mean(contrast)),
        'zero_crossing_rate': float(np.mean(zcr)),
        'mfcc_mean': [float(x) for x in np.mean(mfcc, axis=1)],
    }


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

    # Return unique tags
    return list(dict.fromkeys(tags))  # Preserve order while removing duplicates


def main():
    """Entry point for the script"""
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: analyze_audio.py <audio_file>"}))
        sys.exit(1)

    audio_path = sys.argv[1]

    # Validate file exists and is readable
    import os
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    if not os.path.isfile(audio_path):
        print(json.dumps({"error": f"Path is not a file: {audio_path}"}))
        sys.exit(1)

    try:
        results = analyze_audio(audio_path)
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
