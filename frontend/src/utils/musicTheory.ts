export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const ENHARMONIC_EQUIVALENTS: Record<string, (typeof NOTES)[number]> = {
  Bb: 'A#',
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Cb: 'B',
  Fb: 'E',
  'E#': 'F',
  'B#': 'C',
}

export function normalizeNoteName(note: string): (typeof NOTES)[number] | null {
  if (!note) return null

  const cleaned = note.trim().replace('♯', '#').replace('♭', 'b')
  const match = cleaned.match(/^([A-Ga-g])([#b]?)/)
  if (!match) return null

  const canonical = `${match[1].toUpperCase()}${match[2] || ''}`
  if ((NOTES as readonly string[]).includes(canonical)) {
    return canonical as (typeof NOTES)[number]
  }

  return ENHARMONIC_EQUIVALENTS[canonical] ?? null
}

export interface RelatedKeyGroup {
  level: number
  label: string
  emoji: string
  color: string
  keys: string[]
}

/**
 * Parse a key string like "C major" or "A minor" into note index and mode
 */
function parseKey(key: string): { noteIdx: number; mode: 'major' | 'minor' } | null {
  const match = key.match(/^([A-G](?:#|b)?)\s*(major|minor)$/i)
  if (!match) return null
  const normalized = normalizeNoteName(match[1])
  if (!normalized) return null
  const noteIdx = NOTES.indexOf(normalized)
  if (noteIdx === -1) return null
  return { noteIdx, mode: match[2].toLowerCase() as 'major' | 'minor' }
}

function keyStr(idx: number, mode: 'major' | 'minor'): string {
  return `${NOTES[(idx + 12) % 12]} ${mode}`
}

/**
 * Get related keys for selected keys, grouped by "spiciness" level.
 * Keys are deduplicated - each key appears only at its smoothest level.
 * Already-selected keys are excluded from results.
 */
export function getRelatedKeys(selectedKeys: string[]): RelatedKeyGroup[] {
  if (selectedKeys.length === 0) return []

  const selectedSet = new Set(selectedKeys.map(k => k.toLowerCase()))
  const assigned = new Set<string>()

  // For each level, collect all related keys from all selected keys
  const levelKeys: string[][] = [[], [], [], [], []]

  for (const sk of selectedKeys) {
    const parsed = parseKey(sk)
    if (!parsed) continue
    const { noteIdx: root, mode } = parsed

    // Level 1 - Smooth: relative major/minor, parallel major/minor
    const rel1: string[] = []
    if (mode === 'major') {
      rel1.push(keyStr(root, 'minor'))           // parallel minor
      rel1.push(keyStr((root + 9) % 12, 'minor'))  // relative minor
    } else {
      rel1.push(keyStr(root, 'major'))           // parallel major
      rel1.push(keyStr((root + 3) % 12, 'major'))  // relative major
    }
    levelKeys[0].push(...rel1)

    // Level 2 - Close: circle of fifths neighbors
    const rel2: string[] = []
    const dom = (root + 7) % 12  // dominant
    const sub = (root + 5) % 12  // subdominant
    rel2.push(keyStr(dom, mode))
    rel2.push(keyStr(sub, mode))
    // + their relative keys
    if (mode === 'major') {
      rel2.push(keyStr((dom + 9) % 12, 'minor'))
      rel2.push(keyStr((sub + 9) % 12, 'minor'))
    } else {
      rel2.push(keyStr((dom + 3) % 12, 'major'))
      rel2.push(keyStr((sub + 3) % 12, 'major'))
    }
    levelKeys[1].push(...rel2)

    // Level 3 - Moderate: two steps on circle of fifths, secondary dominants
    const rel3: string[] = []
    const twoUp = (root + 2) % 12   // two fifths up = whole step up
    const twoDown = (root + 10) % 12 // two fifths down = whole step down
    rel3.push(keyStr(twoUp, 'major'))
    rel3.push(keyStr(twoDown, 'major'))
    rel3.push(keyStr(twoUp, 'minor'))
    rel3.push(keyStr(twoDown, 'minor'))
    levelKeys[2].push(...rel3)

    // Level 4 - Spicy: tritone sub, Neapolitan, chromatic mediants
    const rel4: string[] = []
    const tritone = (root + 6) % 12
    const neapolitan = (root + 1) % 12
    const chromaticMediantUp = (root + 4) % 12
    const chromaticMediantDown = (root + 8) % 12
    rel4.push(keyStr(tritone, 'major'), keyStr(tritone, 'minor'))
    rel4.push(keyStr(neapolitan, 'major'), keyStr(neapolitan, 'minor'))
    rel4.push(keyStr(chromaticMediantUp, 'major'), keyStr(chromaticMediantUp, 'minor'))
    rel4.push(keyStr(chromaticMediantDown, 'major'), keyStr(chromaticMediantDown, 'minor'))
    levelKeys[3].push(...rel4)
  }

  // Level 5 - Exotic: everything remaining
  const allKeys: string[] = []
  for (const note of NOTES) {
    allKeys.push(`${note} major`, `${note} minor`)
  }

  // Now deduplicate across levels: key appears at its smoothest level
  const groups: RelatedKeyGroup[] = []
  const labels = ['Smooth', 'Close', 'Moderate', 'Spicy', 'Exotic']
  const emojis = ['🟢', '🟡', '🟠', '🔴', '🟣']
  const colors = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7']

  for (let level = 0; level < 4; level++) {
    const uniqueKeys: string[] = []
    for (const k of levelKeys[level]) {
      const lower = k.toLowerCase()
      if (!selectedSet.has(lower) && !assigned.has(lower)) {
        assigned.add(lower)
        uniqueKeys.push(k)
      }
    }
    if (uniqueKeys.length > 0) {
      groups.push({
        level: level + 1,
        label: labels[level],
        emoji: emojis[level],
        color: colors[level],
        keys: uniqueKeys,
      })
    }
  }

  // Level 5: all remaining
  const exoticKeys: string[] = []
  for (const k of allKeys) {
    const lower = k.toLowerCase()
    if (!selectedSet.has(lower) && !assigned.has(lower)) {
      assigned.add(lower)
      exoticKeys.push(k)
    }
  }
  if (exoticKeys.length > 0) {
    groups.push({
      level: 5,
      label: labels[4],
      emoji: emojis[4],
      color: colors[4],
      keys: exoticKeys,
    })
  }

  return groups
}

/**
 * Get related notes for selected notes, grouped by interval "spiciness" level.
 * Based on consonance/dissonance of intervals between fundamental frequencies.
 * Notes are deduplicated - each note appears only at its smoothest level.
 * Already-selected notes are excluded from results.
 */
export function getRelatedNotes(selectedNotes: string[]): RelatedKeyGroup[] {
  if (selectedNotes.length === 0) return []

  const selectedSet = new Set(selectedNotes.map(n => n.toUpperCase()))
  const assigned = new Set<string>()

  // For each level, collect related notes from all selected notes
  const levelNotes: string[][] = [[], [], [], [], []]

  for (const sn of selectedNotes) {
    const noteIdx = NOTES.indexOf(sn as any)
    if (noteIdx === -1) continue

    // Level 1 - Smooth: Perfect 5th (+7), Perfect 4th (+5)
    levelNotes[0].push(NOTES[(noteIdx + 7) % 12], NOTES[(noteIdx + 5) % 12])

    // Level 2 - Close: Major 3rd (+4), Minor 3rd (+3), Major 6th (+9)
    levelNotes[1].push(
      NOTES[(noteIdx + 4) % 12],
      NOTES[(noteIdx + 3) % 12],
      NOTES[(noteIdx + 9) % 12]
    )

    // Level 3 - Moderate: Minor 6th (+8), Major 2nd (+2), Minor 7th (+10)
    levelNotes[2].push(
      NOTES[(noteIdx + 8) % 12],
      NOTES[(noteIdx + 2) % 12],
      NOTES[(noteIdx + 10) % 12]
    )

    // Level 4 - Spicy: Minor 2nd (+1), Major 7th (+11), Tritone (+6)
    levelNotes[3].push(
      NOTES[(noteIdx + 1) % 12],
      NOTES[(noteIdx + 11) % 12],
      NOTES[(noteIdx + 6) % 12]
    )
  }

  const labels = ['Smooth', 'Close', 'Moderate', 'Spicy', 'Exotic']
  const emojis = ['🟢', '🟡', '🟠', '🔴', '🟣']
  const colors = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7']

  const groups: RelatedKeyGroup[] = []

  for (let level = 0; level < 4; level++) {
    const uniqueNotes: string[] = []
    for (const n of levelNotes[level]) {
      const upper = n.toUpperCase()
      if (!selectedSet.has(upper) && !assigned.has(upper)) {
        assigned.add(upper)
        uniqueNotes.push(n)
      }
    }
    if (uniqueNotes.length > 0) {
      groups.push({
        level: level + 1,
        label: labels[level],
        emoji: emojis[level],
        color: colors[level],
        keys: uniqueNotes,
      })
    }
  }

  // Level 5: any remaining notes
  const exoticNotes: string[] = []
  for (const note of NOTES) {
    const upper = note.toUpperCase()
    if (!selectedSet.has(upper) && !assigned.has(upper)) {
      assigned.add(upper)
      exoticNotes.push(note)
    }
  }
  if (exoticNotes.length > 0) {
    groups.push({
      level: 5,
      label: labels[4],
      emoji: emojis[4],
      color: colors[4],
      keys: exoticNotes,
    })
  }

  return groups
}

/**
 * Convert a frequency in Hz to the nearest note name.
 */
export function freqToNoteName(hz: number): string | null {
  if (!hz || hz <= 0) return null
  const midi = Math.round(12 * Math.log2(hz / 440) + 69)
  return NOTES[((midi % 12) + 12) % 12]
}

export interface PitchDisplayInfo {
  note: (typeof NOTES)[number]
  octave: number
  cents: number
  noteWithOctave: string
  centsLabel: string
  compactCentsLabel: string
  fullLabel: string
  compactLabel: string
}

/**
 * Convert a frequency in Hz to note+octave and signed cents deviation.
 */
export function freqToPitchDisplay(hz: number): PitchDisplayInfo | null {
  if (!Number.isFinite(hz) || hz <= 0) return null

  const midiFloat = 12 * Math.log2(hz / 440) + 69
  const nearestMidi = Math.round(midiFloat)
  const note = NOTES[((nearestMidi % 12) + 12) % 12]
  const octave = Math.floor(nearestMidi / 12) - 1
  const cents = Math.round((midiFloat - nearestMidi) * 100)
  const centsPrefix = cents >= 0 ? '+' : ''
  const centsLabel = `${centsPrefix}${cents} cents`
  const compactCentsLabel = `${centsPrefix}${cents}c`
  const noteWithOctave = `${note}${octave}`

  return {
    note,
    octave,
    cents,
    noteWithOctave,
    centsLabel,
    compactCentsLabel,
    fullLabel: `${noteWithOctave} ${centsLabel}`,
    compactLabel: `${noteWithOctave} ${compactCentsLabel}`,
  }
}

const DEGREE_NAMES = [
  'Tonic (I)',
  'Neapolitan (bII)',
  'Supertonic (II)',
  'Mediant (III)',
  'Mediant (bIII)',
  'Subdominant (IV)',
  'Tritone (bV)',
  'Dominant (V)',
  'Submediant (bVI)',
  'Submediant (VI)',
  'Subtonic (bVII)',
  'Leading Tone (VII)',
]

/**
 * Get the scale degree name of a sample key relative to a reference key.
 * Returns a string like "Dominant (V)" or "Mediant (III)".
 */
export function getScaleDegree(sampleKey: string, referenceKey: string): string {
  const sample = parseKey(sampleKey)
  const ref = parseKey(referenceKey)
  if (!sample || !ref) return 'Unknown'

  const semitones = ((sample.noteIdx - ref.noteIdx) + 12) % 12
  return DEGREE_NAMES[semitones] || 'Unknown'
}

/**
 * Calculate the semitone shift needed to move from sourceNote to targetNote,
 * taking the shortest path (result is in the range [-6, +6]).
 */
export function calcSemitoneShift(sourceNote: string, targetNote: string): number {
  const normalizedSource = normalizeNoteName(sourceNote)
  const normalizedTarget = normalizeNoteName(targetNote)
  if (!normalizedSource || !normalizedTarget) return 0

  const sourceIdx = NOTES.indexOf(normalizedSource)
  const targetIdx = NOTES.indexOf(normalizedTarget)
  if (sourceIdx === -1 || targetIdx === -1) return 0
  const diff = ((targetIdx - sourceIdx) + 12) % 12
  return diff <= 6 ? diff : diff - 12
}

/**
 * Extract the tonic/root note from a key string like "C major" or "A minor".
 */
export function extractTonic(key: string): string | null {
  const match = key.match(/^([A-G](?:#|b)?)/i)
  if (!match) return null
  return normalizeNoteName(match[1])
}

/**
 * Get all unique scale degree labels for grouping.
 * Returns them in chromatic order.
 */
export function getScaleDegreeGroups(
  samples: Array<{ keyEstimate?: string | null }>,
  referenceKey: string
): string[] {
  const degrees = new Set<string>()
  for (const s of samples) {
    if (s.keyEstimate) {
      degrees.add(getScaleDegree(s.keyEstimate, referenceKey))
    }
  }
  // Sort by chromatic order
  return DEGREE_NAMES.filter(d => degrees.has(d))
}
