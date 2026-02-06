import { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, CheckCircle2, Copy, Link2, Trash2, ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react'
import * as api from '../api/client'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { AnalysisLevelSelector } from './AnalysisLevelSelector'
import type { AnalysisLevel, SyncConfig } from '../types'

const ANALYSIS_LEVEL_KEY = 'defaultAnalysisLevel'

interface DuplicateGroup {
  matchType: 'exact' | 'near'
  hashSimilarity: number
  samples: Array<{
    id: number
    name: string
    trackTitle: string
  }>
}

function FindDuplicatesSection() {
  const { data: duplicates, isLoading, refetch } = useQuery<{
    groups: DuplicateGroup[]
    total: number
  }>({
    queryKey: ['duplicates'],
    queryFn: async () => {
      const res = await fetch('/api/slices/duplicates')
      if (!res.ok) throw new Error('Failed to fetch duplicates')
      return res.json()
    },
    enabled: false, // Don't auto-fetch
  })

  const handleFindDuplicates = () => {
    refetch()
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <h4 className="text-sm font-medium text-white mb-2">Find Duplicate Samples</h4>
        <p className="text-sm text-slate-400 mb-4">
          Scan your library for duplicate or very similar audio files based on perceptual fingerprinting.
          This can help you clean up your sample library.
        </p>

        {isLoading && (
          <div className="mb-4 p-4 bg-accent-primary/10 rounded-lg border border-accent-primary/30">
            <div className="flex items-center gap-3 text-sm">
              <RefreshCw size={20} className="text-accent-primary flex-shrink-0 animate-spin" />
              <div>
                <div className="text-white font-medium">Scanning for duplicates...</div>
                <div className="text-slate-400 text-xs">Analyzing audio fingerprints</div>
              </div>
            </div>
          </div>
        )}

        {!isLoading && duplicates && duplicates.total > 0 && (
          <div className="mb-4 space-y-2">
            <div className="p-3 bg-surface-base rounded-lg border border-surface-border">
              <div className="flex items-center gap-2 text-sm mb-3">
                <Copy size={16} className="text-amber-400 flex-shrink-0" />
                <span className="text-white font-medium">
                  Found {duplicates.total} duplicate group{duplicates.total !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {duplicates.groups.map((group, idx) => (
                  <div key={idx} className="p-2 bg-surface-raised rounded border border-surface-border">
                    <div className="text-xs text-slate-400 mb-1">
                      {group.matchType === 'exact' ? 'Exact match' : 'Similar'}
                      {' '}({Math.round(group.hashSimilarity * 100)}%)
                    </div>
                    <div className="space-y-1">
                      {group.samples.map((sample) => (
                        <div key={sample.id} className="text-xs text-slate-300 truncate">
                          • {sample.name}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!isLoading && duplicates && duplicates.total === 0 && (
          <div className="mb-4 p-3 bg-surface-base rounded-lg border border-surface-border">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
              <span className="text-white">No duplicates found in your library</span>
            </div>
          </div>
        )}

        <button
          onClick={handleFindDuplicates}
          disabled={isLoading}
          className={`
            inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${
              isLoading
                ? 'bg-surface-base text-slate-400 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }
          `}
        >
          <Copy size={16} />
          {isLoading ? 'Scanning...' : 'Find Duplicates'}
        </button>
      </div>
    </div>
  )
}

function TagCollectionSyncSection() {
  const queryClient = useQueryClient()

  const { data: syncConfigs = [], isLoading: loadingConfigs } = useQuery<SyncConfig[]>({
    queryKey: ['syncConfigs'],
    queryFn: api.getSyncConfigs,
  })

  const { data: tags = [] } = useQuery<Array<{ id: number; name: string; color: string }>>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await fetch('/api/tags')
      if (!res.ok) throw new Error('Failed to fetch tags')
      return res.json()
    },
  })

  const { data: collections = [] } = useQuery<Array<{ id: number; name: string; color: string }>>({
    queryKey: ['collections'],
    queryFn: async () => {
      const res = await fetch('/api/collections')
      if (!res.ok) throw new Error('Failed to fetch collections')
      return res.json()
    },
  })

  const [newTagId, setNewTagId] = useState<number | ''>('')
  const [newCollectionId, setNewCollectionId] = useState<number | ''>('')
  const [newDirection, setNewDirection] = useState<'tag-to-collection' | 'collection-to-tag' | 'bidirectional'>('bidirectional')

  const createMutation = useMutation({
    mutationFn: () => api.createSyncConfig({
      tagId: newTagId as number,
      collectionId: newCollectionId as number,
      direction: newDirection,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncConfigs'] })
      setNewTagId('')
      setNewCollectionId('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteSyncConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncConfigs'] })
    },
  })

  const directionIcon = (dir: string) => {
    switch (dir) {
      case 'tag-to-collection': return <ArrowRight size={14} />
      case 'collection-to-tag': return <ArrowLeft size={14} />
      case 'bidirectional': return <ArrowLeftRight size={14} />
      default: return null
    }
  }

  const directionLabel = (dir: string) => {
    switch (dir) {
      case 'tag-to-collection': return 'Tag → Collection'
      case 'collection-to-tag': return 'Collection → Tag'
      case 'bidirectional': return 'Bidirectional'
      default: return dir
    }
  }

  const getTagName = (id: number) => tags.find(t => t.id === id)?.name || `Tag #${id}`
  const getTagColor = (id: number) => tags.find(t => t.id === id)?.color || '#888'
  const getCollectionName = (id: number) => collections.find(c => c.id === id)?.name || `Collection #${id}`
  const getCollectionColor = (id: number) => collections.find(c => c.id === id)?.color || '#888'

  return (
    <div>
      <h4 className="text-sm font-medium text-white mb-2">Tag-Collection Sync</h4>
      <p className="text-sm text-slate-400 mb-4">
        Automatically sync tags and collections. When a tag is added to a sample, it can be auto-added to a linked collection (and vice versa).
      </p>

      {/* Existing sync links */}
      {loadingConfigs ? (
        <div className="text-sm text-slate-400 mb-4">Loading...</div>
      ) : syncConfigs.length > 0 ? (
        <div className="space-y-2 mb-4">
          {syncConfigs.map((config) => (
            <div
              key={config.id}
              className="flex items-center gap-3 p-2 bg-surface-base rounded-lg border border-surface-border"
            >
              <span
                className="px-2 py-0.5 text-xs rounded-full"
                style={{ backgroundColor: getTagColor(config.tagId) + '25', color: getTagColor(config.tagId) }}
              >
                {getTagName(config.tagId)}
              </span>
              <span className="text-slate-400 flex items-center gap-1 text-xs">
                {directionIcon(config.syncDirection)}
                {directionLabel(config.syncDirection)}
              </span>
              <span
                className="px-2 py-0.5 text-xs rounded-full"
                style={{ backgroundColor: getCollectionColor(config.collectionId) + '25', color: getCollectionColor(config.collectionId) }}
              >
                {getCollectionName(config.collectionId)}
              </span>
              <button
                onClick={() => deleteMutation.mutate(config.id)}
                className="ml-auto p-1 text-slate-400 hover:text-red-400 transition-colors"
                title="Remove sync link"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500 mb-4">No sync links configured.</div>
      )}

      {/* Create new sync link */}
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Tag</label>
          <select
            value={newTagId}
            onChange={(e) => setNewTagId(e.target.value ? parseInt(e.target.value) : '')}
            className="bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs text-white min-w-[120px]"
          >
            <option value="">Select tag...</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Direction</label>
          <select
            value={newDirection}
            onChange={(e) => setNewDirection(e.target.value as typeof newDirection)}
            className="bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs text-white"
          >
            <option value="bidirectional">Bidirectional</option>
            <option value="tag-to-collection">Tag → Collection</option>
            <option value="collection-to-tag">Collection → Tag</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Collection</label>
          <select
            value={newCollectionId}
            onChange={(e) => setNewCollectionId(e.target.value ? parseInt(e.target.value) : '')}
            className="bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs text-white min-w-[120px]"
          >
            <option value="">Select collection...</option>
            {collections.map((col) => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => createMutation.mutate()}
          disabled={!newTagId || !newCollectionId || createMutation.isPending}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            !newTagId || !newCollectionId || createMutation.isPending
              ? 'bg-surface-base text-slate-500 cursor-not-allowed'
              : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
          }`}
        >
          <Link2 size={14} />
          Create Link
        </button>
      </div>

      {createMutation.isError && (
        <div className="mt-2 text-xs text-red-400">Failed to create sync link</div>
      )}
    </div>
  )
}

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
  const [concurrency, setConcurrency] = useState(() => {
    const saved = localStorage.getItem('analysis-concurrency')
    return saved ? parseInt(saved) : 5
  })
  const [includeFilenameTags, setIncludeFilenameTags] = useState(() => {
    return localStorage.getItem('analysis-filename-tags') === 'true'
  })
  const queryClient = useQueryClient()

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem(ANALYSIS_LEVEL_KEY, analysisLevel)
  }, [analysisLevel])
  useEffect(() => {
    localStorage.setItem('analysis-concurrency', String(concurrency))
  }, [concurrency])
  useEffect(() => {
    localStorage.setItem('analysis-filename-tags', String(includeFilenameTags))
  }, [includeFilenameTags])

  const handleReanalyzeAll = async () => {
    if (isReanalyzing) return

    const confirmed = window.confirm(
      `This will re-analyze all samples in your library with ${concurrency} concurrent processes. This may take several minutes. Continue?`
    )

    if (!confirmed) return

    setIsReanalyzing(true)
    setError(null)
    setReanalyzeStatus(null)

    try {
      const result = await api.batchReanalyzeSamples(undefined, analysisLevel, concurrency, includeFilenameTags)
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

          {/* Find Duplicates */}
          <div className="bg-surface-raised border border-surface-border rounded-lg p-6 mb-4">
            <FindDuplicatesSection />
          </div>

          {/* Re-analyze All */}
          <div className="bg-surface-raised border border-surface-border rounded-lg p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white mb-2">Re-analyze All Samples</h4>
                <p className="text-sm text-slate-400 mb-3">
                  Re-run audio analysis on all samples using the <strong className="text-white">{analysisLevel}</strong> level.
                  This will update features like BPM, key detection, and tags with the latest analysis algorithms.
                </p>

                {/* Concurrency slider */}
                <div className="mb-3">
                  <label className="text-xs font-medium text-slate-400 block mb-1.5">
                    Concurrency — {concurrency} parallel processes
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={50}
                    step={1}
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value))}
                    className="w-full h-1 accent-accent-primary"
                    disabled={isReanalyzing}
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>1</span>
                    <span>10</span>
                    <span>20</span>
                    <span>30</span>
                    <span>50</span>
                  </div>
                </div>

                {/* Filename tags checkbox */}
                <label className="flex items-center gap-2 mb-4 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeFilenameTags}
                    onChange={(e) => setIncludeFilenameTags(e.target.checked)}
                    disabled={isReanalyzing}
                    className="accent-accent-primary"
                  />
                  <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                    Extract tags from filenames
                  </span>
                  <span className="text-[10px] text-slate-500">(kick, snare, 808, etc.)</span>
                </label>

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

        {/* Tag-Collection Sync */}
        <div>
          <h3 className="text-lg font-medium text-white mb-4">Sync</h3>
          <div className="bg-surface-raised border border-surface-border rounded-lg p-6">
            <TagCollectionSyncSection />
          </div>
        </div>
      </div>
    </div>
  )
}
