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
    <div className="px-3 py-1.5 border-b border-accent-primary/30 bg-accent-primary/10 flex items-center gap-2.5 flex-shrink-0">
      {/* Selection count */}
      <span className="text-xs text-accent-primary font-medium leading-none">
        {selectedCount} selected
      </span>

      {/* Divider */}
      <div className="w-px h-4 bg-surface-border"></div>

      {/* Download button */}
      <button
        onClick={() => onBatchDownload(Array.from(selectedIds))}
        className="flex items-center gap-1 px-2.5 py-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-medium rounded transition-colors leading-none"
        title="Download selected samples"
      >
        <Download size={12} />
        Download
      </button>

      {/* Analyze selected modified button */}
      <button
        onClick={() => onAnalyzeSelected(Array.from(selectedIds))}
        disabled={isAnalyzing || selectedCount === 0}
        className="flex items-center gap-1 px-2.5 py-1 bg-violet-500/20 hover:bg-violet-500/30 disabled:bg-surface-base text-violet-300 disabled:text-slate-400 text-xs font-medium rounded transition-colors leading-none"
        title={
          modifiedSelectedCount > 0
            ? `Analyze ${selectedCount} selected sample${selectedCount === 1 ? '' : 's'} (${modifiedSelectedCount} modified)`
            : `Analyze ${selectedCount} selected sample${selectedCount === 1 ? '' : 's'}`
        }
      >
        {isAnalyzing ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
        Analyze selected
      </button>

      {/* Delete button */}
      <button
        onClick={() => onBatchDelete(Array.from(selectedIds))}
        disabled={isDeleting}
        className="flex items-center gap-1 px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 disabled:bg-surface-base text-red-400 disabled:text-slate-400 text-xs font-medium rounded transition-colors leading-none"
        title="Delete selected samples"
      >
        {isDeleting ? (
          <Loader2 className="animate-spin" size={12} />
        ) : (
          <Trash2 size={12} />
        )}
        Delete
      </button>

      {/* Spacer */}
      <div className="flex-1"></div>

      {/* Clear selection button */}
      <button
        onClick={onClearSelection}
        className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-slate-300 text-xs font-medium transition-colors leading-none"
        title="Clear selection"
      >
        <X size={12} />
        Clear
      </button>
    </div>
  )
}
