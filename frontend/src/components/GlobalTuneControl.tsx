import { Info, X } from 'lucide-react'

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

function TuneInfoIcon() {
  return (
    <div className="relative group">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface-base text-slate-300"
        aria-label="Tuning info"
      >
        <Info size={12} className="text-slate-400" />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-[160] mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        Tape mode only, so tuning stays fast.
      </span>
    </div>
  )
}

export function GlobalTuneControl({
  tuneTargetNote,
  onTuneTargetNoteChange,
}: GlobalTuneControlProps) {
  return (
    <div className="flex items-center min-w-0">
      <div className="flex xl:hidden items-center gap-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Tune</span>
        <select
          value={tuneTargetNote ?? ''}
          onChange={(e) => onTuneTargetNoteChange(e.target.value || null)}
          className="h-6 max-w-[68px] px-1.5 text-xs bg-surface-base border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary"
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap">
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
              const inactiveBg = isSharp ? '#1c2330' : '#2a3340'
              const inactiveText = isSharp ? '#b7c2d4' : '#cad4e4'
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => onTuneTargetNoteChange(active ? null : note)}
                  className="h-full min-w-[22px] px-1 border-r border-slate-500/20 text-[10px] font-semibold transition-colors"
                  style={{
                    borderRightWidth: idx === CHROMATIC_NOTES.length - 1 ? 0 : 1,
                    backgroundColor: active ? `hsl(${hue}, 62%, 44%)` : inactiveBg,
                    color: active ? '#ffffff' : inactiveText,
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
            <span className="text-[10px] text-slate-500">Off</span>
          )}
        </div>

        <TuneInfoIcon />
      </div>
    </div>
  )
}
