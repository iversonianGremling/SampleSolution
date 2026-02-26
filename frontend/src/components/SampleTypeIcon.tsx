import { CircleDot, Repeat2, Minus } from 'lucide-react'

type SampleTypeValue = 'oneshot' | 'loop' | null | undefined

interface SampleTypeIconProps {
  sampleType: SampleTypeValue
  size?: number
  className?: string
}

export function SampleTypeIcon({ sampleType, size = 14, className }: SampleTypeIconProps) {
  if (sampleType === 'oneshot') {
    return <CircleDot size={size} className={className} aria-label="One-shot sample" />
  }

  if (sampleType === 'loop') {
    return <Repeat2 size={size} className={className} aria-label="Loop sample" />
  }

  return <Minus size={size} className={className} aria-label="Unspecified sample type" />
}
