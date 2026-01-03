import { Play, Download, Trash2, Sparkles, Loader2 } from 'lucide-react'
import { getSliceDownloadUrl } from '../api/client'
import { useGenerateAiTagsForSlice } from '../hooks/useTracks'
import type { Slice } from '../types'

interface SliceListProps {
  slices: Slice[]
  trackId: number
  onPlay: (slice: Slice) => void
  onDelete: (slice: Slice) => void
  formatTime: (seconds: number) => string
}

export function SliceList({ slices, trackId, onPlay, onDelete, formatTime }: SliceListProps) {
  const generateAiTags = useGenerateAiTagsForSlice(trackId)

  const handleGenerateTags = (e: React.MouseEvent, sliceId: number) => {
    e.stopPropagation()
    generateAiTags.mutate(sliceId)
  }

  if (slices.length === 0) {
    return (
      <div className="px-4 pb-4">
        <div className="text-center text-gray-500 py-4">
          No slices yet. Drag on the waveform to create one.
        </div>
      </div>
    )
  }

  const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6']

  return (
    <div className="border-t border-gray-700">
      <div className="px-4 py-2 bg-gray-700/30">
        <h3 className="text-sm font-medium text-gray-400">
          Slices ({slices.length})
        </h3>
      </div>
      <div className="divide-y divide-gray-700">
        {slices.map((slice, index) => (
          <div
            key={slice.id}
            className="flex items-center gap-3 px-4 py-2 hover:bg-gray-700/30 transition-colors"
          >
            {/* Color indicator */}
            <div
              className="w-2 h-8 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white truncate">{slice.name}</div>
              <div className="text-sm text-gray-400">
                {formatTime(slice.startTime)} - {formatTime(slice.endTime)}
                <span className="ml-2 text-gray-500">
                  ({formatTime(slice.endTime - slice.startTime)})
                </span>
              </div>
            </div>

            {/* Tags */}
            {slice.tags.length > 0 && (
              <div className="flex gap-1">
                {slice.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-1.5 py-0.5 text-xs rounded"
                    style={{ backgroundColor: tag.color + '40', color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPlay(slice)}
                className="p-2 text-gray-400 hover:text-green-400 transition-colors"
                title="Play slice"
              >
                <Play size={16} />
              </button>
              <button
                onClick={(e) => handleGenerateTags(e, slice.id)}
                disabled={generateAiTags.isPending}
                className="p-2 text-gray-400 hover:text-yellow-400 transition-colors"
                title="Generate AI tags"
              >
                {generateAiTags.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
              </button>
              {slice.filePath && (
                <a
                  href={getSliceDownloadUrl(slice.id)}
                  download
                  className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
                  title="Download slice"
                >
                  <Download size={16} />
                </a>
              )}
              <button
                onClick={() => onDelete(slice)}
                className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                title="Delete slice"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
