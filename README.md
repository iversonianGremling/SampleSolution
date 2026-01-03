# Sample Solution

A simple tool for downloading songs and cutting samples easily using youtube-dlp and the youtube API. It uses local AI to come up with tags.

<img width="1291" height="880" alt="image" src="https://github.com/user-attachments/assets/d22647c8-f048-4b95-afcc-c72b5ddec871" />


> ⚠️ **Legal Disclaimer**: This tool downloads audio from YouTube videos. You are responsible for ensuring you have the right to use any downloaded content. **Use at your own risk and only with content you have permission to use.**

---

## What It Does

### YouTube Integration
- Paste YouTube URLs to download audio
- Search YouTube directly in the app
- Import playlists (with Google OAuth)

### Sample Creation & Editing
- Visual waveform editor
- Drag to select regions and create slices
- Zoom and navigate with minimap
- Download individual slices as MP3

### AI Auto-Tagging (Locally deployed)

**Audio Analysis** - Runs automatically when you create a slice:
- Analyzes several features of the sample (like if it's a one-shot or a loop)
- Uses Essentia + Librosa Python libraries
- Metadata extraction + Ollama analysis

---

## Setup

### What You Need
- Docker & Docker Compose
- Google Cloud account (for YouTube API - see [SETUP.md](SETUP.md))

### Getting Started

1. **Configure environment variables**
   [SETUP.md](SETUP.md)
   ```bash
   cd backend
   # Edit .env.example with your Google API credentials
   # See SETUP.md for how to get these and extra details
   ```

2. **Start everything**
   ```bash
   docker-compose up -d
   ```

3. **Access the app**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:4000

4. **(Optional) Setup Ollama for metadata tagging** (the other AI models should still work on their own)
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
- They technically work but it's still a work in progress

---


**How it works**: YouTube → yt-dlp downloads audio → FFmpeg processes it → You create slices → Python analyzes audio → AI generates tags → Saved to database

OR

YouTube → yt-dlp downloads audio → FFmpeg processes it → You create slices → Download → Profit

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

**This tool is not intended for:**
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

## Tech Stack

- **Frontend**: React + TypeScript, Vite, Tailwind CSS, WaveSurfer.js
- **Backend**: Node.js + Express, TypeScript, SQLite (Drizzle ORM)
- **AI/Audio**: TensorFlow.js, Python (Essentia + Librosa), Ollama (optional)
- **Tools**: yt-dlp, FFmpeg, YouTube Data API v3
- **Deployment**: Docker Compose

---

## Credits

Built with:
- **yt-dlp** - YouTube download tool
- **FFmpeg** - Audio processing
- **Essentia** & **Librosa** - Audio analysis
- **WaveSurfer.js** - Waveform visualization
- **Ollama** - Local LLM
- **TensorFlow.js** - ML models
