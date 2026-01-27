# Sample Solution

A comprehensive audio sample management and analysis platform for music producers and sound designers. Import your audio library, extract and organize samples, and discover patterns through advanced audio feature analysis and interactive visualization.

<img width="1895" height="899" alt="image" src="https://github.com/user-attachments/assets/d5ca1454-722f-4e65-be19-2a8afe1cae42" />



> **Legal Note**: Ensure you have appropriate rights to any content in your library. Use this tool responsibly and in accordance with copyright and intellectual property laws.

---

## What It Does

### Audio Library Management
- **Import Local Files**: Upload individual audio files directly to your library
- **Batch Folder Import**: Import entire folder structures to organize your samples
- **Flexible Organization**: Create hierarchical collections and organize by source
- **Track Metadata**: Manage and edit information for all your audio tracks

### Sample Creation & Professional Analysis
- **Waveform Editor**: Precision visual interface for sample extraction
  - Drag-to-select regions and create slices
  - Zoom and navigate with minimap overview
  - Real-time audio playback
- **Automatic Audio Analysis**: Industry-standard feature extraction
  - 15+ audio features computed per sample (spectral, temporal, perceptual)
  - Features include: spectral centroid, RMS energy, tempo detection, attack time, and more
  - Runs automatically when samples are created
  - Enables intelligent search and discovery
- **Slice Export**: Download processed samples in multiple formats

### Smart Organization & Discovery
- **AI-Assisted Tagging**: Intelligent sample categorization
- **Advanced Filtering**: Find samples by duration, tags, collections, source, and more
- **Full-Text Search**: Search across sample metadata
- **Collections**: Organize samples into nested collections with custom colors

### Interactive Visualization
- **Sample Space View**: Explore your sample library in an interactive 2D space
  - Dimensionality reduction algorithms visualize sample relationships
  - Visual cluster identification
  - Custom feature weighting for exploration

---

## Setup

### Requirements
- Docker & Docker Compose
- Optional: Google account (for OAuth features)

### Getting Started

1. **Configure environment variables**
   ```bash
   cd backend
   # Copy and edit .env.example with your settings
   # See SETUP.md for detailed configuration options
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

### Importing Audio
1. Navigate to the **Sources** tab
2. Upload individual files or import entire folders
3. Files are automatically organized and indexed

### Creating Samples
1. Select a track from your library
2. Open the **Editing** tab to access the waveform editor
3. Drag across the waveform to select a region
4. Name your slice and save
5. Audio analysis runs automatically
6. Organize with tags and collections
7. Download the slice as needed

### Discovering Samples
1. Visit the **Samples** tab to view your library
2. Use filters to find samples by duration, tags, or collection
3. Search by name or metadata
4. View the **Sample Space** visualization to explore relationships
5. Adjust feature weights to focus on specific characteristics

### Building Collections
1. Create custom collections from the Collections menu
2. Assign samples to multiple collections
3. Organize hierarchically with parent/child relationships
4. Use color coding for visual organization

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

**Port issues:**
```bash
fuser -k 4000/tcp  # Free port 4000
fuser -k 3000/tcp  # Free port 3000
```

**OAuth errors:** Verify your credentials in `.env` and check that required APIs are properly configured

**TensorFlow warnings on startup:** These are informational messages about CPU optimizations and can be safely ignored

See [SETUP.md](SETUP.md) for detailed troubleshooting and configuration help.

---

### Using This Tool Responsibly

- **Verify Ownership**: Ensure you have the rights to any content you import into this system
- **Respect Copyright**: Do not use this tool to infringe on intellectual property rights
- **Follow Terms of Service**: Comply with all applicable laws and terms of service for any content sources
- **Proper Licensing**: Use only content you own, have licensed, or that is properly licensed for your intended use

The developers are not responsible for misuse of this tool.

---

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS, WaveSurfer.js, Pixi.js
- **Backend**: Node.js + Express, TypeScript, SQLite (Drizzle ORM)
- **Audio Analysis**: TensorFlow.js, Python (Essentia + Librosa), Meyda
- **Visualization**: UMAP/t-SNE for dimensionality reduction, K-means clustering
- **Deployment**: Docker Compose

---

## Libraries & Tools

This project uses:
- **FFmpeg** - Audio processing
- **Essentia** & **Librosa** - Audio feature extraction
- **WaveSurfer.js** - Waveform visualization
- **TensorFlow.js** - Machine learning models
- **Ollama** - Optional local LLM for advanced tagging
- **Google APIs** - OAuth and data integration (optional)
