import { useMemo, useState, useEffect } from 'react'
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
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)

  // Entrance animation
  useEffect(() => {
    setIsEntering(true)
    // Trigger animation after a brief delay to ensure initial render
    const timer = setTimeout(() => {
      setIsEntering(false)
    }, 10)
    return () => clearTimeout(timer)
  }, [])

  const handleClose = () => {
    setIsClosing(true)
    // Wait for animation to complete before actually closing
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 300) // Match animation duration
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${
          isClosing || isEntering ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />

      {/* Modal content - centered dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className={`bg-surface-raised rounded-xl overflow-hidden flex flex-col w-[90vw] h-[90vh] max-w-6xl pointer-events-auto shadow-2xl border border-surface-border transition-all duration-300 ease-out ${
          isClosing || isEntering ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}>
          {/* Header with sample name and close button */}
          <div className="flex items-center gap-3 px-4 py-4 border-b border-surface-border flex-shrink-0 bg-surface-raised">
            {isLoading ? (
              <h2 className="flex-1 text-lg font-semibold text-white">Loading...</h2>
            ) : track ? (
              <>
                <h2 className="flex-1 text-lg font-semibold text-white truncate">{track.title}</h2>
                <button
                  onClick={handleClose}
                  className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors hover:bg-surface-base"
                >
                  <X size={18} />
                </button>
              </>
            ) : (
              <h2 className="flex-1 text-lg font-semibold text-white">Track not found</h2>
            )}
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
