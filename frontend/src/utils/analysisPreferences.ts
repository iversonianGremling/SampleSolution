export const ANALYSIS_CONCURRENCY_STORAGE_KEY = 'analysis-concurrency'
export const MAX_ANALYSIS_CONCURRENCY = 10
export const DEFAULT_ANALYSIS_CONCURRENCY = 2

export function clampAnalysisConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ANALYSIS_CONCURRENCY
  return Math.min(MAX_ANALYSIS_CONCURRENCY, Math.max(1, Math.round(value)))
}

export function getStoredAnalysisConcurrency(
  fallback = DEFAULT_ANALYSIS_CONCURRENCY,
): number {
  if (typeof window === 'undefined') {
    return clampAnalysisConcurrency(fallback)
  }

  const rawValue = window.localStorage.getItem(ANALYSIS_CONCURRENCY_STORAGE_KEY)
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : fallback
  return clampAnalysisConcurrency(parsedValue)
}

export function formatAnalysisJobLabel(options: {
  mode: 'library' | 'selection' | 'single' | 'import-files' | 'import-folder'
  count?: number
  sampleName?: string | null
}): string {
  switch (options.mode) {
    case 'library':
      return 'Re-analyze all samples'
    case 'single':
      return options.sampleName?.trim()
        ? `Analyze "${options.sampleName.trim()}"`
        : 'Analyze sample'
    case 'import-folder':
      return 'Analyze imported folder'
    case 'import-files':
      return 'Analyze imported files'
    case 'selection':
    default: {
      const count = typeof options.count === 'number' ? options.count : null
      if (count === 1) return 'Analyze selected sample'
      return 'Analyze selected samples'
    }
  }
}
