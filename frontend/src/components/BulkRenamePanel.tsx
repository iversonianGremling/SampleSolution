import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw, Wand2 } from 'lucide-react'
import * as api from '../api/client'
import type { BatchConvertTargetFormat } from '../api/client'
import type { SliceWithTrackExtended } from '../types'
import {
  applyBulkRenameRules,
  DEFAULT_BULK_RENAME_RULES,
  type BulkRenameRules,
  type ConversionTargetFormat,
  type NameCaseMode,
} from '../utils/bulkRename'

interface BulkRenamePanelProps {
  samples: SliceWithTrackExtended[]
  isSamplesLoading: boolean
  rules: BulkRenameRules
  onRulesChange: Dispatch<SetStateAction<BulkRenameRules>>
}

interface RenamePreviewRow {
  id: number
  currentName: string
  nextName: string
}

interface ConversionPreviewRow {
  id: number
  currentFormat: ConversionTargetFormat | null
}

interface ApplySummary {
  renameAttempted: number
  renameUpdated: number
  renameFailed: number
  conversionAttempted: number
  conversionConverted: number
  conversionSkipped: number
  conversionFailed: number
  errors: string[]
}

const UPDATE_CONCURRENCY = 6

const inputClassName = 'w-full rounded border border-surface-border bg-surface-base px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary'
const smallSelectClassName = 'w-full max-w-[220px] rounded border border-surface-border bg-surface-base px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-primary'

const CASE_MODE_OPTIONS: Array<{ value: NameCaseMode; label: string }> = [
  { value: 'none', label: 'No conversion' },
  { value: 'lower', label: 'lowercase' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'title', label: 'Title Case' },
  { value: 'snake', label: 'snake_case' },
  { value: 'kebab', label: 'kebab-case' },
]

const CONVERSION_FORMAT_OPTIONS: Array<{ value: ConversionTargetFormat; label: string }> = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
  { value: 'aiff', label: 'AIFF' },
  { value: 'ogg', label: 'OGG Vorbis' },
  { value: 'm4a', label: 'M4A (AAC)' },
]

const FORMAT_ALIASES: Record<string, ConversionTargetFormat> = {
  aif: 'aiff',
  aiff: 'aiff',
  flac: 'flac',
  m4a: 'm4a',
  mp3: 'mp3',
  mp4: 'm4a',
  mpga: 'mp3',
  mpeg: 'mp3',
  ogg: 'ogg',
  wav: 'wav',
}

function createDefaultRules(): BulkRenameRules {
  return { ...DEFAULT_BULK_RENAME_RULES, filterText: '' }
}

function normalizeFormat(value: string | null | undefined): ConversionTargetFormat | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/^\./, '')
  return FORMAT_ALIASES[normalized] ?? null
}

function inferSliceFormat(slice: SliceWithTrackExtended): ConversionTargetFormat | null {
  const fromMetadata = normalizeFormat(slice.format)
  if (fromMetadata) return fromMetadata

  if (slice.filePath) {
    const extension = slice.filePath.split('.').pop()
    return normalizeFormat(extension)
  }

  return null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unknown error'
}

