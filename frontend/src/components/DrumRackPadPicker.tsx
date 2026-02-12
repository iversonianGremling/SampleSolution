import { useState } from 'react'
import { Disc3 } from 'lucide-react'
import { useDrumRack } from '../contexts/DrumRackContext'
import type { Slice } from '../types'

const KEY_LABELS = [
  ['1', '2', '3', '4'],
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
]

const PAD_COLORS_ACTIVE = [
  'bg-blue-500/20 border-blue-500/40',
  'bg-cyan-500/20 border-cyan-500/40',
  'bg-teal-500/20 border-teal-500/40',
  'bg-emerald-500/20 border-emerald-500/40',
  'bg-violet-500/20 border-violet-500/40',
  'bg-purple-500/20 border-purple-500/40',
  'bg-fuchsia-500/20 border-fuchsia-500/40',
  'bg-pink-500/20 border-pink-500/40',
  'bg-rose-500/20 border-rose-500/40',
  'bg-orange-500/20 border-orange-500/40',
  'bg-amber-500/20 border-amber-500/40',
  'bg-yellow-500/20 border-yellow-500/40',
  'bg-indigo-500/20 border-indigo-500/40',
  'bg-sky-500/20 border-sky-500/40',
  'bg-lime-500/20 border-lime-500/40',
  'bg-red-500/20 border-red-500/40',
]

// Row/col to pad index (bottom row = pads 0-3, like MPC)
const getPadIndex = (row: number, col: number) => (3 - row) * 4 + col

interface DrumRackPadPickerProps {
  sample: Slice
  onClose: () => void
}

export function DrumRackPadPicker({ sample, onClose }: DrumRackPadPickerProps) {
  const { pads, assignSample, clearPad } = useDrumRack()
  const [confirmClear, setConfirmClear] = useState<number | null>(null)

  const handlePadClick = (padIndex: number) => {
    if (pads[padIndex].slice) return // occupied pads can't be clicked
    assignSample(padIndex, sample)
    onClose()
  }

  const handleContextMenu = (padIndex: number, e: React.MouseEvent) => {
    e.preventDefault()
    if (!pads[padIndex].slice) return
    setConfirmClear(padIndex)
  }

  const handleConfirmClear = (padIndex: number) => {
    clearPad(padIndex)
    setConfirmClear(null)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-surface-border rounded-xl shadow-2xl p-5 w-[320px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Disc3 size={16} className="text-accent-primary" />
          <h3 className="text-sm font-medium text-white">Send to Drum Rack</h3>
        </div>
        <p className="text-xs text-slate-400 mb-4 truncate">
          {sample.name}
        </p>

        <div className="grid grid-cols-4 gap-1.5">
          {KEY_LABELS.map((row, rowIdx) =>
            row.map((key, colIdx) => {
              const padIndex = getPadIndex(rowIdx, colIdx)
              const pad = pads[padIndex]
              const isOccupied = !!pad.slice

              return (
                <div key={padIndex} className="relative">
                  <button
                    onClick={() => handlePadClick(padIndex)}
                    onContextMenu={(e) => handleContextMenu(padIndex, e)}
                    className={`w-full aspect-square rounded-lg border text-center flex flex-col items-center justify-center gap-0.5 transition-all ${
                      isOccupied
                        ? `${PAD_COLORS_ACTIVE[padIndex]} opacity-50 cursor-default`
                        : 'bg-surface-overlay border-surface-border hover:border-accent-primary hover:bg-accent-primary/10 cursor-pointer'
                    }`}
                    title={isOccupied ? `${pad.slice!.name} (right-click to clear)` : `Pad ${key}`}
                  >
                    <span className="text-[9px] font-mono font-bold text-slate-500">{key}</span>
                    {isOccupied ? (
                      <span className="text-[8px] text-slate-400 truncate w-full px-1">
                        {pad.slice!.name.length > 8 ? pad.slice!.name.slice(0, 8) + '…' : pad.slice!.name}
                      </span>
                    ) : (
                      <span className="text-[8px] text-slate-600">empty</span>
                    )}
                  </button>

                  {/* Confirm clear popover */}
                  {confirmClear === padIndex && (
                    <div className="absolute z-10 -top-2 left-1/2 -translate-x-1/2 -translate-y-full bg-surface-raised border border-surface-border rounded-lg shadow-xl p-3 w-40">
                      <p className="text-[11px] text-slate-300 mb-2">Clear this pad?</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleConfirmClear(padIndex)}
                          className="flex-1 px-2 py-1 text-[11px] bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => setConfirmClear(null)}
                          className="flex-1 px-2 py-1 text-[11px] bg-surface-base text-slate-400 border border-surface-border rounded hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <p className="text-[10px] text-slate-600 mt-3 text-center">
          Click empty pad to assign &middot; Right-click occupied pad to clear
        </p>
      </div>
    </div>
  )
}
