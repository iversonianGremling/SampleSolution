# Sample Solution

A side project for extracting, organizing, and auto-tagging audio samples from YouTube videos using AI.

> ⚠️ **Legal Disclaimer**: This tool downloads audio from YouTube videos. You are responsible for ensuring you have the right to use any downloaded content. Most YouTube content is copyrighted and downloading/using it without permission may violate YouTube's Terms of Service and copyright laws. **Use at your own risk and only with content you have permission to use.**

---

## What It Does

### YouTube Integration
- Paste YouTube URLs to download audio
- Search YouTube directly in the app
- Import playlists (with Google OAuth)
- Automatic high-quality audio extraction

### Sample Creation & Editing
- Visual waveform editor
- Drag to select regions and create slices
- Preview before saving
- Zoom and navigate with minimap
- Download individual slices as MP3

### AI Auto-Tagging (The Cool Part)

**Audio Analysis** - Runs automatically when you create a slice:
- Detects if it's a one-shot or loop
- Finds the BPM/tempo
- Analyzes spectral features
- Tries to identify instruments
- Uses Essentia + Librosa Python libraries

**Metadata Tagging** - Optional, uses Ollama LLM:
- Reads YouTube video titles/descriptions
- Extracts genre, mood, era tags
- Not as accurate but can be useful

### Tag Organization
- Auto-generated tags from AI analysis
- Color-coded tag system
- Custom tags you can create manually
- Tags work on both full tracks and individual slices

---

## Tech Stack

- **Frontend**: React + TypeScript, Vite, Tailwind CSS, WaveSurfer.js
- **Backend**: Node.js + Express, TypeScript, SQLite (Drizzle ORM)
- **AI/Audio**: TensorFlow.js, Python (Essentia + Librosa), Ollama (optional)
- **Tools**: yt-dlp, FFmpeg, YouTube Data API v3
- **Deployment**: Docker Compose

---

## Setup

### What You Need
- Docker & Docker Compose
- Google Cloud account (for YouTube API - see [SETUP.md](SETUP.md))

### Getting Started

1. **Configure environment variables**
   ```bash
   cd backend
   # Edit .env with your Google API credentials
   # See SETUP.md for how to get these
   ```

2. **Start everything**
   ```bash
   docker-compose up -d
   ```

3. **Access the app**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:4000

4. **(Optional) Setup Ollama for metadata tagging**
   ```bash
   docker exec -it sample_solution-ollama-1 ollama pull llama3.2:3b
   ```

**Detailed setup guide**: [SETUP.md](SETUP.md)

---

## How to Use

### Adding Videos
1. Paste a YouTube URL and hit "Add"
2. Or use the search bar to find videos
3. Or authenticate with Google to import your playlists

### Creating Samples
1. Click a track to open the waveform editor
2. Drag across the waveform to select a region
3. Name your slice and save
4. AI automatically analyzes and tags it
5. Download the slice as MP3

### Tags
- AI tags are created automatically when you make slices
- You can also create custom tags in the Tags tab
- Color-code them however you want

---

## Project Structure

```
sample_solution/
├── frontend/          # React app
├── backend/           # Express API
│   ├── src/
│   │   ├── routes/    # API endpoints
│   │   ├── services/  # Audio analysis, YouTube downloads, etc.
│   │   └── db/        # SQLite database
│   └── data/          # Downloaded audio files
├── docker-compose.yml
└── SETUP.md
```

**How it works**: YouTube → yt-dlp downloads audio → FFmpeg processes it → You create slices → Python analyzes audio → AI generates tags → Saved to database

---

## Development

### Running Locally (without Docker)

**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### Building
```bash
docker-compose build
```

---

## Troubleshooting

**Port 4000 already in use:**
```bash
fuser -k 4000/tcp
```

**OAuth errors:** Check your credentials in `.env` and make sure YouTube Data API is enabled in Google Cloud

**TensorFlow warnings on startup:** These are just informational messages about CPU optimizations, ignore them

See [SETUP.md](SETUP.md) for more help.

---

## Important Legal Stuff

### Copyright & Terms of Service

**You need to understand this before using this tool:**

1. **YouTube's Terms of Service**: Downloading content from YouTube likely violates their [Terms of Service](https://www.youtube.com/t/terms) unless you have explicit permission.

2. **Copyright Law**: Most YouTube videos contain copyrighted material. Downloading and using copyrighted audio without permission is illegal in most countries.

3. **When It's (Probably) Okay**:
   - Your own videos/audio
   - Content with explicit permission from the creator
   - Content under Creative Commons licenses that allow it
   - Public domain content

4. **When It's NOT Okay**:
   - Commercial music from record labels
   - Most popular songs/beats/instrumentals
   - Any content you don't have rights to
   - Using samples in commercial productions without clearing them

### This Tool's Purpose

This is a **personal/educational project** to learn about:
- Audio processing
- AI/ML audio analysis
- Full-stack development
- Docker deployment

**It is not intended for:**
- Commercial sample production
- Distributing copyrighted material
- Violating YouTube's TOS
- Creating sample packs for sale without proper licensing

### Your Responsibility

**By using this tool, you agree that:**
- You are solely responsible for ensuring you have rights to any content you download
- You will comply with all applicable laws and YouTube's Terms of Service
- The developers/contributors are not liable for any misuse
- You will not use this to infringe on anyone's copyright

**When in doubt, don't download it.** Get proper licenses or use royalty-free content.

---

## Credits

Built with:
- **yt-dlp** - YouTube download tool
- **FFmpeg** - Audio processing
- **Essentia** & **Librosa** - Audio analysis
- **WaveSurfer.js** - Waveform visualization
- **Ollama** - Local LLM
- **TensorFlow.js** - ML models

This is a side project for learning and experimentation.
