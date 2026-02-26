import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { UpdateSlicePayload } from '../api/client'
import type { Tag } from '../types'
import { ENVELOPE_TYPE_OPTIONS, type EnvelopeTypeValue } from '../constants/envelopeTypes'

const NOTE_OPTIONS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export type SampleBulkTagMode = 'replace' | 'add' | 'remove'

export interface SampleBulkEditRequest {
  patch: UpdateSlicePayload
  tags?: {
    mode: SampleBulkTagMode
    tagIds: number[]
  }
}

interface SampleBulkEditModalProps {
  selectedCount: number
  allTags: Tag[]
  isSubmitting: boolean
  onCancel: () => void
  onSubmit: (request: SampleBulkEditRequest) => Promise<void>
}

export function SampleBulkEditModal({
  selectedCount,
  allTags,
  isSubmitting,
  onCancel,
  onSubmit,
}: SampleBulkEditModalProps) {
  const [applyName, setApplyName] = useState(false)
  const [name, setName] = useState('')
  const [applySampleType, setApplySampleType] = useState(false)
  const [sampleType, setSampleType] = useState<'oneshot' | 'loop' | ''>('')
  const [applyEnvelope, setApplyEnvelope] = useState(false)
  const [envelopeType, setEnvelopeType] = useState<EnvelopeTypeValue | ''>('')
  const [applyNote, setApplyNote] = useState(false)
  const [note, setNote] = useState('')
  const [applyTags, setApplyTags] = useState(false)
  const [tagMode, setTagMode] = useState<SampleBulkTagMode>('replace')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(() => new Set())
  const [submitError, setSubmitError] = useState<string | null>(null)

  const hasAnyChange = useMemo(
    () => applyName || applySampleType || applyEnvelope || applyNote || applyTags,
    [applyEnvelope, applyName, applyNote, applySampleType, applyTags],
  )

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((previous) => {
      const next = new Set(previous)
      if (next.has(tagId)) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const patch: UpdateSlicePayload = {}

    if (applyName) {
      const trimmedName = name.trim()
      if (!trimmedName) {
        setSubmitError('Name is required when enabled.')
        return
      }
      patch.name = trimmedName
    }

    if (applySampleType) {
      patch.sampleType = sampleType || null
    }

    if (applyEnvelope) {
      patch.envelopeType = envelopeType || null
    }

    if (applyNote) {
      const trimmedNote = note.trim().toUpperCase()
      patch.note = trimmedNote || null
    }

    const tags = applyTags
      ? {
          mode: tagMode,
          tagIds: Array.from(selectedTagIds),
        }
      : undefined

    if (Object.keys(patch).length === 0 && !tags) {
      setSubmitError('Select at least one field to edit.')
      return
    }

    try {
      await onSubmit({ patch, tags })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply bulk edits.'
      setSubmitError(message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-surface-base/70" onClick={isSubmitting ? undefined : onCancel} />
      <div className="relative w-full max-w-2xl max-h-[84vh] overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <div>
            <h3 className="text-base font-semibold text-text-primary">Bulk Edit Samples</h3>
            <p className="text-xs text-text-muted mt-0.5">Apply changes to {selectedCount} selected samples.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-50"
            aria-label="Close bulk edit"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(84vh-128px)] space-y-4">
          <div className="rounded-lg border border-surface-border bg-surface-base/60 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={applyName}
                onChange={(event) => setApplyName(event.target.checked)}
                className="rounded border-surface-border bg-surface-base"
              />
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!applyName || isSubmitting}
              placeholder="New name for all selected samples"
              className="w-full rounded border border-surface-border bg-surface-base px-2.5 py-2 text-sm text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent-primary/70"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg border border-surface-border bg-surface-base/60 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={applySampleType}
                  onChange={(event) => setApplySampleType(event.target.checked)}
                  className="rounded border-surface-border bg-surface-base"
                />
                Sample Type
              </label>
              <select
                value={sampleType}
                onChange={(event) => setSampleType(event.target.value as 'oneshot' | 'loop' | '')}
                disabled={!applySampleType || isSubmitting}
                className="w-full rounded border border-surface-border bg-surface-base px-2 py-2 text-sm text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent-primary/70"
              >
                <option value="">Clear</option>
                <option value="oneshot">One-shot</option>
                <option value="loop">Loop</option>
              </select>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-base/60 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={applyEnvelope}
                  onChange={(event) => setApplyEnvelope(event.target.checked)}
                  className="rounded border-surface-border bg-surface-base"
                />
                Envelope
              </label>
              <select
                value={envelopeType}
                onChange={(event) => setEnvelopeType(event.target.value as EnvelopeTypeValue | '')}
                disabled={!applyEnvelope || isSubmitting}
                className="w-full rounded border border-surface-border bg-surface-base px-2 py-2 text-sm text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent-primary/70"
              >
                <option value="">Clear</option>
                {ENVELOPE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-base/60 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={applyNote}
                  onChange={(event) => setApplyNote(event.target.checked)}
                  className="rounded border-surface-border bg-surface-base"
                />
                Note
              </label>
              <select
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={!applyNote || isSubmitting}
                className="w-full rounded border border-surface-border bg-surface-base px-2 py-2 text-sm text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent-primary/70"
              >
                <option value="">Clear</option>
                {NOTE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-surface-border bg-surface-base/60 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={applyTags}
                onChange={(event) => setApplyTags(event.target.checked)}
                className="rounded border-surface-border bg-surface-base"
              />
              Instruments
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Mode</span>
              <select
                value={tagMode}
                onChange={(event) => setTagMode(event.target.value as SampleBulkTagMode)}
                disabled={!applyTags || isSubmitting}
                className="rounded border border-surface-border bg-surface-base px-2 py-1.5 text-xs text-text-primary disabled:opacity-50 focus:outline-none focus:border-accent-primary/70"
              >
                <option value="replace">Replace</option>
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
            </div>

            <div className="max-h-40 overflow-y-auto rounded border border-surface-border bg-surface-base p-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {allTags.map((tag) => {
                  const checked = selectedTagIds.has(tag.id)
                  return (
                    <label key={tag.id} className="flex items-center gap-2 text-xs text-text-primary">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTag(tag.id)}
                        disabled={!applyTags || isSubmitting}
                        className="rounded border-surface-border bg-surface-base"
                      />
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: tag.color || '#94a3b8' }}
                      />
                      <span>{tag.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {submitError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {submitError}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-surface-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded border border-surface-border bg-surface-base text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !hasAnyChange}
            className="px-3 py-1.5 rounded bg-accent-primary text-white text-sm font-medium hover:bg-accent-primary/80 disabled:opacity-50"
          >
            {isSubmitting ? 'Applying...' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
