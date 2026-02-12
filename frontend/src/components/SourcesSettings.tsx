import { useState, useEffect, useRef } from 'react'
import { RefreshCw, AlertCircle, CheckCircle2, Copy, Link2, FolderOpen } from 'lucide-react'
import * as api from '../api/client'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { AnalysisLevelSelector } from './AnalysisLevelSelector'
import type { AnalysisLevel } from '../types'

const ANALYSIS_LEVEL_KEY = 'defaultAnalysisLevel'

interface DuplicateGroup {
  matchType: 'exact' | 'file'
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
    queryFn: api.getDuplicateSlices,
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
                      {group.matchType === 'exact' ? 'Exact fingerprint match' : 'File identity match'}
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

function LibraryTransferSection() {
  const [exportPath, setExportPath] = useState('')
  const [importPath, setImportPath] = useState('')
  const [pickerNotice, setPickerNotice] = useState<string | null>(null)
  const exportDirInputRef = useRef<HTMLInputElement>(null)
  const importDirInputRef = useRef<HTMLInputElement>(null)

  const exportMutation = useMutation({
    mutationFn: () => api.exportLibrary(exportPath.trim() || undefined),
  })

  const importMutation = useMutation({
    mutationFn: () => api.importLibrary(importPath.trim()),
  })

  const handleImportLibrary = async () => {
    if (!importPath.trim()) return
    const confirmed = window.confirm(
      'Importing a library will replace your current database, tracks, slices, tags, folders, and settings. A backup will be created automatically. Continue?'
    )
    if (!confirmed) return

    await importMutation.mutateAsync()

    // Reload app so all queries/state are consistent with replaced DB
    window.location.reload()
  }

  const openBrowse = async (target: 'export' | 'import') => {
    setPickerNotice(null)
    const initialPath = (target === 'export' ? exportPath : importPath).trim() || undefined

    // Prefer native local filesystem picker when available (Electron)
    if (window.electron?.selectDirectory) {
      try {
        const selected = await window.electron.selectDirectory({
          defaultPath: initialPath,
          title: target === 'export' ? 'Select export folder' : 'Select library folder to import',
        })

        if (selected) {
          if (target === 'export') setExportPath(selected)
          if (target === 'import') setImportPath(selected)
        }
        return
      } catch {
        // Continue with browser-native fallbacks below
      }
    }

    // Browser-native picker (File System Access API)
    try {
      const maybeShowDirectoryPicker = (window as any).showDirectoryPicker
      if (typeof maybeShowDirectoryPicker === 'function') {
        const handle = await maybeShowDirectoryPicker()
        if (handle?.name) {
          if (target === 'export') setExportPath(handle.name)
          if (target === 'import') setImportPath(handle.name)
          setPickerNotice('Browser returned folder name only. If needed, paste absolute path manually (or use Electron app).')
          return
        }
      }
    } catch {
      // User canceled or API unavailable
    }

    // Fallback via input[type=file][webkitdirectory]
    if (target === 'export') exportDirInputRef.current?.click()
    if (target === 'import') importDirInputRef.current?.click()
  }

  const handleWebDirectoryPicked = (target: 'export' | 'import', e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const first = files[0]
    const folderName = first.webkitRelativePath?.split('/')[0] || first.name
    if (target === 'export') setExportPath(folderName)
    if (target === 'import') setImportPath(folderName)
    setPickerNotice('Browser returned folder name only. If needed, paste absolute path manually (or use Electron app).')
  }

  return (
    <div>
      <h4 className="text-sm font-medium text-white mb-2">Library Transfer</h4>
      <p className="text-sm text-slate-400 mb-4">
        Move your full library between SampleSolution instances. This includes tracks, slices, tags, folders, collections, and metadata.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-white">Export Library</div>
          <input
            type="text"
            value={exportPath}
            onChange={(e) => setExportPath(e.target.value)}
            placeholder="Optional export path (default: data/library_exports/...)"
            className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
          />
          <button
            onClick={() => openBrowse('export')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
          >
            <FolderOpen size={14} />
            Browse
          </button>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
              exportMutation.isPending
                ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }`}
          >
            <Copy size={14} />
            {exportMutation.isPending ? 'Exporting...' : 'Export Library'}
          </button>

          {exportMutation.data && (
            <div className="text-xs text-green-400 break-all">
              Exported to: {exportMutation.data.exportPath}
            </div>
          )}
          {exportMutation.isError && (
            <div className="text-xs text-red-400">Failed to export library</div>
          )}
        </div>

        <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium text-white">Import Library</div>
          <input
            type="text"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="Path to exported library folder"
            className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
          />
          <button
            onClick={() => openBrowse('import')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
          >
            <FolderOpen size={14} />
            Browse
          </button>
          <button
            onClick={handleImportLibrary}
            disabled={importMutation.isPending || !importPath.trim()}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
              importMutation.isPending || !importPath.trim()
                ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }`}
          >
            <Link2 size={14} />
            {importMutation.isPending ? 'Importing...' : 'Import Library'}
          </button>

          <div className="text-xs text-amber-400">
            This replaces your current library.
          </div>

          {importMutation.data && (
            <div className="text-xs text-green-400 break-all">
              Imported. Backup saved at: {importMutation.data.backupPath}
            </div>
          )}
          {importMutation.isError && (
            <div className="text-xs text-red-400">Failed to import library</div>
          )}
        </div>
      </div>

      <input
        ref={exportDirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in TS lib but supported in Chromium
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => handleWebDirectoryPicked('export', e)}
      />
      <input
        ref={importDirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in TS lib but supported in Chromium
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => handleWebDirectoryPicked('import', e)}
      />

      {pickerNotice && (
        <div className="mt-3 text-xs text-amber-400">{pickerNotice}</div>
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

      if (result.warnings && result.warnings.totalWithWarnings > 0) {
        const preview = result.warnings.messages.slice(0, 5)
        const extra = Math.max(0, result.warnings.messages.length - preview.length)
        const details = preview.map((m) => `• ${m}`).join('\n')
        window.alert(
          [
            `Warning: ${result.warnings.totalWithWarnings} sample(s) had potential custom state before re-analysis.`,
            details,
            extra > 0 ? `...and ${extra} more warning(s).` : '',
          ]
            .filter(Boolean)
            .join('\n')
        )
      }

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

        {/* Library Transfer */}
        <div>
          <h3 className="text-lg font-medium text-white mb-4">Library</h3>
          <div className="bg-surface-raised border border-surface-border rounded-lg p-6">
            <LibraryTransferSection />
          </div>
        </div>
      </div>
    </div>
  )
}
