# YouTube Sample Extractor - Setup Guide

## Quick Start

1. Copy `.env.example` to `.env` and fill in your credentials
2. Run `docker-compose up -d`
3. Access the app at `http://localhost:3000`
4. Pull the Ollama model: `docker exec -it sample_solution-ollama-1 ollama pull llama3.2:3b`

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
SESSION_SECRET=generate-a-random-string-here
```

## Ollama Setup

The Ollama container will start automatically with docker-compose. You need to pull the model once:

```bash
# After starting the containers
docker exec -it sample_solution-ollama-1 ollama pull llama3.2:3b
```

This downloads the llama3.2:3b model (~2GB) which will be used for AI tag extraction.

### Alternative Models

If you want to use a different model, update the `OLLAMA_MODEL` environment variable:

- `llama3.2:1b` - Smaller, faster, less accurate (~1GB)
- `llama3.2:3b` - Recommended balance (~2GB)
- `mistral:7b` - Larger, more accurate (~4GB)
- `phi3:mini` - Microsoft's efficient model (~2GB)

## Production Deployment

For production on Proxmox:

1. Update `GOOGLE_REDIRECT_URI` and `FRONTEND_URL` to your actual domain/IP
2. Generate a secure `SESSION_SECRET`:
   ```bash
   openssl rand -base64 32
   ```
3. In Google Cloud Console, add your production redirect URI to the OAuth credentials
4. Consider setting up HTTPS with a reverse proxy (nginx/traefik)

## Troubleshooting

### "OAuth consent screen not configured"
- Complete Step 4 above to configure the consent screen

### "Access blocked: App not verified"
- This is normal for test apps. Click "Advanced" → "Go to Sample Extractor (unsafe)"
- For production, submit your app for Google verification

### "Ollama model not found"
- Run: `docker exec -it sample_solution-ollama-1 ollama pull llama3.2:3b`

### "yt-dlp download failed"
- YouTube may have updated their site. Update yt-dlp:
  ```bash
  docker exec -it sample_solution-backend-1 pip install --upgrade yt-dlp
  ```

### Container can't connect to Ollama
- Ensure all containers are on the same network
- Check with: `docker network inspect sample_solution_app-network`
