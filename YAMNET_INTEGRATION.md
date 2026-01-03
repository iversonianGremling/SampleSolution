# YAMNet Audio Classification Integration

YAMNet has been successfully integrated into the sample extractor to provide AI-powered audio classification for samples/slices.

## What is YAMNet?

YAMNet is a pre-trained deep neural network for audio event classification developed by Google Research. It can identify 521 different audio classes from the AudioSet corpus, including:
- Musical instruments (piano, guitar, drums, synthesizer, etc.)
- Music genres (jazz, rock, electronic, classical, etc.)
- Audio characteristics (rhythm, melody, vocals, etc.)
- Sound events and textures

## How It Works

### Automatic Classification
When you create a new slice (sample), YAMNet automatically:
1. Analyzes the audio content of the slice
2. Identifies the top 5 most confident audio classes (with confidence > 15%)
3. Maps these classes to user-friendly tags
4. Creates tags if they don't exist
5. Attaches the tags to the slice

**This happens automatically in the background** - no user action required!

### Manual Classification
You can also manually trigger YAMNet classification on existing slices:

```bash
POST /api/slices/:sliceId/ai-tags
```

Response:
```json
{
  "tags": ["piano", "jazz", "melodic"],
  "classifications": [
    { "className": "Piano", "score": 0.87 },
    { "className": "Jazz", "score": 0.62 },
    { "className": "Melody", "score": 0.45 }
  ]
}
```

## Integration Points

### 1. Automatic Tagging (Slices)
- **Location**: `/backend/src/routes/slices.ts:192-195`
- **Trigger**: After slice extraction succeeds
- **Behavior**: Runs YAMNet in background, doesn't block response

### 2. Re-tagging on Update
- **Location**: `/backend/src/routes/slices.ts:249-252`
- **Trigger**: When slice time boundaries are updated
- **Behavior**: Re-runs classification since audio content changed

### 3. Manual API Endpoint
- **Location**: `/backend/src/routes/tags.ts:220-306`
- **Endpoint**: `POST /api/slices/:sliceId/ai-tags`
- **Returns**: Applied tags + raw classifications with scores

## Technical Details

### YAMNet Service
- **File**: `/backend/src/services/yamnet.ts`
- **Model Source**: TensorFlow Hub (`https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1`)
- **Audio Format**: 16kHz mono, converted via FFmpeg
- **Confidence Threshold**: 15% (configurable via `SCORE_THRESHOLD`)
- **Max Tags**: Top 5 predictions (configurable via `TOP_K`)

### Audio Processing Pipeline
1. Extract slice audio (MP3) via FFmpeg
2. Convert to 16kHz mono PCM using FFmpeg
3. Normalize to Float32 array [-1, 1]
4. Run through YAMNet model
5. Average predictions across time windows
6. Filter by confidence threshold
7. Map to user-friendly tag names

### Tag Mapping
YAMNet classes are mapped to simplified tag names:
- Instrument detection: `piano`, `guitar`, `drums`, `bass`, `synth`, `strings`, etc.
- Genre detection: `jazz`, `rock`, `electronic`, `classical`, `funk`, `soul`, etc.
- Audio features: `vocals`, `rhythmic`, `melodic`, `harmonic`
- Use cases: `sampling`, `loops`, `beats`

Unknown or unmapped classes are added as cleaned-up versions of the raw class name.

## Comparison: YAMNet vs Ollama

| Feature | YAMNet (Slices) | Ollama (Tracks) |
|---------|-----------------|-----------------|
| **Input** | Audio content | Video title/description |
| **Accuracy** | High (analyzes actual sound) | Medium (metadata only) |
| **Speed** | ~2-5 seconds | ~1-3 seconds |
| **Trigger** | Automatic on slice creation | Manual (sparkle icon) |
| **Use Case** | Sample classification | Song categorization |
| **Classes** | 521 audio events | Custom prompt-based |

## Configuration

### Adjust Confidence Threshold
In `/backend/src/services/yamnet.ts`:
```typescript
const SCORE_THRESHOLD = 0.15; // Lower = more tags, higher = fewer but more confident
```

### Adjust Number of Tags
```typescript
const TOP_K = 5; // Increase for more tags per slice
```

### Customize Tag Mapping
Edit `getYAMNetToTagMapping()` in `/backend/src/services/yamnet.ts` to customize how YAMNet classes map to your tag system.

## Troubleshooting

### Model Loading Issues
- First time loading YAMNet downloads ~5MB model from TensorFlow Hub
- Cached after first load
- Requires internet connection on first run

### FFmpeg Errors
- Ensure FFmpeg is installed and accessible
- Audio must be in a format FFmpeg can decode

### Low Confidence / No Tags
- Increase `SCORE_THRESHOLD` sensitivity
- Increase `TOP_K` for more tags
- Check audio quality (very short clips may not classify well)

## Future Enhancements

Potential improvements:
- Cache classifications to avoid re-running on same audio
- Batch processing for multiple slices
- Custom model fine-tuning on your specific sample types
- Confidence score display in UI
- Tag filtering/boosting based on user preferences