export function BulkRenamePanel({
  samples,
  isSamplesLoading,
  rules,
  onRulesChange,
}: BulkRenamePanelProps) {
  const [activeTab, setActiveTab] = useState<'names' | 'extension'>('names')
  const [isApplying, setIsApplying] = useState(false)
  const [summary, setSummary] = useState<ApplySummary | null>(null)
  const queryClient = useQueryClient()
  const effectiveRules = useMemo<BulkRenameRules>(
    () => ({
      ...rules,
      numberingEnabled: false,
      numberingStart: 1,
      numberingPad: 1,
      numberingSeparator: '',
      numberingPosition: 'suffix',
    }),
    [rules],
  )

  const renamePreview = useMemo<RenamePreviewRow[]>(() => {
    return samples
      .map((slice, index) => ({
        id: slice.id,
        currentName: slice.name,
        nextName: applyBulkRenameRules(slice.name, effectiveRules, index),
      }))
      .filter((row) => row.currentName !== row.nextName)
  }, [samples, effectiveRules])

  const conversionPreview = useMemo<ConversionPreviewRow[]>(() => {
    if (!effectiveRules.conversionEnabled) return []

    return samples
      .map((slice) => ({
        id: slice.id,
        currentFormat: inferSliceFormat(slice),
      }))
      .filter((row) => row.currentFormat !== effectiveRules.targetFormat)
  }, [samples, effectiveRules.conversionEnabled, effectiveRules.targetFormat])

  const pendingRenameCount = renamePreview.length
  const pendingConversionCount = conversionPreview.length
  const canApply = (pendingRenameCount > 0 || pendingConversionCount > 0) && !isSamplesLoading && !isApplying

  const updateRule = <K extends keyof BulkRenameRules>(key: K, value: BulkRenameRules[K]) => {
    onRulesChange((prev) => ({ ...prev, [key]: value }))
  }

  const resetRules = () => {
    onRulesChange(createDefaultRules())
    setSummary(null)
  }

  const applyActions = async () => {
    if (!canApply) return

    const actionSummaryParts: string[] = []
    if (pendingRenameCount > 0) {
      actionSummaryParts.push(`rename ${pendingRenameCount} sample${pendingRenameCount === 1 ? '' : 's'}`)
    }
    if (pendingConversionCount > 0) {
      actionSummaryParts.push(`convert ${pendingConversionCount} sample${pendingConversionCount === 1 ? '' : 's'} to ${effectiveRules.targetFormat.toUpperCase()}`)
    }

    const confirmed = window.confirm(`Apply bulk actions (${actionSummaryParts.join(' and ')}) in the current workspace scope?`)
    if (!confirmed) return

    setSummary(null)
    setIsApplying(true)

    const failures: string[] = []
    let renameUpdated = 0
    let renameFailed = 0
    let conversionConverted = 0
    let conversionSkipped = 0
    let conversionFailed = 0
    let runRenameWorker: (() => Promise<void>) | null = null

    if (pendingRenameCount > 0) {
      let cursor = 0
      runRenameWorker = async () => {
        while (cursor < renamePreview.length) {
          const currentIndex = cursor
          cursor += 1

          const row = renamePreview[currentIndex]
          if (!row) continue

          try {
            await api.updateSlice(row.id, { name: row.nextName })
            renameUpdated += 1
          } catch (err) {
            renameFailed += 1
            failures.push(`rename #${row.id}: ${getErrorMessage(err)}`)
          }
        }
      }
    }

    try {
      if (pendingRenameCount > 0 && runRenameWorker) {
        const workers = Math.min(UPDATE_CONCURRENCY, renamePreview.length)
        await Promise.all(Array.from({ length: workers }, () => runRenameWorker()))
      }

      if (pendingConversionCount > 0) {
        try {
          const convertResponse = await api.batchConvertSlices(
            conversionPreview.map((row) => row.id),
            effectiveRules.targetFormat as BatchConvertTargetFormat,
          )

          conversionConverted = convertResponse.converted
          conversionSkipped = convertResponse.skipped
          conversionFailed = convertResponse.failed

          convertResponse.results
            .filter((result) => !result.success)
            .slice(0, 5)
            .forEach((result) => {
              failures.push(`convert #${result.sliceId}: ${result.error || 'Unknown error'}`)
            })
        } catch (err) {
          conversionFailed = pendingConversionCount
          failures.push(`conversion batch failed: ${getErrorMessage(err)}`)
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['allSlices'] }),
        queryClient.invalidateQueries({ queryKey: ['slices'] }),
        queryClient.invalidateQueries({ queryKey: ['scopedSamples'] }),
      ])

      setSummary({
        renameAttempted: pendingRenameCount,
        renameUpdated,
        renameFailed,
        conversionAttempted: pendingConversionCount,
        conversionConverted,
        conversionSkipped,
        conversionFailed,
        errors: failures.slice(0, 5),
      })
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {activeTab === 'names' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Find Text</label>
                <input
                  type="text"
                  value={rules.searchText}
                  onChange={(e) => updateRule('searchText', e.target.value)}
                  placeholder="Text to replace"
                  className={inputClassName}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Replace With</label>
                <input
                  type="text"
                  value={rules.replaceText}
                  onChange={(e) => updateRule('replaceText', e.target.value)}
                  placeholder="Replacement text"
                  className={inputClassName}
                />
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-500">Name Case Conversion</label>
                  <select
                    value={rules.caseMode}
                    onChange={(e) => updateRule('caseMode', e.target.value as NameCaseMode)}
                    className={smallSelectClassName}
                  >
                    {CASE_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={rules.caseSensitive}
                onChange={(e) => updateRule('caseSensitive', e.target.checked)}
                className="accent-accent-primary"
              />
              Case-sensitive match
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Prefix</label>
                <input
                  type="text"
                  value={rules.prefix}
                  onChange={(e) => updateRule('prefix', e.target.value)}
                  placeholder="Optional prefix"
                  className={inputClassName}
                />
              </div>

              <div className="space-y-1.5">
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
          </>
        )}

        {activeTab === 'extension' && (
          <div className="rounded-lg border border-surface-border bg-surface-base/40 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={rules.conversionEnabled}
                  onChange={(e) => updateRule('conversionEnabled', e.target.checked)}
                  className="accent-accent-primary"
                />
                Convert file format
              </label>
              <select
                value={rules.targetFormat}
                onChange={(e) => updateRule('targetFormat', e.target.value as ConversionTargetFormat)}
                disabled={!rules.conversionEnabled}
                className="rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {CONVERSION_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-500">
              {rules.conversionEnabled
                ? `${pendingConversionCount} sample${pendingConversionCount === 1 ? '' : 's'} will be converted to ${effectiveRules.targetFormat.toUpperCase()}.`
                : 'Conversion is disabled.'}
            </div>
          </div>
        )}

        {isSamplesLoading && (
          <div className="flex items-center gap-2 px-1 py-1 text-xs text-slate-400">
            <RefreshCw size={12} className="animate-spin" />
            Loading scoped samples...
          </div>
        )}

        {summary && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              summary.renameFailed + summary.conversionFailed === 0
                ? 'border-green-500/40 bg-green-500/10 text-green-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {summary.renameFailed + summary.conversionFailed === 0
                ? <CheckCircle2 size={15} />
                : <AlertCircle size={15} />}
              <span>Bulk actions finished.</span>
            </div>
            {summary.renameAttempted > 0 && (
              <div className="mt-2 text-xs">
                Renamed {summary.renameUpdated}/{summary.renameAttempted}
                {summary.renameFailed > 0 ? `, failed ${summary.renameFailed}` : ''}
              </div>
            )}
            {summary.conversionAttempted > 0 && (
              <div className="mt-1 text-xs">
                Converted {summary.conversionConverted}/{summary.conversionAttempted}
                {summary.conversionSkipped > 0 ? ` (${summary.conversionSkipped} already target format)` : ''}
                {summary.conversionFailed > 0 ? `, failed ${summary.conversionFailed}` : ''}
              </div>
            )}
            {summary.errors.length > 0 && (
              <div className="mt-2 space-y-1 text-xs text-amber-200">
                {summary.errors.map((entry) => (
                  <div key={entry}>{entry}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-surface-border bg-surface-raised px-2 py-1 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={resetRules}
            disabled={isApplying}
            className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-base px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw size={12} />
            Reset Rules
          </button>

          <div className="inline-flex items-center gap-0.5 rounded-lg border border-surface-border bg-surface-base p-0.5">
            {[
              { id: 'names' as const, label: 'Names' },
              { id: 'extension' as const, label: 'File extension' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void applyActions()
          }}
          disabled={!canApply}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            canApply
              ? 'bg-accent-primary text-white hover:bg-accent-primary/90'
              : 'cursor-not-allowed bg-surface-overlay text-slate-500'
          }`}
        >
          {isApplying ? (
            <>
              <RefreshCw size={12} className="animate-spin" />
              Applying...
            </>
          ) : (
            <>
              <Wand2 size={12} />
              Apply actions
            </>
          )}
        </button>
      </div>
    </div>
  )
}
