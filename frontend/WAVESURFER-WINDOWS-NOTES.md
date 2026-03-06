# WaveSurfer on Windows (Electron Packaged) - Debug Notes

## Scope
- App: `frontend` Electron desktop build (Windows packaged via `electron-builder`)
- Problem: renderer process crashes when opening or loading waveform-heavy views (`Sample Details`, and sometimes `Lab` waveform load path)
- Symptom: DevTools disconnects, UI stops responding, app window may remain open

## Repro Signal
- Main process log (`%APPDATA%/sample-solution-frontend/main.log`) repeatedly shows:
  - `Renderer process exited unexpectedly: {"reason":"crashed","exitCode":-1073741819}`
- Crash happens shortly after waveform load events, e.g. `SliceWaveform.load` / `SliceWaveform.fallbackLoad`.

## What Is Implemented Now
- Preflight checks before waveform source load:
  - Validate source URL accessibility with a short media metadata probe.
  - Generate readable error text with filename and reason.
  - Log renderer diagnostics with context (`preflightFailed`, `loadFailed`, etc.).
- Windows-specific WaveSurfer load path:
  - On Windows Electron, use `fetch -> ArrayBuffer -> Uint8Array -> Blob -> wavesurfer.loadBlob(blob)`.
  - This follows the known workaround for some Windows decoding paths.
- Coverage:
  - `SliceWaveform`
  - `useWavesurfer` (main + minimap)
  - `useCompactWaveform`
  - `LabView` waveform decode preflight

## Why This Is Still Useful
- Even if the crash is not fully eliminated on all machines, logs now identify:
  - source URL
  - failure reason
  - specific component hook emitting the failure
- UI now has targeted waveform error messaging rather than silent failure.

## Possible Alternatives to WaveSurfer
Goal: keep current feature set (playhead, region slicing, zoom/minimap, click/drag interactions, transport sync).

### Option A: Hybrid, keep WaveSurfer only in Editor
- Keep WaveSurfer where region tooling is strongest (`WaveformEditor`).
- Replace `Sample Details` + compact waveform visualizations with custom Canvas + `<audio>`.
- Reuse existing `LabView` custom waveform renderer patterns.
- Pros:
  - Lower blast radius
  - Removes WaveSurfer from highest-crash paths first
- Cons:
  - Two waveform stacks to maintain

### Option B: Full custom waveform stack (Canvas + Web Audio)
- Build one internal waveform module:
  - Peaks generation via Web Audio decoding
  - Canvas rendering (waveform, progress, cursor, markers)
  - Region model + hit-testing + drag/resize
  - Shared transport API for all views
- Pros:
  - Maximum control and platform-specific workarounds
  - Single rendering engine across app
- Cons:
  - Largest engineering effort
  - Must reimplement region/minimap behavior currently provided by WaveSurfer

### Option C: Replace with another waveform library
- Candidate libraries exist, but parity for region editing + minimap + robust Electron behavior must be proven in this app.
- Pros:
  - Potentially faster than full custom if a library matches needs
- Cons:
  - Migration risk similar to Option B if feature gaps exist
  - Unknown Windows packaged stability until tested

## Feature Parity Checklist (must keep)
- Render waveform from URL/blob
- Play/pause/seek + external transport control
- Click-to-seek
- Region creation/edit/delete
- Loop region playback
- Minimap/viewport control
- Playback cursor + current time reporting
- Error reporting with filename and reason

## Recommended Next Step
- Execute a spike for **Option A**:
  - Move `Sample Details` waveform to custom Canvas + `<audio>` first.
  - Keep `WaveformEditor` on WaveSurfer temporarily.
  - Compare crash rate in packaged Windows builds.
