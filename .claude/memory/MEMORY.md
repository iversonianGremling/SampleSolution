# Project Memory

## Project: SampleSolution (Electron Audio App)

### Stack
- Electron 28 + React 18 + Vite (frontend)
- Node/Express + TypeScript + better-sqlite3 (backend, runs as child process)
- Embedded Python (Librosa/Essentia) for audio analysis
- Targets: Windows (NSIS), macOS (DMG), Linux (AppImage)
- Backend runs as Docker in dev / embedded Node in production

### Key Files
- `frontend/electron/main.cjs` — Electron main process, backend spawning, logging
- `frontend/electron/preload.cjs` — IPC bridge
- `frontend/src/utils/rendererLog.ts` — renderer→main log bridge
- `frontend/src/utils/platform.ts` — ElectronAPI types + platform helpers
- `backend/src/services/audioAnalysis.ts` — Python worker management
- `backend/src/services/ffmpeg.ts` — FFmpeg/FFprobe wrappers
- `frontend/scripts/setup-python.mjs` — downloads standalone Python for Windows
- `frontend/scripts/bundle-backend.mjs` — bundles backend for packaging

### Logging System (built session 2026-03-04)
- **main.cjs**: structured `writeLog(level, context, ...args)` with levels INFO/WARN/ERROR/PERF
  - `logInfo/logWarn/logError(context, ...args)` helpers
  - `logPerf(label, startMs, context)` → logs elapsed ms
  - `_appStartMs` tracks total startup time; logged on `ready-to-show`
  - `flushLog()` called on `will-quit` to avoid Windows tail truncation
  - `uncaughtException` + `unhandledRejection` captured to log
  - `did-fail-load`, `render-process-gone`, `unresponsive/responsive` all logged
- **rendererLog.ts**: added `logRendererWarn`, `perfStart()`, `logRendererPerf(context, label, startMs)`
- **preload.cjs**: exposes `getLogPath()` → `ipcRenderer.invoke('get-log-path')`
- **platform.ts**: `ElectronAPI` has `getLogPath` and `warn` log level

### Windows Bugs Fixed (2026-03-04)
1. `app.isQuitting` replaced with module-level `_appIsQuitting` flag
2. Icon path: `resolveWindowIcon()` tries `.ico` → `.icns` → `.png` and guards with `fs.existsSync` (no throw)
3. Log stream flushed via `flushLog()` on `will-quit` to prevent tail truncation
4. `audioAnalysis.ts` debug log path: uses `DATA_DIR` env (set to writable userData) instead of `cwd()` (read-only on packaged Windows)

### Critical Windows Crash: HTMLAudioElement WASAPI handle leak in AudioManager (fixed 2026-03-04, confirmed via logs)
- **Log evidence**: 8 AudioManager.play calls in ~2s of hover, then `useCustomWaveform.decode slice=43`, crash 71ms later
- **Root cause**: `AudioManager.stopAll()` only called `.pause()` — on Windows each HTMLAudioElement holds an open WASAPI stream. With rapid hover-play the accumulated open handles hit the OS audio session limit. When `useCustomWaveform` then opened an AudioContext, the limit was exceeded and the renderer crashed (0xC0000005).
- **Fix**: `stopAll()` now sets `src=''` and calls `load()` after `.pause()`, forcing Chromium to synchronously release the WASAPI handle. `play()` uses internal `releaseCurrentElement()` (destroy old element first) instead of `stopAll()`.
- **File**: `frontend/src/services/AudioManager.ts`

### Windows Crash: AudioContext accumulation in useCustomWaveform (fixed 2026-03-04, was contributing)
- **Symptom**: renderer crash `exitCode -1073741819` (0xC0000005 Access Violation) when opening SampleDetailsView
- **Root cause**: `useCustomWaveform.ts` was creating `new AudioContext()` per sample and not reliably closing it. Windows Electron hits a ~6-context WASAPI handle limit; accumulated contexts from rapid sample switching caused the crash.
- **Fix**: replaced per-decode `new AudioContext()` with a module-level singleton `_sharedAudioCtx` via `getSharedAudioContext()`. Singleton is reused, never closed per-sample. Cleanup callback no longer closes it.
- **Secondary fix**: `decodeAudioData` wrapped in its own try/catch with a `logRendererWarn` before re-throw, so codec errors (24-bit AIFF etc.) show in log before crash.
- **File**: `frontend/src/hooks/useCustomWaveform.ts` lines 1-25 (singleton), decode effect

### Windows-Specific Patterns (working correctly)
- `taskkill /pid {pid} /T /F` for process kill (main + audioAnalysis)
- `windowsHide: true` on backend spawn
- `npm.cmd` / `npx.cmd` on win32
- Python path candidates include `Scripts/python.exe`, `python.exe`
- Path normalisation in import routes: `\\` → `/`
