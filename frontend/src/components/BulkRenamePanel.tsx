import { useMemo, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw, Wand2 } from 'lucide-react'
import * as api from '../api/client'
import { CustomCheckbox } from './CustomCheckbox'
import type {
  BatchConvertQualityOptions,
  BatchConvertTargetBitDepth,
  BatchConvertTargetFormat,
} from '../api/client'
import { useToast } from '../contexts/ToastContext'
import { useAppDialog } from '../hooks/useAppDialog'
import type { SliceWithTrackExtended } from '../types'
import {
  applyBulkRenameRules,
  DEFAULT_BULK_RENAME_RULES,
  getBulkRenameRegexError,
  matchesBulkRenameSearchText,
  type BulkRenameRules,
  type ConversionTargetBitDepth,
  type ConversionTargetFormat,
  type ConversionTargetSelection,
  type NameCaseMode,
} from '../utils/bulkRename'

interface BulkRenamePanelProps {
  scopedSamples: SliceWithTrackExtended[]
  selectedSamples: SliceWithTrackExtended[]
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
  targetFormat: ConversionTargetFormat
}

interface MatchedSamplePreviewRow {
  id: number
  name: string
  trackTitle: string
  matchSnippets: string[]
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
const MATCHED_SAMPLE_PREVIEW_LIMIT = 12

const inputClassName = 'w-full rounded border border-surface-border bg-surface-base px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary'
const smallSelectClassName = 'w-full max-w-[220px] rounded border border-surface-border bg-surface-base px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-primary'
const checkboxPillClassName = 'inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-base/70 px-2 py-1 text-[11px] text-slate-300'

const CASE_MODE_OPTIONS: Array<{ value: NameCaseMode; label: string }> = [
  { value: 'none', label: 'No conversion' },
  { value: 'lower', label: 'lowercase' },
  { value: 'upper', label: 'UPPERCASE' },
  { value: 'title', label: 'Title Case' },
  { value: 'snake', label: 'snake_case' },
  { value: 'kebab', label: 'kebab-case' },
]

const CONVERSION_FORMAT_OPTIONS: Array<{ value: ConversionTargetSelection; label: string }> = [
  { value: 'keep', label: 'Keep original format' },
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
  { value: 'aiff', label: 'AIFF' },
  { value: 'ogg', label: 'OGG Vorbis' },
  { value: 'm4a', label: 'M4A (AAC)' },
]

const CONVERSION_SAMPLE_RATE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 22050, label: '22.05 kHz' },
  { value: 32000, label: '32 kHz' },
  { value: 44100, label: '44.1 kHz' },
  { value: 48000, label: '48 kHz' },
  { value: 88200, label: '88.2 kHz' },
  { value: 96000, label: '96 kHz' },
]

const CONVERSION_BIT_DEPTH_OPTIONS: Array<{ value: ConversionTargetBitDepth; label: string }> = [
  { value: 16, label: '16-bit' },
  { value: 24, label: '24-bit' },
  { value: 32, label: '32-bit' },
]
const BIT_DEPTH_SUPPORTED_FORMATS = new Set<ConversionTargetFormat>(['wav', 'flac', 'aiff'])

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

function inferSliceSampleRate(slice: SliceWithTrackExtended): number | null {
  const sampleRate = Number(slice.sampleRate)
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null
  return Math.round(sampleRate)
}

function formatSampleRateLabel(sampleRate: number): string {
  const valueKhz = sampleRate / 1000
  return `${Number.isInteger(valueKhz) ? valueKhz.toFixed(0) : valueKhz.toFixed(1)} kHz`
}

function supportsBitDepthForFormat(targetFormat: ConversionTargetFormat): boolean {
  return BIT_DEPTH_SUPPORTED_FORMATS.has(targetFormat)
}

function supportsBitDepthForSelection(targetFormat: ConversionTargetSelection): boolean {
  if (targetFormat === 'keep') return true
  return supportsBitDepthForFormat(targetFormat)
}

function resolveTargetFormatForSlice(
  currentFormat: ConversionTargetFormat | null,
  targetSelection: ConversionTargetSelection,
): ConversionTargetFormat | null {
  if (targetSelection === 'keep') {
    return currentFormat
  }
  return targetSelection
}

