import { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'
import * as api from '../api/client'
import { useQueryClient } from '@tanstack/react-query'
import { AnalysisLevelSelector } from './AnalysisLevelSelector'
import type { AnalysisLevel } from '../types'

const ANALYSIS_LEVEL_KEY = 'defaultAnalysisLevel'

export function SourcesSettings() {
  const [isReanalyzing, setIsReanalyzing] = useState(false)
  const [reanalyzeStatus, setReanalyzeStatus] = useState<{
    total: number
    analyzed: number
    failed: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysisLevel, setAnalysisLevel] = useState<AnalysisLevel>(() => {
    const saved = localStorage.getItem(ANALYSIS_LEVEL_KEY)
    return (saved as AnalysisLevel) || 'standard'
  })
  const queryClient = useQueryClient()

  // Save analysis level preference to localStorage
  useEffect(() => {
    localStorage.setItem(ANALYSIS_LEVEL_KEY, analysisLevel)
  }, [analysisLevel])

  const handleReanalyzeAll = async () => {
    if (isReanalyzing) return

    const confirmed = window.confirm(
      'This will re-analyze all samples in your library. This may take several minutes. Continue?'
    )

    if (!confirmed) return

    setIsReanalyzing(true)
    setError(null)
    setReanalyzeStatus(null)

    try {
      const result = await api.batchReanalyzeSamples(undefined, analysisLevel)
      setReanalyzeStatus({
        total: result.total,
        analyzed: result.analyzed,
        failed: result.failed,
      })

      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-analyze samples')
    } finally {
      setIsReanalyzing(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-semibold text-white mb-6">Settings</h2>

      {/* Analysis Settings */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-white mb-4">Audio Analysis</h3>

          <div className="bg-surface-raised border border-surface-border rounded-lg p-6 mb-6">
            <div className="mb-4">
              <h4 className="text-sm font-medium text-white mb-2">Default Analysis Level</h4>
              <p className="text-sm text-slate-400 mb-4">
                Choose the default analysis depth for imported samples. Higher levels extract more features but take longer.
              </p>
            </div>
            <AnalysisLevelSelector value={analysisLevel} onChange={setAnalysisLevel} />
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-white mb-4">Advanced</h3>

          <div className="bg-surface-raised border border-surface-border rounded-lg p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white mb-2">Re-analyze All Samples</h4>
                <p className="text-sm text-slate-400 mb-4">
                  Re-run audio analysis on all samples using the <strong className="text-white">{analysisLevel}</strong> level.
                  This will update features like BPM, key detection, and tags with the latest analysis algorithms.
                </p>

                {isReanalyzing && (
                  <div className="mb-4 p-4 bg-accent-primary/10 rounded-lg border border-accent-primary/30">
                    <div className="flex items-center gap-3 text-sm">
                      <RefreshCw size={20} className="text-accent-primary flex-shrink-0 animate-spin" />
                      <div>
                        <div className="text-white font-medium mb-1">Analyzing samples...</div>
                        <div className="text-slate-400 text-xs">
                          This may take a few minutes. Extracting BPM, key, and audio features for all samples.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!isReanalyzing && reanalyzeStatus && (
                  <div className="mb-4 p-3 bg-surface-base rounded-lg border border-surface-border">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                      <span className="text-white">
                        Re-analysis complete: {reanalyzeStatus.analyzed} analyzed, {reanalyzeStatus.failed} failed
                        (out of {reanalyzeStatus.total} total)
                      </span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mb-4 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                    <div className="flex items-center gap-2 text-sm">
                      <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-400">{error}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleReanalyzeAll}
                  disabled={isReanalyzing}
                  className={`
                    inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                    ${
                      isReanalyzing
                        ? 'bg-surface-base text-slate-400 cursor-not-allowed'
                        : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                    }
                  `}
                >
                  <RefreshCw size={16} className={isReanalyzing ? 'animate-spin' : ''} />
                  {isReanalyzing ? 'Re-analyzing...' : 'Re-analyze All Samples'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Future settings sections can go here */}
      </div>
    </div>
  )
}
