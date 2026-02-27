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

## GitHub Automation (Updates + Releases)

This repository includes GitHub Actions workflows for update monitoring and release automation.

### Check for repo updates
- Workflow: `.github/workflows/check-updates.yml`
- Triggers:
  - Manual (`workflow_dispatch`)
  - Daily schedule at `09:00 UTC`
- What it reports:
  - Latest release tag (`v*`)
  - Commit count since latest release
  - Whether unreleased updates exist
- Optional manual mode:
  - Set `fail_if_unreleased=true` to fail the run when unreleased commits are found

### Automatic dependency update checks
- Config: `.github/dependabot.yml`
- Checks weekly for:
  - `backend` npm dependencies
  - `frontend` npm dependencies
  - GitHub Actions version updates
- Dependabot opens PRs with labels so updates are easy to review.

### Enforce version consistency in PRs
- Workflow: `.github/workflows/version-consistency.yml`
- Triggers:
  - Pull requests
  - Pushes to `main`
- What it validates:
  - `VERSION` exists and contains valid semver
  - `VERSION`, `backend/package.json`, and `frontend/package.json` all match

### Create named releases from GitHub Actions
- Workflow: `.github/workflows/release.yml`
- Trigger: Manual (`workflow_dispatch`)
- Inputs:
  - `release_name`: optional custom name shown in GitHub Releases
  - `draft` / `prerelease`
- Default release naming:
  - Uses `Release vX.Y.Z - <CODENAME>` when a root `CODENAME` file is present
  - Falls back to `Release vX.Y.Z` if `CODENAME` is missing/empty
- What it does automatically:
  1. Validates `VERSION`, `backend/package*.json`, and `frontend/package*.json` are aligned
  2. Creates and pushes tag `vX.Y.Z` for the checked-in version
  3. Builds desktop artifacts on GitHub Actions for:
     - Linux (`AppImage`, `.deb`)
     - Windows (`.exe` installer + portable)
     - macOS (`.dmg`, `.zip`) when runner/platform supports
  4. Creates the GitHub Release with generated release notes and uploads binaries

Version bumps should be committed via normal PR flow before running the release workflow.

If branch protection blocks pushes from `github-actions[bot]`, allow workflow pushes or use a release branch flow.

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
## Screenshots
### 🌌 Space View
<img width="707" height="784" alt="image" src="https://github.com/user-attachments/assets/22d024d6-f8a6-480a-bc42-def89a530a8c" />


> **XO-like "Space View"** — A visual map for exploring your sample library.

---

### 🎵 Slice View
<img width="901" height="842" alt="image" src="https://github.com/user-attachments/assets/6c3cfa4c-3c06-46e3-9929-d700cce59838" />


> **Slice View** for a royalty-free song on YouTube.

---

### 📦 Organized depending on source
<img width="706" height="515" alt="image" src="https://github.com/user-attachments/assets/665531c4-ec49-46d5-925c-5b4f8ff4a79f" />


> Samples are neatly organized inside containers depending on their origin.

---

### 🔍 Advanced Filtering
<img width="1189" height="784" alt="image" src="https://github.com/user-attachments/assets/65b88063-6a84-44a6-a6ec-7f16d476d4ab" />


> Detailed filtering options to narrow down specific sounds.

---

### ⚙️ Granular Sample Management
<img width="973" height="845" alt="image" src="https://github.com/user-attachments/assets/b91b65ec-c004-474d-a10a-290db55082de" />


> **Commit-based Workflow:** Advanced control for moving samples between categories. 
> *Example: Moving samples in the `Kicks` folder (excluding `Snares`) tagged with `808` to `Kicks > 808s`. Changes are staged as commits for review and confirmation.*

---

### 🥁 Drum Rack & Sequencer
<img width="1040" height="743" alt="image" src="https://github.com/user-attachments/assets/85170792-d1d8-4590-8868-7266cfd1adc6" />

> Integrated drum rack with a simple sequencer for rapid testing.

---

### 📥 Import & Settings
<img width="1032" height="779" alt="image" src="https://github.com/user-attachments/assets/73e41eb3-fd32-45c2-9ef0-3c47edace276" />

<img width="1041" height="904" alt="image" src="https://github.com/user-attachments/assets/e6a4b1f4-76a4-4c53-aa29-f3a765f5f589" />


> **Import Page:** Flexible options for bringing in new libraries.
> **Settings:** Deep customization options for the application environment.

---
## Run Options

### 1) Docker (Recommended)

#### Requirements
- Docker + Docker Compose
- Optional: NVIDIA GPU + NVIDIA Container Toolkit (for GPU-accelerated Ollama)
- Optional: Google account (OAuth features)

#### Quick start
```bash
docker-compose up -d
```

Optional GPU mode:
```bash
docker-compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Optional downloader tool toggles (set in `.env`):
```bash
# Build-time image contents (requires rebuild)
INSTALL_YTDLP=1
INSTALL_SPOTDL=1

# Runtime lazy install on first use
AUTO_INSTALL_DOWNLOAD_TOOLS=0
AUTO_INSTALL_YTDLP=0
AUTO_INSTALL_SPOTDL=0

# Ollama endpoints
OLLAMA_HOST=http://ollama:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_ANALYZER_HOST=http://ollama-analyzer:11434
OLLAMA_ANALYZER_MODEL=${OLLAMA_MODEL}
OLLAMA_CPU_HOST=http://ollama:11434
OLLAMA_CPU_MODEL=${OLLAMA_MODEL}

# Tag review fallback chain + retry policy
OLLAMA_TAG_REVIEW_TARGET_CHAIN=analyzer,primary,cpu
OLLAMA_TAG_REVIEW_RETRIES_PER_TARGET=1
OLLAMA_TAG_REVIEW_RETRY_DELAY_MS=200

# Hard-disable Spotify import path at backend runtime
ENABLE_SPOTIFY_IMPORT=1

# Spotify OAuth / API credentials (required for Spotify playlist import)
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
BACKEND_URL=http://localhost:4000

# Frontend build flags (requires rebuild)
# Optional override if building frontend manually
VITE_ENABLE_SPOTIFY_IMPORT=1
VITE_SHOW_DOWNLOAD_TOOLS_UI=0
# Optional: Stripe donation payment link for header Donate button
VITE_STRIPE_DONATION_URL=https://donate.stripe.com/your-payment-link
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

**OAuth errors:** verify credentials in backend `.env` and provider app setup (Google and/or Spotify).

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
