import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw, Wand2, X } from 'lucide-react'
import * as api from '../api/client'
import { useAllSlices } from '../hooks/useTracks'
import type { SliceWithTrack } from '../types'
import {
  applyBulkRenameRules,
  DEFAULT_BULK_RENAME_RULES,
  type BulkRenameRules,
  type NameCaseMode,
  type NumberingPosition,
} from '../utils/bulkRename'

type SourceFilter = 'all' | 'local' | 'youtube'

interface RenamePreviewRow {
  id: number
  currentName: string
  nextName: string
  trackTitle: string
}

interface ApplySummary {
  attempted: number
  updated: number
  failed: number
  errors: string[]
}

const PREVIEW_LIMIT = 30
const UPDATE_CONCURRENCY = 6

const inputClassName = 'w-full rounded border border-surface-border bg-surface-base px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary'

const CASE_MODE_OPTIONS: Array<{ value: NameCaseMode; label: string }> = [
  { value: 'none', label: 'No conversion' },
  { value: 'lower', label: 'lowercase' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'title', label: 'Title Case' },
  { value: 'snake', label: 'snake_case' },
  { value: 'kebab', label: 'kebab-case' },
]

const SOURCE_FILTER_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'local', label: 'Local imports only' },
  { value: 'youtube', label: 'YouTube imports only' },
]

const NUMBERING_POSITION_OPTIONS: Array<{ value: NumberingPosition; label: string }> = [
  { value: 'suffix', label: 'Suffix' },
  { value: 'prefix', label: 'Prefix' },
]

function inferSource(slice: SliceWithTrack): Exclude<SourceFilter, 'all'> {
  return slice.track.youtubeId.startsWith('local:') ? 'local' : 'youtube'
}

function createDefaultRules(): BulkRenameRules {
  return { ...DEFAULT_BULK_RENAME_RULES }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unknown error'
}