function formatConversionTargetLabel(rules: Pick<BulkRenameRules, 'targetFormat' | 'targetSampleRate' | 'targetBitDepth'>): string {
  const formatLabel = rules.targetFormat === 'keep' ? 'Original format' : rules.targetFormat.toUpperCase()
  const parts = [formatLabel]
  if (rules.targetSampleRate !== null) {
    parts.push(formatSampleRateLabel(rules.targetSampleRate))
  }
  const effectiveBitDepth = supportsBitDepthForSelection(rules.targetFormat)
    ? rules.targetBitDepth
    : null
  if (effectiveBitDepth !== null) {
    parts.push(
      rules.targetFormat === 'keep'
        ? `${effectiveBitDepth}-bit (where supported)`
        : `${effectiveBitDepth}-bit`
    )
  }
  return parts.join(' / ')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unknown error'
}

function formatSampleLabel(count: number): string {
  return `${count} sample${count === 1 ? '' : 's'}`
}

function handleCheckboxPillKeyDown(event: KeyboardEvent<HTMLDivElement>, onToggle: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onToggle()
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSearchMatchSnippets(
  sampleName: string,
  rules: Pick<BulkRenameRules, 'searchText' | 'caseSensitive' | 'matchRegex'>,
  maxSnippets = 3,
): string[] {
  const searchText = rules.searchText.trim()
  if (!searchText || maxSnippets < 1) return []

  const source = rules.matchRegex ? searchText : escapeRegExp(searchText)
  const flags = rules.caseSensitive ? 'g' : 'gi'

  let pattern: RegExp
  try {
    pattern = new RegExp(source, flags)
  } catch {
    return []
  }

  const snippets: string[] = []
  let safetyCounter = 0
  while (snippets.length < maxSnippets && safetyCounter < 100) {
    const match = pattern.exec(sampleName)
    if (!match) break
    const value = match[0]
    if (value.length > 0) {
      snippets.push(value)
    } else if (pattern.lastIndex < sampleName.length) {
      pattern.lastIndex += 1
    } else {
      break
    }
    safetyCounter += 1
  }

  return snippets
}

export function BulkRenamePanel({
  scopedSamples,
  selectedSamples,
  isSamplesLoading,
  rules,
  onRulesChange,
}: BulkRenamePanelProps) {
  const [activeTab, setActiveTab] = useState<'names' | 'extension'>('names')
  const [isApplying, setIsApplying] = useState(false)
  const [summary, setSummary] = useState<ApplySummary | null>(null)
  const { showToast } = useToast()
  const { confirm } = useAppDialog()
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
  const regexError = getBulkRenameRegexError(rules)

  const selectedSampleIds = useMemo(
    () => new Set(selectedSamples.map((sample) => sample.id)),
    [selectedSamples],
  )

  const textMatchedSampleIds = useMemo(() => {
    const ids = new Set<number>()
    for (const sample of scopedSamples) {
      if (matchesBulkRenameSearchText(sample.name, rules)) {
        ids.add(sample.id)
      }
    }
    return ids
  }, [scopedSamples, rules.searchText, rules.caseSensitive, rules.matchRegex])

  const targetSamples = useMemo(() => {
    return scopedSamples.filter(
      (sample) => selectedSampleIds.has(sample.id) || textMatchedSampleIds.has(sample.id),
    )
  }, [scopedSamples, selectedSampleIds, textMatchedSampleIds])

  const renamePreview = useMemo<RenamePreviewRow[]>(() => {
    return targetSamples
      .map((slice, index) => ({
        id: slice.id,
        currentName: slice.name,
        nextName: applyBulkRenameRules(slice.name, effectiveRules, index),
      }))
      .filter((row) => row.currentName !== row.nextName)
  }, [targetSamples, effectiveRules])

  const conversionPreview = useMemo<ConversionPreviewRow[]>(() => {
    if (!effectiveRules.conversionEnabled) return []

    return targetSamples
      .map((slice) => ({
        id: slice.id,
        currentFormat: inferSliceFormat(slice),
        targetFormat: resolveTargetFormatForSlice(
          inferSliceFormat(slice),
          effectiveRules.targetFormat,
        ),
        sampleRateWillChange:
          effectiveRules.targetSampleRate !== null &&
          inferSliceSampleRate(slice) !== effectiveRules.targetSampleRate,
      }))
      .map((row) => ({
        ...row,
        formatWillChange:
          row.currentFormat !== null &&
          row.targetFormat !== null &&
          row.currentFormat !== row.targetFormat,
        bitDepthWillChange:
          effectiveRules.targetBitDepth !== null &&
          row.targetFormat !== null &&
          supportsBitDepthForFormat(row.targetFormat),
      }))
      .filter(
        (row) =>
          row.targetFormat !== null &&
          (row.formatWillChange || row.sampleRateWillChange || row.bitDepthWillChange)
      )
      .map((row) => ({ id: row.id, targetFormat: row.targetFormat as ConversionTargetFormat }))
  }, [
    targetSamples,
    effectiveRules.conversionEnabled,
    effectiveRules.targetFormat,
    effectiveRules.targetSampleRate,
    effectiveRules.targetBitDepth,
  ])

  const textMatchedSampleCount = textMatchedSampleIds.size
  const selectedSampleCount = selectedSampleIds.size
  const targetSampleCount = targetSamples.length
  const matchedSamplePreviewRows = useMemo<MatchedSamplePreviewRow[]>(() => {
    if (textMatchedSampleCount === 0) return []
    return scopedSamples
      .filter((sample) => textMatchedSampleIds.has(sample.id))
      .slice(0, MATCHED_SAMPLE_PREVIEW_LIMIT)
      .map((sample) => ({
        id: sample.id,
        name: sample.name,
        trackTitle: sample.track.title,
        matchSnippets: getSearchMatchSnippets(sample.name, rules),
      }))
  }, [
    scopedSamples,
    textMatchedSampleIds,
    textMatchedSampleCount,
    rules.searchText,
    rules.caseSensitive,
    rules.matchRegex,
  ])
  const remainingMatchedPreviewCount = Math.max(0, textMatchedSampleCount - matchedSamplePreviewRows.length)
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
      actionSummaryParts.push(
        `convert ${pendingConversionCount} sample${pendingConversionCount === 1 ? '' : 's'} to ${formatConversionTargetLabel(effectiveRules)}`
      )
    }

    const confirmed = await confirm({
      title: 'Apply Bulk Actions?',
      message: `Apply bulk actions (${actionSummaryParts.join(' and ')}) to ${formatSampleLabel(targetSampleCount)} in the current workspace scope? (${formatSampleLabel(textMatchedSampleCount)} matched from text, ${formatSampleLabel(selectedSampleCount)} selected)`,
      confirmText: 'Apply',
      cancelText: 'Cancel',
    })
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
          const idsByTargetFormat = new Map<BatchConvertTargetFormat, number[]>()
          conversionPreview.forEach((row) => {
            const key = row.targetFormat as BatchConvertTargetFormat
            const existing = idsByTargetFormat.get(key)
            if (existing) {
              existing.push(row.id)
              return
            }
            idsByTargetFormat.set(key, [row.id])
          })

          for (const [targetFormat, sliceIds] of idsByTargetFormat.entries()) {
            const qualityOptions: BatchConvertQualityOptions = {}
            if (effectiveRules.targetSampleRate !== null) {
              qualityOptions.sampleRate = effectiveRules.targetSampleRate
            }
            if (effectiveRules.targetBitDepth !== null && supportsBitDepthForFormat(targetFormat)) {
              qualityOptions.bitDepth = effectiveRules.targetBitDepth as BatchConvertTargetBitDepth
            }

            const convertResponse = await api.batchConvertSlices(
              sliceIds,
              targetFormat,
              qualityOptions,
            )

            conversionConverted += convertResponse.converted
            conversionSkipped += convertResponse.skipped
            conversionFailed += convertResponse.failed

            convertResponse.results
              .filter((result) => !result.success)
              .slice(0, 5)
              .forEach((result) => {
                failures.push(`convert #${result.sliceId}: ${result.error || 'Unknown error'}`)
              })
          }
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
      const toastSegments: string[] = []
      if (pendingRenameCount > 0) {
        toastSegments.push(`renamed ${renameUpdated}/${pendingRenameCount}`)
      }
      if (pendingConversionCount > 0) {
        toastSegments.push(
          `converted ${conversionConverted}/${pendingConversionCount}${conversionSkipped > 0 ? ` (${conversionSkipped} already target settings)` : ''}`
        )
      }
      const totalFailures = renameFailed + conversionFailed
      const toastMessage =
        toastSegments.length > 0
          ? `Bulk actions complete: ${toastSegments.join(', ')}${totalFailures > 0 ? `, failed ${totalFailures}` : ''}.`
          : 'Bulk actions complete.'
      showToast({
        kind: totalFailures === 0 ? 'success' : 'warning',
        message: toastMessage,
      })
      onRulesChange((prev) => ({
        ...prev,
        searchText: '',
      }))
    } catch (err) {
      showToast({
        kind: 'error',
        message: `Bulk actions failed: ${getErrorMessage(err)}`,
      })
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="h-full flex flex-col" data-tour="filters-bulk-actions-panel">
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {activeTab === 'names' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div
                className="space-y-2 rounded-lg border border-surface-border bg-surface-base/30 p-3"
                data-tour="filters-bulk-find-text"
              >
                <label className="text-xs font-medium text-slate-400">Find Text</label>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="checkbox"
                    aria-checked={rules.caseSensitive}
                    tabIndex={0}
                    onClick={() => updateRule('caseSensitive', !rules.caseSensitive)}
                    onKeyDown={(event) =>
                      handleCheckboxPillKeyDown(event, () => updateRule('caseSensitive', !rules.caseSensitive))
                    }
                    className={`${checkboxPillClassName} cursor-pointer select-none`}
                  >
                    <CustomCheckbox
                      checked={rules.caseSensitive}
                      onChange={(e) => updateRule('caseSensitive', e.target.checked)}
                      className="flex-shrink-0"
                    />
                    <span>Case-sensitive</span>
                  </div>
                  <div
                    role="checkbox"
                    aria-checked={rules.matchRegex}
                    tabIndex={0}
                    onClick={() => updateRule('matchRegex', !rules.matchRegex)}
                    onKeyDown={(event) =>
                      handleCheckboxPillKeyDown(event, () => updateRule('matchRegex', !rules.matchRegex))
                    }
                    className={`${checkboxPillClassName} cursor-pointer select-none`}
                  >
                    <CustomCheckbox
                      checked={rules.matchRegex}
                      onChange={(e) => updateRule('matchRegex', e.target.checked)}
                      className="flex-shrink-0"
                    />
                    <span>Regex (JS)</span>
                  </div>
                </div>
                <input
                  type="text"
                  value={rules.searchText}
                  onChange={(e) => updateRule('searchText', e.target.value)}
                  placeholder={rules.matchRegex ? 'Regex pattern to match' : 'Text to match'}
                  className={inputClassName}
                />
                {regexError && (
                  <div className="text-[11px] text-red-300">Regex error: {regexError}</div>
                )}
              </div>

              <div
                className="space-y-2 rounded-lg border border-surface-border bg-surface-base/30 p-3"
                data-tour="filters-bulk-replace"
              >
                <label className="text-xs font-medium text-slate-400">Replace With</label>
                <div
                  role="checkbox"
                  aria-checked={rules.replaceMatches}
                  tabIndex={0}
                  onClick={() => updateRule('replaceMatches', !rules.replaceMatches)}
                  onKeyDown={(event) =>
                    handleCheckboxPillKeyDown(event, () => updateRule('replaceMatches', !rules.replaceMatches))
                  }
                  className={`${checkboxPillClassName} cursor-pointer select-none`}
                >
                  <CustomCheckbox
                    checked={rules.replaceMatches}
                    onChange={(e) => updateRule('replaceMatches', e.target.checked)}
                    className="flex-shrink-0"
                  />
                  <span>Replace matched text</span>
                </div>
                <input
                  type="text"
                  value={rules.replaceText}
                  onChange={(e) => updateRule('replaceText', e.target.value)}
                  placeholder={rules.matchRegex ? 'Replacement text ($1, $2...)' : 'Replacement text'}
                  disabled={!rules.replaceMatches}
                  className={inputClassName}
                />
                {!rules.replaceMatches && (
                  <div className="text-[11px] text-slate-500">Find text will only target samples; it will not rewrite names.</div>
                )}
                <div className="space-y-1 pt-0.5">
                  <label className="text-[11px] font-medium text-slate-400">Name Case Conversion</label>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-tour="filters-bulk-prefix-suffix">
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
          <div
            className="rounded-lg border border-surface-border bg-surface-base/40 p-3 space-y-2"
            data-tour="filters-bulk-format-panel"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="checkbox"
                aria-checked={rules.conversionEnabled}
                tabIndex={0}
                onClick={() => updateRule('conversionEnabled', !rules.conversionEnabled)}
                onKeyDown={(event) =>
                  handleCheckboxPillKeyDown(event, () => updateRule('conversionEnabled', !rules.conversionEnabled))
                }
                className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-base/70 px-2.5 py-1.5 text-sm text-slate-300 cursor-pointer select-none"
              >
                <CustomCheckbox
                  checked={rules.conversionEnabled}
                  onChange={(e) => updateRule('conversionEnabled', e.target.checked)}
                  className="flex-shrink-0"
                />
                <span>Convert format / quality</span>
              </div>
              <select
                value={rules.targetFormat}
                onChange={(e) => updateRule('targetFormat', e.target.value as ConversionTargetSelection)}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">Sample rate</label>
                <select
                  value={rules.targetSampleRate === null ? '' : String(rules.targetSampleRate)}
                  onChange={(e) => {
                    const nextSampleRate = Number.parseInt(e.target.value, 10)
                    updateRule(
                      'targetSampleRate',
                      Number.isInteger(nextSampleRate) ? nextSampleRate : null
                    )
                  }}
                  disabled={!rules.conversionEnabled}
                  className="w-full rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  <option value="">Keep original</option>
                  {CONVERSION_SAMPLE_RATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">Bit depth</label>
                <select
                  value={rules.targetBitDepth === null ? '' : String(rules.targetBitDepth)}
                  onChange={(e) => {
                    const nextBitDepth = Number.parseInt(e.target.value, 10)
                    updateRule(
                      'targetBitDepth',
                      (Number.isInteger(nextBitDepth) ? nextBitDepth : null) as ConversionTargetBitDepth | null
                    )
                  }}
                  disabled={!rules.conversionEnabled || !supportsBitDepthForSelection(rules.targetFormat)}
                  className="w-full rounded border border-surface-border bg-surface-base px-2 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  <option value="">Keep original/default</option>
                  {CONVERSION_BIT_DEPTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!supportsBitDepthForSelection(rules.targetFormat) && (
                  <div className="text-[11px] text-slate-500">Bit depth applies to WAV, FLAC, and AIFF.</div>
                )}
                {rules.targetFormat === 'keep' && (
                  <div className="text-[11px] text-slate-500">Bit depth applies only to selected WAV, FLAC, and AIFF files.</div>
                )}
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {rules.conversionEnabled
                ? `${pendingConversionCount} sample${pendingConversionCount === 1 ? '' : 's'} will be converted to ${formatConversionTargetLabel(effectiveRules)}.`
                : 'Conversion is disabled.'}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-surface-border bg-surface-base/40 px-3 py-2 text-xs text-slate-300">
          <div>
            {formatSampleLabel(textMatchedSampleCount)} matched from text, {formatSampleLabel(selectedSampleCount)} selected.
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Target scope: {formatSampleLabel(targetSampleCount)} (deduplicated union of matched + selected).
          </div>
        </div>

        {rules.searchText.trim().length > 0 && textMatchedSampleCount > 0 && (
          <div className="rounded-lg border border-surface-border bg-surface-base/25">
            <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
              <div className="text-xs font-medium text-slate-300">
                {rules.matchRegex ? 'Regex matched samples' : 'Text matched samples'}
              </div>
              <div className="text-[11px] text-slate-500">{formatSampleLabel(textMatchedSampleCount)}</div>
            </div>
            <div className="max-h-40 overflow-auto">
              {matchedSamplePreviewRows.map((sample) => (
                <div
                  key={sample.id}
                  className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-2 border-b border-surface-border/60 px-3 py-2 text-xs"
                >
                  <div className="text-slate-500">#{sample.id}</div>
                  <div className="min-w-0">
                    <div className="truncate text-slate-200">{sample.name}</div>
                    <div className="truncate text-[10px] text-slate-500">{sample.trackTitle}</div>
                    {sample.matchSnippets.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sample.matchSnippets.map((snippet, index) => (
                          <span
                            key={`${sample.id}-${snippet}-${index}`}
                            className="rounded bg-accent-primary/15 px-1.5 py-0.5 text-[10px] text-accent-primary"
                          >
                            {snippet}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {remainingMatchedPreviewCount > 0 && (
                <div className="px-3 py-2 text-[11px] text-slate-500">
                  + {remainingMatchedPreviewCount} more matched sample{remainingMatchedPreviewCount === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </div>
        )}

        {isSamplesLoading && (
          <div className="flex items-center gap-2 px-1 py-1 text-xs text-slate-400">
            <RefreshCw size={12} className="animate-spin" />
            Loading scoped samples...
          </div>
        )}

        {!isSamplesLoading && scopedSamples.length === 0 && (
          <div className="px-1 py-1 text-xs text-slate-500">
            No samples available in the current workspace scope.
          </div>
        )}

        {!isSamplesLoading && scopedSamples.length > 0 && targetSampleCount === 0 && (
          <div className="px-1 py-1 text-xs text-slate-500">
            Type text in Find Text and/or select samples to target bulk rename actions.
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
                {summary.conversionSkipped > 0 ? ` (${summary.conversionSkipped} already target settings)` : ''}
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
              { id: 'names' as const, label: 'Names', tourId: 'filters-bulk-tab-names' },
              { id: 'extension' as const, label: 'Format / quality', tourId: 'filters-bulk-tab-format' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-tour={tab.tourId}
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
