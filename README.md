# Sample Solution

A practical audio sample management and analysis platform for music producers and sound designers. Import your library, slice audio quickly, auto-analyze features, and organize everything with tags, folders, and collections. It also works as a webapp (be careful with space, it will effectively duplicate your sample library).

> **Legal Note**: Ensure you have appropriate rights to any content in your library. Use this tool responsibly and in accordance with copyright and intellectual property laws.

## Download Releases

- Latest release: https://github.com/iversonianGremling/SampleSolution/releases/latest
- All releases: https://github.com/iversonianGremling/SampleSolution/releases
- Linux artifacts include: `.AppImage`, `.deb`
- Windows artifacts include: installer `.exe`, portable `.exe`
- macOS artifacts include: `.dmg`, `.zip` (not tested yet, contributions are appreciated, even if vibe-coded)

## What It Does

- **Import / Sources**
  - Import local files, folders, links, and playlists
  - Choose import destination strategy (existing destination, single new collection, split by first subfolder)
  - Manage collections/folders and run advanced category management
- **Main Panel**
  - Browse samples in Card, List, or XO-like Space view
  - Search, sort, preview, and open sample details
  - Jump into similar-sample mode for discovery workflows
- **Filters**
  - Filter by tags, instruments, one-shot/loop, dimensions, and standard features
  - Use note/scale, envelope, and date filters
  - Use advanced rule builder, bulk rename/convert, and duplicate detection
- **More features**
  - Right panel showing sample details, a drum rack, and lab for trying out effects.
  - Send samples to Drum Rack, use sequencer/global FX, and render edits from Lab
- **Settings**
  - Accessibility options (theme/font/font size)
  - Re-analysis of the whole library with concurrency support
- **Future Features**
  - General debugging
  - Incremental backup system with local options, sync options for google drive, nextcloud and other methods
  - Better sample slicing capabilities
  - Better support for self hosting

## If you want to run it on docker or build it

### Docker

```bash
docker compose up -d --build
```

GPU mode (optional):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

App URLs:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

### Electron

Development mode (backend + electron UI):

```bash
# terminal 1
cd backend
npm install
npm run dev

# terminal 2
cd frontend
npm install
npm run dev:electron
```

Build desktop release artifacts:

```bash
cd frontend
npm run build:electron
```

Output directory: `frontend/release/`

## Screenshots

- `[ Screenshot placeholder 1 ]`
- `[ Screenshot placeholder 2 ]`
- `[ Screenshot placeholder 3 ]`

## Demo Video

- `[ Video placeholder: app walkthrough ]`

## Troubleshooting (Very Limited)

These notes are minimal and low-scope.

- **Release/Electron users**
  - If Electron dev fails to start, clear Vite cache in `frontend/node_modules/.vite` and retry. Just delete whatever is on that folder.
- **Docker users**
  - If ports are busy run on the terminal: `fuser -k 3000/tcp` and `fuser -k 4000/tcp`
  - If OAuth features fail, verify backend env values for provider credentials and callback URLs.
- **Source/dev users**
  - TensorFlow startup warnings are often informational.

## Roadmap

- [ ] Debugging
- [ ] Testing release on Mac
- [ ] Refactoring the code to reduce the amount of AI slop
- [ ] Add extra features

## For Developers/Contributors

### WARNING

As of **March 6, 2026**, parts of this codebase still contain AI-generated output that has not been fully cleaned up yet.
- Some areas are solid, others need manual refactoring and stricter review
- Expect inconsistent naming/structure in parts of the project
- Contributions that improve clarity, tests, and maintainability are welcome but I don't think it's responsible for me to ask for them

Current practical status:
- Docker on Linux is the most reliable path
- Electron on Linux works
- Electron on Windows works but seems more error prone

`SETUP.md` is currently legacy and not the primary onboarding document.

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js + Express, TypeScript, SQLite (Drizzle ORM)
- **Audio Analysis**: TensorFlow.js + Python tools (Essentia/Librosa)
- **Packaging/Deploy**: Docker Compose + Electron