export function BulkRenameConverterLauncher() {
  const [isOpen, setIsOpen] = useState(false)
  const [rules, setRules] = useState<BulkRenameRules>(createDefaultRules)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [isApplying, setIsApplying] = useState(false)
  const [summary, setSummary] = useState<ApplySummary | null>(null)

  const queryClient = useQueryClient()
  const { data: allSlices = [], isLoading, error } = useAllSlices()

  const filteredSlices = useMemo(() => {
    const normalizedFilter = rules.filterText.trim().toLowerCase()
    const sorted = [...allSlices].sort((a, b) => {
      const byName = a.name.localeCompare(b.name)
      if (byName !== 0) return byName
      return a.id - b.id
    })

    return sorted.filter((slice) => {
      if (sourceFilter !== 'all' && inferSource(slice) !== sourceFilter) {
        return false
      }

      if (!normalizedFilter) {
        return true
      }

      return (
        slice.name.toLowerCase().includes(normalizedFilter) ||
        slice.track.title.toLowerCase().includes(normalizedFilter)
      )
    })
  }, [allSlices, rules.filterText, sourceFilter])

  const renamePreview = useMemo<RenamePreviewRow[]>(() => {
    return filteredSlices
      .map((slice, index) => ({
        id: slice.id,
        trackTitle: slice.track.title,
        currentName: slice.name,
        nextName: applyBulkRenameRules(slice.name, rules, index),
      }))
      .filter((row) => row.currentName !== row.nextName)
  }, [filteredSlices, rules])

  const visiblePreviewRows = renamePreview.slice(0, PREVIEW_LIMIT)
  const remainingPreviewCount = Math.max(0, renamePreview.length - visiblePreviewRows.length)
  const canApply = renamePreview.length > 0 && !isLoading && !isApplying
  const loadErrorMessage = error ? getErrorMessage(error) : null

  const updateRule = <K extends keyof BulkRenameRules>(key: K, value: BulkRenameRules[K]) => {
    setRules((prev) => ({ ...prev, [key]: value }))
  }

  const resetRules = () => {
    setRules(createDefaultRules())
    setSourceFilter('all')
    setSummary(null)
  }

  const closeModal = () => {
    if (isApplying) return
    setIsOpen(false)
  }

  const applyRenames = async () => {
    if (!canApply) return

    const confirmed = window.confirm(
      `Apply rename/conversion rules to ${renamePreview.length} sample${renamePreview.length === 1 ? '' : 's'}?`
    )
    if (!confirmed) return

    setSummary(null)
    setIsApplying(true)

    const failures: string[] = []
    let completed = 0
    let cursor = 0
    const workers = Math.min(UPDATE_CONCURRENCY, renamePreview.length)

    const runWorker = async () => {
      while (cursor < renamePreview.length) {
        const currentIndex = cursor
        cursor += 1

        const row = renamePreview[currentIndex]
        if (!row) continue

        try {
          await api.updateSlice(row.id, { name: row.nextName })
          completed += 1
        } catch (err) {
          failures.push(`#${row.id}: ${getErrorMessage(err)}`)
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: workers }, () => runWorker()))

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['allSlices'] }),
        queryClient.invalidateQueries({ queryKey: ['slices'] }),
        queryClient.invalidateQueries({ queryKey: ['scopedSamples'] }),
      ])

      setSummary({
        attempted: renamePreview.length,
        updated: completed,
        failed: failures.length,
        errors: failures.slice(0, 5),
      })
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-base px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-surface-overlay"
        title="Bulk rename and convert sample names"
      >
        <Wand2 size={14} />
        <span className="hidden sm:inline">Bulk Rename/Convert</span>
        <span className="sm:hidden">Bulk Tool</span>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-surface-base/70 p-4 overflow-y-auto"
          onClick={closeModal}
        >
          <div
            className="mx-auto mt-6 mb-10 w-full max-w-6xl rounded-xl border border-surface-border bg-surface-raised shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Bulk Renamer/Converter</h3>
                <p className="text-xs text-slate-400">
                  Updates sample names in library metadata. Original filesystem files are unchanged.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-surface-border bg-surface-base p-2 text-slate-300 transition-colors hover:bg-surface-overlay hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isApplying}
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {loadErrorMessage && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  Failed to load samples: {loadErrorMessage}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Filter Samples</label>
                  <input
                    type="text"
                    value={rules.filterText}
                    onChange={(e) => updateRule('filterText', e.target.value)}
                    placeholder="Filter by sample or track name"
                    className={inputClassName}
                  />
                  <div className="text-[11px] text-slate-500">
                    {filteredSlices.length} match{filteredSlices.length === 1 ? '' : 'es'} in current scope.
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Source Scope</label>
                  <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
                    className={inputClassName}
                  >
                    {SOURCE_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Name Case Conversion</label>
                  <select
                    value={rules.caseMode}
                    onChange={(e) => updateRule('caseMode', e.target.value as NameCaseMode)}
                    className={inputClassName}
                  >
                    {CASE_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Find Text</label>
                  <input
                    type="text"
                    value={rules.searchText}
                    onChange={(e) => updateRule('searchText', e.target.value)}
                    placeholder="Text to replace"
                    className={inputClassName}
                  />
                  <label className="inline-flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={rules.caseSensitive}
                      onChange={(e) => updateRule('caseSensitive', e.target.checked)}
                      className="accent-accent-primary"
                    />
                    Case-sensitive match
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Replace With</label>
                  <input
                    type="text"
                    value={rules.replaceText}
                    onChange={(e) => updateRule('replaceText', e.target.value)}
                    placeholder="Replacement text"
                    className={inputClassName}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Prefix</label>
                  <input
                    type="text"
                    value={rules.prefix}
                    onChange={(e) => updateRule('prefix', e.target.value)}
                    placeholder="Optional prefix"
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Suffix</label>
                  <input
                    type="text"
                    value={rules.suffix}
                    onChange={(e) => updateRule('suffix', e.target.value)}
                    placeholder="Optional suffix"
                    className={inputClassName}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-surface-border bg-surface-base/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={rules.numberingEnabled}
                      onChange={(e) => updateRule('numberingEnabled', e.target.checked)}
                      className="accent-accent-primary"
                    />
                    Add numbering
                  </label>

                  <input
                    type="number"
                    min={1}
                    value={rules.numberingStart}
                    onChange={(e) => updateRule('numberingStart', Number.parseInt(e.target.value, 10) || 1)}
                    disabled={!rules.numberingEnabled}
                    className="w-24 rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
                    title="Start number"
                  />

                  <input
                    type="number"
                    min={1}
                    value={rules.numberingPad}
                    onChange={(e) => updateRule('numberingPad', Number.parseInt(e.target.value, 10) || 1)}
                    disabled={!rules.numberingEnabled}
                    className="w-20 rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
                    title="Padding width"
                  />

                  <input
                    type="text"
                    value={rules.numberingSeparator}
                    onChange={(e) => updateRule('numberingSeparator', e.target.value)}
                    disabled={!rules.numberingEnabled}
                    className="w-24 rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
                    title="Separator"
                  />

                  <select
                    value={rules.numberingPosition}
                    onChange={(e) => updateRule('numberingPosition', e.target.value as NumberingPosition)}
                    disabled={!rules.numberingEnabled}
                    className="rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {NUMBERING_POSITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-surface-border">
                <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
                  <div className="text-sm font-medium text-white">Preview</div>
                  <div className="text-xs text-slate-500">
                    {renamePreview.length} sample{renamePreview.length === 1 ? '' : 's'} will be updated
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-400">
                    <RefreshCw size={14} className="animate-spin" />
                    Loading samples...
                  </div>
                ) : renamePreview.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-slate-500">
                    No name changes to apply with the current rules.
                  </div>
                ) : (
                  <div className="max-h-72 overflow-auto">
                    {visiblePreviewRows.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 border-b border-surface-border/70 px-3 py-2 text-xs"
                      >
                        <div className="text-slate-500">#{row.id}</div>
                        <div>
                          <div className="truncate text-slate-300">{row.currentName}</div>
                          <div className="truncate text-[10px] text-slate-500">{row.trackTitle}</div>
                        </div>
                        <div className="truncate text-accent-primary">{row.nextName}</div>
                      </div>
                    ))}

                    {remainingPreviewCount > 0 && (
                      <div className="px-3 py-2 text-[11px] text-slate-500">
                        + {remainingPreviewCount} more changes not shown in preview
                      </div>
                    )}
                  </div>
                )}
              </div>

              {summary && (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    summary.failed === 0
                      ? 'border-green-500/40 bg-green-500/10 text-green-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {summary.failed === 0 ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>
                      Updated {summary.updated}/{summary.attempted}
                      {summary.failed > 0 ? `, failed ${summary.failed}` : ''}
                    </span>
                  </div>
                  {summary.errors.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs text-amber-200">
                      {summary.errors.map((entry) => (
                        <div key={entry}>{entry}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={resetRules}
                  disabled={isApplying}
                  className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-base px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  Reset Rules
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isApplying}
                    className="rounded-md border border-surface-border bg-surface-base px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void applyRenames()
                    }}
                    disabled={!canApply}
                    className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      canApply
                        ? 'bg-accent-primary text-white hover:bg-accent-primary/90'
                        : 'cursor-not-allowed bg-surface-overlay text-slate-500'
                    }`}
                  >
                    {isApplying ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <Wand2 size={14} />
                        Apply to {renamePreview.length}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
