import { Download, Trash2, X, Loader2, RefreshCw } from 'lucide-react'

interface SourcesBatchActionsProps {
  selectedCount: number
  selectedIds: Set<number>
  modifiedSelectedCount: number
  onBatchDelete: (ids: number[]) => void
  onBatchDownload: (ids: number[]) => void
  onAnalyzeSelected: (ids: number[]) => void
  onClearSelection: () => void
  isDeleting?: boolean
  isAnalyzing?: boolean
}

export function SourcesBatchActions({
  selectedCount,
  selectedIds,
  modifiedSelectedCount,
  onBatchDelete,
  onBatchDownload,
  onAnalyzeSelected,
  onClearSelection,
  isDeleting = false,
  isAnalyzing = false,
}: SourcesBatchActionsProps) {
  return (
    <div className="px-4 py-2 border-b border-accent-primary/30 bg-accent-primary/10 flex items-center gap-3 flex-shrink-0">
      {/* Selection count */}
      <span className="text-sm text-accent-primary font-medium">
        {selectedCount} selected
      </span>

      {/* Divider */}
      <div className="w-px h-5 bg-surface-border"></div>

      {/* Download button */}
      <button
        onClick={() => onBatchDownload(Array.from(selectedIds))}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-medium rounded transition-colors"
        title="Download selected samples"
      >
        <Download size={14} />
        Download
      </button>

      {/* Analyze selected modified button */}
      <button
        onClick={() => onAnalyzeSelected(Array.from(selectedIds))}
        disabled={isAnalyzing || selectedCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 disabled:bg-surface-base text-violet-300 disabled:text-slate-400 text-xs font-medium rounded transition-colors"
        title={
          modifiedSelectedCount > 0
            ? `Analyze ${selectedCount} selected sample${selectedCount === 1 ? '' : 's'} (${modifiedSelectedCount} modified)`
            : `Analyze ${selectedCount} selected sample${selectedCount === 1 ? '' : 's'}`
        }
      >
        {isAnalyzing ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
        Analyze selected
      </button>

      {/* Delete button */}
      <button
        onClick={() => onBatchDelete(Array.from(selectedIds))}
        disabled={isDeleting}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 disabled:bg-surface-base text-red-400 disabled:text-slate-400 text-xs font-medium rounded transition-colors"
        title="Delete selected samples"
      >
        {isDeleting ? (
          <Loader2 className="animate-spin" size={14} />
        ) : (
          <Trash2 size={14} />
        )}
        Delete
      </button>

      {/* Spacer */}
      <div className="flex-1"></div>

      {/* Clear selection button */}
      <button
        onClick={onClearSelection}
        className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-slate-300 text-xs font-medium transition-colors"
        title="Clear selection"
      >
        <X size={14} />
        Clear
      </button>
    </div>
  )
}
