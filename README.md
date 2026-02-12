# Sample Solution

A practical audio sample management and analysis platform for music producers and sound designers. Import your library, slice audio quickly, auto-analyze features, and organize everything with tags, folders, and collections. Works as a webapp, running experiments for a desktop app (electron)

<img width="1929" height="994" alt="image" src="https://github.com/user-attachments/assets/aee09211-d6c7-42ee-86c3-ffb8dedf7015" />


> **Legal Note**: Ensure you have appropriate rights to any content in your library. Use this tool responsibly and in accordance with copyright and intellectual property laws.

---

## Project Status

| Area | Status | Notes |
|------|--------|-------|
| Web app (frontend + backend) | Stable | Main development path |
| Docker deployment | Stable | Recommended quick start |
| Electron desktop mode | Works, limited testing | Usable desktop path, needs more QA |
| Sample Space view | Functional but needs extra tweaking | Useful for discovery, still being tuned |
| Server/client architecture variants | Experimental | Possible, not fully documented |

---

## What It Does

### Import
- **Import Local Files**: Add individual audio files directly to your library
- **Batch Folder Import**: Import full folder structures
- **Source Organization**: Browse and manage by source/folder, create and manage folders/tags/collections efficiently through several tools
- **Drum Rack**: To play around with your samples
- **Batch download and analysis**

### Slice & Analyze
- **Waveform Editor**
  - Drag-to-select and create slices
  - Zoom + minimap navigation
  - Real-time playback
- **Automatic Audio Analysis**
  - 15+ features per sample (spectral, temporal, perceptual)
  - Includes centroid, RMS, tempo cues, attack-related metrics, and more
  - Runs when slices are created

### Organize
- **AI-Assisted Tagging** using audio + naming context
- **Collections** with flexible grouping and hierarchy
- **Advanced Filtering** by tags, duration, source, collections, and metadata
- **Full-Text Search** across sample metadata

### Explore
- **3 sample views**:
  - **Cards** (visual browsing)
  - **List** (dense, practical workflow)
  - **Space** (XO-like similarity/discovery view)

---

## Run Options

### 1) Docker (Recommended)

#### Requirements
- Docker + Docker Compose
- Optional: Google account (OAuth features)

#### Quick start
```bash
docker-compose up -d
```

Access:
- Frontend: http://localhost:3000
- Backend: http://localhost:4000

Detailed setup and environment config: [SETUP.md](SETUP.md)

### 2) Local Development (without Docker)

**Backend**
```bash
cd backend
npm install
npm run dev
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

### 3) Electron Desktop (limited testing)

Use this if you want desktop mode while still running backend separately.

```bash
# terminal 1
cd backend
npm run dev

# terminal 2
cd frontend
npm install
npm run dev:electron
```

More details: [frontend/ELECTRON.md](frontend/ELECTRON.md)

---

## How to Build the Electron Version

If you want distributable desktop builds:

### Standard Electron package
```bash
cd frontend
npm install
npm run build:electron
```

Artifacts are generated in:
- `frontend/release/`

Typical targets:
- Linux: `.AppImage`, `.deb`
- Windows: installer + portable
- macOS: `.dmg`, `.zip`

### Standalone build with embedded backend/Python (advanced)
```bash
cd frontend
./build-standalone.sh
```

This path is intended for distribution and has more moving parts. See [frontend/BUILD.md](frontend/BUILD.md) for full details.

---

## Typical Workflow

1. Import files/folders in **Sources**
2. Open **Editing** to create slices
3. Let analysis run automatically
4. Tag and organize into collections
5. Browse in Cards/List/Space depending on task

---

## Roadmap / TODO

- [ ] Improve metadata import (e.g., artist and additional file metadata columns)
- [ ] Validate folder import substructure behavior across all paths
- [ ] Expand Electron QA across Linux/macOS/Windows
- [ ] Validate export and backup flows more thoroughly
- [ ] Continue tuning Space View placement/weighting and clustering quality

---

## Troubleshooting

**Port issues:**
```bash
fuser -k 4000/tcp
fuser -k 3000/tcp
```

**OAuth errors:** verify credentials in backend `.env` and Google API setup.

**TensorFlow warnings on startup:** often informational CPU optimization logs.

See [SETUP.md](SETUP.md) for deeper troubleshooting.

---

## Responsible Use

- Verify ownership/rights for all imported or downloaded source material
- Respect copyright and platform terms of service
- Use only content you own, have licensed, or that is legally permitted for your use case

The developers are not responsible for misuse.

---

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS, WaveSurfer.js, Pixi.js
- **Backend**: Node.js + Express, TypeScript, SQLite (Drizzle ORM)
- **Audio Analysis**: TensorFlow.js, Python (Essentia + Librosa), Meyda
- **Visualization**: UMAP/t-SNE and clustering for similarity exploration
- **Packaging/Deploy**: Docker Compose + Electron
