import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import type { BatchReanalyzeJobState, BatchReanalyzeStage } from '../api/client'

type AnalysisProgressPanelVariant = 'banner' | 'card'

interface AnalysisProgressPanelProps {
  jobLabel: string
  status: BatchReanalyzeJobState
  stage: BatchReanalyzeStage
  isActive: boolean
  isStopping: boolean
  total: number | null
  processed: number
  analyzed: number
  failed: number
  progressPercent: number
  parallelism: number | null
  elapsedMs: number
  etaLabel: string | null
  statusNote: string | null
  error: string | null
  onStop?: () => void
  onClose?: () => void
  variant?: AnalysisProgressPanelVariant
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  return `${seconds}s`
}

function getStageLabel(stage: BatchReanalyzeStage, isStopping: boolean): string {
  if (isStopping) {
    return 'Stopping running workers and waiting for the current file to finish cleanly.'
  }

  if (stage === 'audit') {
    return 'Reviewing suspicious tags and applying the final AI correction pass.'
  }

  return 'Extracting features, refreshing tags, and writing the updated analysis back to the library.'
}

export function AnalysisProgressPanel({
  jobLabel,
  status,
  stage,
  isActive,
  isStopping,
  total,
  processed,
  analyzed,
  failed,
  progressPercent,
  parallelism,
  elapsedMs,
  etaLabel,
  statusNote,
  error,
  onStop,
  onClose,
  variant = 'card',
}: AnalysisProgressPanelProps) {
  const normalizedProgressPercent = Math.max(0, Math.min(100, progressPercent))
  const isCompleted = status === 'completed'
  const isCanceled = status === 'canceled'
  const isFailed = status === 'failed'
  const containerClassName = variant === 'banner'
    ? 'border-y border-accent-primary/20 bg-surface-raised/95 px-3 py-3 sm:px-4'
    : 'rounded-lg border border-accent-primary/30 bg-surface-raised p-3'
  const progressBarClassName = isStopping
    ? 'bg-amber-400'
    : isFailed
      ? 'bg-red-400'
      : isCompleted
        ? 'bg-green-400'
        : 'bg-accent-primary'
  const headerIconClassName = isCompleted
    ? 'text-green-400'
    : isCanceled
      ? 'text-amber-400'
      : isFailed
        ? 'text-red-400'
        : 'text-accent-primary'
  const headerStatusClassName = isCompleted
    ? 'text-green-300'
    : isCanceled
      ? 'text-amber-300'
      : isFailed
        ? 'text-red-300'
        : isStopping
          ? 'text-amber-300'
          : 'text-slate-200'
  const summaryParts = [
    `Processed ${processed}/${total ?? '...'}`,
    `analyzed ${analyzed}`,
    `failed ${failed}`,
    parallelism ? `${parallelism} workers` : '',
    formatElapsedTime(elapsedMs),
    etaLabel ? `ETA ${etaLabel}` : '',
  ].filter(Boolean)
  const displayStatusNote = error || statusNote || null
  const activityLabel = isCompleted
    ? 'Analysis complete.'
    : isCanceled
      ? 'Analysis stopped.'
      : isFailed
        ? 'Analysis failed.'
        : getStageLabel(stage, isStopping)

  return (
    <div className={containerClassName}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-2.5">
            {isCompleted ? (
              <CheckCircle2 size={18} className={`mt-0.5 flex-shrink-0 ${headerIconClassName}`} />
            ) : isFailed || isCanceled ? (
              <AlertCircle size={18} className={`mt-0.5 flex-shrink-0 ${headerIconClassName}`} />
            ) : (
              <RefreshCw size={18} className={`mt-0.5 flex-shrink-0 ${headerIconClassName} ${isActive ? 'animate-spin' : ''}`} />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">{jobLabel}</div>
              <div className={`mt-0.5 text-xs ${headerStatusClassName}`}>{activityLabel}</div>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-slate-300">
            {summaryParts.join(' • ')}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-300">
            <span className="truncate">{displayStatusNote || 'Analysis is running in the background. You can keep working.'}</span>
            <span className="flex-shrink-0 font-mono text-slate-100">{normalizedProgressPercent}%</span>
          </div>

          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-base/80">
            <div
              className={`h-full transition-[width] duration-300 ${progressBarClassName}`}
              style={{ width: `${normalizedProgressPercent}%` }}
            />
          </div>
        </div>

        {(isActive && onStop || onClose) && (
          <div className="flex flex-shrink-0 items-center gap-2">
            {isActive && onStop && (
              <button
                type="button"
                onClick={onStop}
                disabled={isStopping}
                className={`
                  inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors
                  ${
                    isStopping
                      ? 'cursor-not-allowed bg-surface-base text-slate-400'
                      : 'border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                  }
                `}
              >
                {isStopping ? 'Stopping...' : 'Stop'}
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-base px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-surface-overlay hover:text-slate-100"
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
