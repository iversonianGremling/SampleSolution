import type { CSSProperties } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import {
  Bell,
  Disc,
  Guitar,
  Microphone,
  MusicNotes,
  PianoKeys,
  Record,
  Sparkle,
  WaveSawtooth,
  WaveSine,
  Waves,
} from '@phosphor-icons/react'

interface InstrumentIconProps {
  type: string
  size?: number
  className?: string
  style?: CSSProperties
}

const INSTRUMENT_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'kick', regex: /\b(kick|bd|bass\s*drum|808)\b/i },
  { type: 'snare', regex: /\b(snare|sd|rim\s*shot|rimshot)\b/i },
  { type: 'openhat', regex: /\b(open[-_ ]?hat|ohh|openhat)\b/i },
  { type: 'hihat', regex: /\b(hihat|hi[-_ ]?hat|hh)\b/i },
  { type: 'clap', regex: /\b(clap|clp)\b/i },
  { type: 'shaker', regex: /\b(shaker|shake|maraca|tambourine)\b/i },
  { type: 'crash', regex: /\b(crash)\b/i },
  { type: 'ride', regex: /\b(ride)\b/i },
  { type: 'cymbal', regex: /\b(cymbal)\b/i },
  { type: 'tom', regex: /\b(tom|toms|floor\s*tom)\b/i },
  { type: 'cowbell', regex: /\b(cowbell)\b/i },
  { type: 'percussion', regex: /\b(perc|percussion|bongo|conga|woodblock|clave)\b/i },
  { type: 'bass', regex: /\b(bass|sub)\b/i },
  { type: 'pad', regex: /\b(pad|atmo|atmos|atmosphere|ambient)\b/i },
  { type: 'lead', regex: /\b(lead|pluck)\b/i },
  { type: 'vocal', regex: /\b(vocal|vox|voice|chant)\b/i },
  { type: 'fx', regex: /\b(fx|sfx|impact|riser|downlifter|sweep)\b/i },
  { type: 'keys', regex: /\b(keys?|piano|epiano|rhodes|organ)\b/i },
  { type: 'guitar', regex: /\b(guitar|gtr|strum)\b/i },
  { type: 'strings', regex: /\b(strings?|violin|cello|viola)\b/i },
]

export function resolveInstrumentType(...inputs: Array<string | null | undefined>): string {
  for (const input of inputs) {
    if (!input) continue
    const normalized = input.trim().toLowerCase()
    if (!normalized) continue

    for (const candidate of INSTRUMENT_PATTERNS) {
      if (candidate.regex.test(normalized)) {
        return candidate.type
      }
    }
  }

  return 'other'
}

export function InstrumentIcon({ type, size = 16, className = '', style }: InstrumentIconProps) {
  const resolvedType = resolveInstrumentType(type)

  const iconProps = {
    size,
    className,
    style,
    weight: 'regular' as const,
  }

  let IconComponent: PhosphorIcon = MusicNotes

  switch (resolvedType) {
    case 'kick':
    case 'snare':
    case 'tom':
      IconComponent = Record
      break

    case 'hihat':
    case 'openhat':
    case 'ride':
    case 'cymbal':
    case 'crash':
      IconComponent = Disc
      break

    case 'cowbell':
      IconComponent = Bell
      break

    case 'clap':
    case 'percussion':
      IconComponent = Record
      break

    case 'shaker':
      IconComponent = Waves
      break

    case 'bass':
      IconComponent = WaveSine
      break

    case 'pad':
      IconComponent = Waves
      break

    case 'lead':
      IconComponent = WaveSawtooth
      break

    case 'vocal':
      IconComponent = Microphone
      break

    case 'fx':
      IconComponent = Sparkle
      break

    case 'keys':
      IconComponent = PianoKeys
      break

    case 'guitar':
      IconComponent = Guitar
      break

    case 'strings':
      IconComponent = MusicNotes
      break

    default:
      IconComponent = MusicNotes
      break
  }

  return <IconComponent {...iconProps} />
}
