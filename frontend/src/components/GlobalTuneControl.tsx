import { Info, X } from 'lucide-react'
import { useAccessibility, type AppTheme } from '../contexts/AccessibilityContext'

interface GlobalTuneControlProps {
  tuneTargetNote: string | null
  onTuneTargetNoteChange: (note: string | null) => void
}

const NOTE_HUES: Record<string, number> = {
  C: 0,
  'C#': 30,
  D: 60,
  'D#': 90,
  E: 120,
  F: 150,
  'F#': 180,
  G: 210,
  'G#': 240,
  A: 270,
  'A#': 300,
  B: 330,
}

const CHROMATIC_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const INACTIVE_NOTE_STYLES: Record<AppTheme, {
  sharpBg: string
  sharpText: string
  naturalBg: string
  naturalText: string
}> = {
  dark: {
    sharpBg: '#1c2330',
    sharpText: '#b7c2d4',
    naturalBg: '#2a3340',
    naturalText: '#cad4e4',
  },
  light: {
    sharpBg: '#dbe7f6',
    sharpText: '#334155',
    naturalBg: '#f7faff',
    naturalText: '#0f172a',
  },
}

const getActiveNoteTextColor = (hue: number): string =>
  hue >= 45 && hue <= 165 ? '#0f172a' : '#ffffff'

function TuneInfoIcon() {
  return (
    <div className="relative group">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary"
        aria-label="Tuning info"
      >
        <Info size={12} className="text-text-muted" />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-[160] mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-surface-border bg-surface-raised px-2 py-1 text-[11px] text-text-primary opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        Hover/list previews use Tape for performance.
      </span>
    </div>
  )
}

export function GlobalTuneControl({
  tuneTargetNote,
  onTuneTargetNoteChange,
}: GlobalTuneControlProps) {
  const { theme } = useAccessibility()
  const noteStyle = INACTIVE_NOTE_STYLES[theme]

  return (
    <div className="flex items-center min-w-0">
      <div className="flex xl:hidden items-center gap-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Tune</span>
        <select
          value={tuneTargetNote ?? ''}
          onChange={(e) => onTuneTargetNoteChange(e.target.value || null)}
          className="h-6 max-w-[68px] px-1.5 text-xs bg-surface-base border border-surface-border rounded text-text-primary focus:outline-none focus:border-accent-primary"
          title="Tune all samples to note"
        >
          <option value="">Off</option>
          {CHROMATIC_NOTES.map((note) => (
            <option key={note} value={note}>
              {note}
            </option>
          ))}
        </select>
        <TuneInfoIcon />
      </div>

      <div className="hidden xl:flex items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted whitespace-nowrap">
            Tune All
          </span>
          <div
            className="h-7 rounded-md border border-surface-border bg-surface-base overflow-hidden flex"
            role="group"
            aria-label="Tune all samples to note"
          >
            {CHROMATIC_NOTES.map((note, idx) => {
              const active = tuneTargetNote === note
              const hue = NOTE_HUES[note]
              const isSharp = note.includes('#')
              const inactiveBg = isSharp ? noteStyle.sharpBg : noteStyle.naturalBg
              const inactiveText = isSharp ? noteStyle.sharpText : noteStyle.naturalText
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => onTuneTargetNoteChange(active ? null : note)}
                  className="h-full min-w-[22px] px-1 border-r border-surface-border/70 text-[10px] font-semibold transition-colors"
                  style={{
                    borderRightWidth: idx === CHROMATIC_NOTES.length - 1 ? 0 : 1,
                    backgroundColor: active ? `hsl(${hue}, 62%, 44%)` : inactiveBg,
                    color: active ? getActiveNoteTextColor(hue) : inactiveText,
                  }}
                  title={active ? `Clear tuning (${note})` : `Tune all to ${note}`}
                >
                  {note}
                </button>
              )
            })}
          </div>

          {tuneTargetNote ? (
            <button
              type="button"
              onClick={() => onTuneTargetNoteChange(null)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-accent-primary/50 bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors"
              title="Clear tuning"
            >
              {tuneTargetNote}
              <X size={10} />
            </button>
          ) : (
            <span className="text-[10px] text-text-muted">Off</span>
          )}
        </div>

        <TuneInfoIcon />
      </div>
    </div>
  )
}
