import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useTracks } from '../hooks/useTracks'
import { WaveformEditor } from './WaveformEditor'

interface EditingModalProps {
  trackId: number
  onClose: () => void
}

export function EditingModal({ trackId, onClose }: EditingModalProps) {
  const { data: tracks = [], isLoading } = useTracks()
  const track = useMemo(() => tracks.find(t => t.id === trackId), [tracks, trackId])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Modal content - centered dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-surface-base rounded-lg overflow-hidden flex flex-col w-[90vw] h-[90vh] max-w-6xl pointer-events-auto shadow-2xl">
          {/* Header with close button */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border flex-shrink-0">
            <h2 className="text-lg font-semibold text-white">
              {isLoading ? 'Loading...' : 'Edit Source'}
            </h2>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content area */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <p>Loading track data...</p>
            </div>
          ) : track ? (
            <div className="flex-1 overflow-hidden">
              <WaveformEditor track={track} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <p>Track not found</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
