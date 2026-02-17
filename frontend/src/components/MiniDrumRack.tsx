import { useState, useCallback, useRef, useEffect } from 'react'
import { Maximize2 } from 'lucide-react'
import { useDrumRack } from '../contexts/DrumRackContext'
import type { Slice } from '../types'

const PAD_KEYS = ['Z','X','C','V','A','S','D','F','Q','W','E','R','1','2','3','4']

const PAD_COLORS_SOLID = [
  'bg-blue-500', 'bg-cyan-500', 'bg-teal-500', 'bg-emerald-500',
  'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
  'bg-indigo-500', 'bg-sky-500', 'bg-lime-500', 'bg-red-500',
]

interface MiniDrumRackProps {
  onExpand: () => void
}

export function MiniDrumRack({ onExpand }: MiniDrumRackProps) {
  const {
    pads,
    assignSample,
    clearPad,
    getAudioBuffer,
    getAudioContext,
    getPadInputNode,
  } = useDrumRack()

  const [activePads, setActivePads] = useState<Set<number>>(new Set())
  const activeSourcesRef = useRef<Map<number, AudioBufferSourceNode>>(new Map())

  useEffect(() => {
    return () => {
      for (const source of activeSourcesRef.current.values()) {
        try { source.stop() } catch { /* */ }
      }
      activeSourcesRef.current.clear()
    }
  }, [])

  const triggerPad = useCallback((padIndex: number) => {
    const pad = pads[padIndex]
    if (!pad.slice || pad.muted) return
    const buffer = getAudioBuffer(pad.slice.id)
    if (!buffer) return

    const ctx = getAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(getPadInputNode(padIndex))

    activeSourcesRef.current.set(padIndex, source)
    setActivePads(prev => new Set(prev).add(padIndex))

    source.onended = () => {
      activeSourcesRef.current.delete(padIndex)
      setActivePads(prev => {
        const next = new Set(prev)
        next.delete(padIndex)
        return next
      })
    }

    source.start()
  }, [pads, getAudioBuffer, getAudioContext, getPadInputNode])

  const handleDrop = useCallback((padIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    try {
      const data = e.dataTransfer.getData('application/json')
      if (data) {
        const parsed = JSON.parse(data)
        const slice = parsed.slice || parsed
        if (slice.id) assignSample(padIndex, slice as Slice)
      }
    } catch { /* ignore */ }
  }, [assignSample])

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-2 mini-rack-enter">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Drum Rack</span>
        <button
          onClick={onExpand}
          className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
          title="Expand Drum Rack"
        >
          <Maximize2 size={12} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {/* Render pads in visual order: top row = pads 12-15, bottom row = pads 0-3 */}
        {[3, 2, 1, 0].map(row =>
          [0, 1, 2, 3].map(col => {
            const padIndex = row * 4 + col
            const pad = pads[padIndex]
            const isActive = activePads.has(padIndex)

            return (
              <button
                key={padIndex}
                onClick={() => pad.slice && triggerPad(padIndex)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (pad.slice) clearPad(padIndex)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(padIndex, e)}
                className={`w-7 h-7 rounded border transition-all duration-75 flex items-center justify-center text-[8px] font-mono ${
                  isActive
                    ? 'scale-90 border-white/40'
                    : pad.slice
                      ? 'border-surface-border hover:border-white/30'
                      : 'border-surface-border border-dashed hover:border-slate-500'
                } ${pad.muted ? 'opacity-30' : ''}`}
              >
                {pad.slice ? (
                  <div className={`w-4 h-4 rounded-sm ${PAD_COLORS_SOLID[padIndex]} ${isActive ? 'opacity-100' : 'opacity-60'}`} />
                ) : (
                  <span className="text-slate-600">{PAD_KEYS[padIndex]}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
