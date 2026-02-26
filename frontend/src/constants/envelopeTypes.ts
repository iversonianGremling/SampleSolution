export const ENVELOPE_TYPE_OPTIONS = [
  { value: 'percussive', label: 'Percussive' },
  { value: 'plucked', label: 'Plucked' },
  { value: 'pad', label: 'Pad' },
  { value: 'sustained', label: 'Sustained' },
  { value: 'hybrid', label: 'Hybrid' },
] as const

export type EnvelopeTypeValue = (typeof ENVELOPE_TYPE_OPTIONS)[number]['value']

export const normalizeEnvelopeTypeForEdit = (
  value: string | null | undefined
): EnvelopeTypeValue | '' => {
  if (!value) return ''
  return ENVELOPE_TYPE_OPTIONS.some((option) => option.value === value) ? (value as EnvelopeTypeValue) : ''
}
