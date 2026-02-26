# YouTube Sample Extractor - Setup Guide

## Quick Start

1. Copy `.env.example` to `.env` and fill in your credentials
2. Run `docker-compose up -d`
   - Optional GPU mode: `docker-compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`
3. Access the app at `http://localhost:3000`
4. Verify Ollama models are present (auto-pulled by compose): `docker exec -it sample_solution-ollama-1 ollama list`

## Google Cloud Setup (Required for YouTube Features)

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it (e.g., "Sample Extractor") and click "Create"

### Step 2: Enable YouTube Data API v3

1. In your project, go to "APIs & Services" → "Library"
2. Search for "YouTube Data API v3"
3. Click on it and press "Enable"

### Step 3: Create API Key (for YouTube Search)

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "API Key"
3. Copy the API key and add it to your `.env` file as `YOUTUBE_API_KEY`
4. (Recommended) Click "Edit API key" to restrict it:
   - Under "API restrictions", select "Restrict key"
   - Choose "YouTube Data API v3"
   - Save

### Step 4: Create OAuth 2.0 Credentials (for Private Playlists)

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure the OAuth consent screen:
   - User Type: External
   - App name: "Sample Extractor"
   - User support email: Your email
   - Developer contact: Your email
   - Scopes: Add `https://www.googleapis.com/auth/youtube.readonly`
   - Test users: Add your Google account email
   - Save and continue
4. Back in Credentials, create OAuth client ID:
   - Application type: "Web application"
   - Name: "Sample Extractor Web"
   - Authorized redirect URIs: Add `http://localhost:4000/api/auth/google/callback`
   - Click "Create"
5. Copy the Client ID and Client Secret to your `.env` file

### Step 5: Configure Environment Variables

Your `.env` file should look like this:

```env
YOUTUBE_API_KEY=AIza...your-api-key...
GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:4000
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
SESSION_SECRET=generate-a-random-string-here
```

### Step 6: Spotify OAuth Setup (Optional, for Spotify playlist import)

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app
2. In app settings, add this redirect URI:
   - `http://localhost:4000/api/spotify/callback`
3. Copy the app Client ID and Client Secret into your `.env` as:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
4. If not using localhost, set `BACKEND_URL` to your real backend origin and add:
   - `${BACKEND_URL}/api/spotify/callback`
   to the Spotify app redirect URI list

## AI Classification Setup

The app uses two different AI approaches for categorization:

### 1. Audio Analysis (Essentia + Librosa) - For Slices/Samples

**Automatic audio classification** using Python-based audio feature extraction:

- **What**: Analyzes actual audio content (spectral features, tempo, rhythm)
- **When**: Runs automatically when slices are created
- **Output**: Tags like `one-shot`, `loop`, BPM detection, instrument classification
- **Dependencies**: Python libraries (Essentia, Librosa) - installed via Docker

**No setup required** - runs automatically in the backend container.

### 2. Ollama (LLM) - For Track Metadata + Sample Tag QA (Optional)

**Metadata-based tagging** using Ollama LLM:

- **What**: Analyzes YouTube video title and description
- **When**: Manual trigger via UI (sparkle icon on tracks)
- **Output**: Genre, mood, era tags based on video metadata
- **Dependencies**: Primary Ollama + analyzer Ollama containers (both default to llama3.2:3b)
- **Review fallback chain**: `analyzer -> primary -> cpu` with retries/circuit-breaker-aware failover

**Setup** (only if you want Ollama for track metadata tagging):

```bash
# After starting the containers (only needed if auto-pull failed)
docker exec -it sample_solution-ollama-1 ollama pull llama3.2:3b
docker exec -it sample_solution-ollama-analyzer-1 ollama pull llama3.2:3b
```

This downloads the llama3.2:3b model (~2GB each) for metadata tagging and post-analysis tag QA.

#### Alternative Ollama Models

If you want to use a different model, update `OLLAMA_MODEL` (and optionally `OLLAMA_ANALYZER_MODEL` / `OLLAMA_CPU_MODEL`):

- `llama3.2:1b` - Smaller, faster, less accurate (~1GB)
- `llama3.2:3b` - Recommended balance (~2GB)
- `mistral:7b` - Larger, more accurate (~4GB)
- `phi3:mini` - Microsoft's efficient model (~2GB)

### Comparison: Audio Analysis vs Ollama

| Feature | Audio Analysis (Slices) | Ollama (Tracks) |
|---------|-------------------------|-----------------|
| **Input** | Audio waveform | Video title/description |
| **Accuracy** | High (analyzes sound) | Medium (metadata only) |
| **Trigger** | Automatic | Manual (UI button) |
| **Use Case** | Sample classification | Song categorization |
| **Speed** | ~1-3 seconds | ~2-5 seconds |
| **Setup** | Pre-installed | Requires model download |

## Production Deployment

For production on Proxmox:

1. Update `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`, and `BACKEND_URL` to your actual domain/IP
2. Generate a secure `SESSION_SECRET`:
   ```bash
   openssl rand -base64 32
   ```
3. In Google Cloud Console, add your production redirect URI to the OAuth credentials
4. In Spotify Developer Dashboard, add `${BACKEND_URL}/api/spotify/callback` to your app redirect URIs (if using Spotify playlist import)
5. Consider setting up HTTPS with a reverse proxy (nginx/traefik)

## Troubleshooting

### "OAuth consent screen not configured"
- Complete Step 4 above to configure the consent screen

### "Access blocked: App not verified"
- This is normal for test apps. Click "Advanced" → "Go to Sample Extractor (unsafe)"
- For production, submit your app for Google verification

### "Ollama model not found"
- Run:
  - `docker exec -it sample_solution-ollama-1 ollama pull llama3.2:3b`
  - `docker exec -it sample_solution-ollama-analyzer-1 ollama pull llama3.2:3b`

### "yt-dlp download failed"
- YouTube may have updated their site. Update yt-dlp:
  ```bash
  docker exec -it sample_solution-backend-1 pip install --upgrade yt-dlp
  ```

### Container can't connect to Ollama
- Ensure all containers are on the same network
- Check with: `docker network inspect sample_solution_app-network`
- Confirm `OLLAMA_HOST` and `OLLAMA_ANALYZER_HOST` env values match reachable service names

### Audio analysis fails for slices
- Ensure Python dependencies (Essentia, Librosa) are installed in the backend container
- Check backend logs: `docker logs sample_solution-backend-1`
- The audio analysis runs automatically when creating slices

### TensorFlow warnings on startup
- Messages like "oneDNN custom operations" are informational only
- They indicate CPU optimizations are enabled (good for performance)
- Safe to ignore these warnings
