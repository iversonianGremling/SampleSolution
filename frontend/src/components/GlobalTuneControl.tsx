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
const WHITE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const BLACK_KEYS = [
  { note: 'C#', left: 14 },
  { note: 'D#', left: 34 },
  { note: 'F#', left: 74 },
  { note: 'G#', left: 94 },
  { note: 'A#', left: 114 },
] as const

const keyboardWidth = 140
const whiteKeyWidth = 20
const blackKeyWidth = 12
const TUNE_INFO_TEXT = 'To keep previews fast and smooth, tuning always uses Tape mode.'

function TuneInfoIcon() {
  return (
    <div className="relative group">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface-base text-slate-300"
        title={TUNE_INFO_TEXT}
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
            className="relative h-7 rounded-md border border-surface-border bg-surface-base overflow-hidden"
            style={{ width: keyboardWidth }}
            role="group"
            aria-label="Tune all samples to note"
          >
            <div className="absolute inset-0 flex">
              {WHITE_KEYS.map((note) => {
                const active = tuneTargetNote === note
                const hue = NOTE_HUES[note]
                return (
                  <button
                    key={note}
                    type="button"
                    onClick={() => onTuneTargetNoteChange(active ? null : note)}
                    className="h-full border-r border-slate-500/20 text-[10px] font-semibold transition-colors"
                    style={{
                      width: whiteKeyWidth,
                      borderRightWidth: note === 'B' ? 0 : 1,
                      backgroundColor: active ? `hsl(${hue}, 62%, 46%)` : '#f8fafc',
                      color: active ? '#ffffff' : '#334155',
                    }}
                    title={active ? `Clear tuning (${note})` : `Tune all to ${note}`}
                  >
                    {note}
                  </button>
                )
              })}
            </div>

            {BLACK_KEYS.map(({ note, left }) => {
              const active = tuneTargetNote === note
              const hue = NOTE_HUES[note]
              return (
                <button
                  key={note}
                  type="button"
                  onClick={() => onTuneTargetNoteChange(active ? null : note)}
                  className="absolute top-0 h-[18px] rounded-b-md border border-slate-900/80 text-[9px] font-semibold transition-colors"
                  style={{
                    left,
                    width: blackKeyWidth,
                    backgroundColor: active ? `hsl(${hue}, 62%, 44%)` : '#0f172a',
                    color: '#f8fafc',
                    zIndex: 2,
                  }}
                  title={active ? `Clear tuning (${note})` : `Tune all to ${note}`}
                >
                  {note.replace('#', '♯')}
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
