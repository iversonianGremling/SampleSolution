import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Play, Square, Volume2, VolumeX, Trash2, ChevronUp, ChevronDown, Download,
  MousePointerClick, Hand, Mic, Repeat, Music, Layers, BarChart3, Grid3X3,
  Plus
} from 'lucide-react'
import { getSliceDownloadUrl } from '../api/client'
import { useScopedSamples } from '../hooks/useScopedSamples'
import { useDrumRack } from '../contexts/DrumRackContext'
import type { Slice } from '../types'

type PadPlayMode = 'one-shot' | 'hold'
type EditMode = 'grid' | 'velocity'

const KEY_MAP: Record<string, number> = {
  '1': 12, '2': 13, '3': 14, '4': 15,
  'q': 8,  'w': 9,  'e': 10, 'r': 11,
  'a': 4,  's': 5,  'd': 6,  'f': 7,
  'z': 0,  'x': 1,  'c': 2,  'v': 3,
}

const PAD_KEYS = [
  ['1', '2', '3', '4'],
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
]

const STEPS = 16
const PAD_COUNT = 16

const PAD_COLORS = [
  'from-blue-500/30 to-blue-600/10',
  'from-cyan-500/30 to-cyan-600/10',
  'from-teal-500/30 to-teal-600/10',
  'from-emerald-500/30 to-emerald-600/10',
  'from-violet-500/30 to-violet-600/10',
  'from-purple-500/30 to-purple-600/10',
  'from-fuchsia-500/30 to-fuchsia-600/10',
  'from-pink-500/30 to-pink-600/10',
  'from-rose-500/30 to-rose-600/10',
  'from-orange-500/30 to-orange-600/10',
  'from-amber-500/30 to-amber-600/10',
  'from-yellow-500/30 to-yellow-600/10',
  'from-indigo-500/30 to-indigo-600/10',
  'from-sky-500/30 to-sky-600/10',
  'from-lime-500/30 to-lime-600/10',
  'from-red-500/30 to-red-600/10',
]

const STEP_COLORS = [
  'bg-blue-500', 'bg-cyan-500', 'bg-teal-500', 'bg-emerald-500',
  'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
  'bg-indigo-500', 'bg-sky-500', 'bg-lime-500', 'bg-red-500',
]

// ─── Preset rhythm patterns ──────────────────────────────────
// Each pattern maps pad roles (by index) to active step indices
// Pad 0 = kick, Pad 1 = snare, Pad 2 = hi-hat, Pad 3 = perc/extra
interface PresetPattern {
  name: string
  category: string
  steps: Record<number, number[]> // padIndex -> step indices with velocity 1
}

const PRESET_PATTERNS: PresetPattern[] = [
  {
    name: 'Four on the Floor',
    category: 'House',
    steps: {
      0: [0, 4, 8, 12],          // kick every beat
      2: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat 8ths
    }
  },
  {
    name: 'Basic Rock',
    category: 'Rock',
    steps: {
      0: [0, 8],                  // kick on 1 and 3
      1: [4, 12],                 // snare on 2 and 4
      2: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat 8ths
    }
  },
  {
    name: 'Boom Bap',
    category: 'Hip-Hop',
    steps: {
      0: [0, 5, 8, 13],          // syncopated kick
      1: [4, 12],                 // snare on 2 and 4
      2: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat 8ths
    }
  },
  {
    name: 'Trap',
    category: 'Trap',
    steps: {
      0: [0, 7, 8],              // kick pattern
      1: [4, 12],                 // snare on 2 and 4
      2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // rapid hi-hats
    }
  },
  {
    name: 'Reggaeton',
    category: 'Latin',
    steps: {
      0: [0, 3, 4, 7, 8, 11, 12, 15], // dembow kick
      1: [3, 7, 11, 15],         // snare on upbeats
      2: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat
    }
  },
  {
    name: 'Disco',
    category: 'Funk',
    steps: {
      0: [0, 4, 8, 12],          // four on floor
      1: [4, 12],                 // snare
      2: [1, 3, 5, 7, 9, 11, 13, 15], // offbeat hi-hat
    }
  },
  {
    name: 'Breakbeat',
    category: 'Breaks',
    steps: {
      0: [0, 6, 10],             // syncopated kick
      1: [4, 12],                 // snare backbeat
      2: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat
      3: [14],                    // extra perc fill
    }
  },
  {
    name: 'Bossa Nova',
    category: 'Latin',
    steps: {
      0: [0, 6, 8, 12],          // bass pattern
      1: [4, 10],                 // rim shot
      2: [0, 2, 3, 5, 6, 8, 10, 11, 13, 14], // shaker pattern
    }
  },
  {
    name: 'Drum & Bass',
    category: 'DnB',
    steps: {
      0: [0, 10],                 // kick
      1: [4, 12],                 // snare
      2: [0, 2, 4, 6, 8, 10, 12, 14], // hi-hat
      3: [3, 7, 15],             // ghost snares
    }
  },
  {
    name: 'Afrobeat',
    category: 'World',
    steps: {
      0: [0, 5, 8, 13],          // kick
      1: [4, 12],                 // snare
      2: [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15], // hi-hat (12/8 feel)
      3: [2, 6, 10, 14],         // bell pattern
    }
  },
]

interface SequencerState {
  steps: number[][] // [pad][step] — 0 = off, 0.01-1.0 = velocity
  bpm: number
  playing: boolean
  currentStep: number
  recording: boolean
  looping: boolean
  metronomeOn: boolean
  countInBars: number // 0, 1, 2, or 4
}

export function DrumRackView() {
  const {
    pads, assignSample, clearPad, toggleMute, setVolume, getAudioBuffer, getAudioContext,
    previewSample, stopPreview, previewingSliceId
  } = useDrumRack()

  const [sequencer, setSequencer] = useState<SequencerState>({
    steps: Array.from({ length: PAD_COUNT }, () => Array(STEPS).fill(0)),
    bpm: 120,
    playing: false,
    currentStep: -1,
    recording: false,
    looping: true,
    metronomeOn: false,
    countInBars: 0,
  })
  const [activePads, setActivePads] = useState<Set<number>>(new Set())
  const [showBrowser, setShowBrowser] = useState<number | null>(null)
  const [browserSearch, setBrowserSearch] = useState('')
  const [padPlayMode, setPadPlayMode] = useState<PadPlayMode>('one-shot')
  const [editMode, setEditMode] = useState<EditMode>('grid')
  const [showPatterns, setShowPatterns] = useState(false)
  const [countInRemaining, setCountInRemaining] = useState(-1) // -1 = not counting in

  const timerRef = useRef<number | null>(null)
  const nextStepTimeRef = useRef<number>(0)
  const currentStepRef = useRef<number>(-1)
  const isRunningRef = useRef(false)
  const sequencerRef = useRef(sequencer)
  const padsRef = useRef(pads)
  const padPlayModeRef = useRef(padPlayMode)

  // Active manual source — only one at a time, stops previous on new trigger
  const activeSourceRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode; padIndex: number } | null>(null)

  // Drag painting refs
  const paintRef = useRef<{ active: boolean; padIndex: number; paintValue: number } | null>(null)

  // Tap tempo refs
  const tapTimesRef = useRef<number[]>([])

  // Velocity drag refs
  const velocityDragRef = useRef<{ active: boolean; padIndex: number; stepIndex: number; startY: number; startVelocity: number } | null>(null)

  // Count-in refs
  const countInTimerRef = useRef<number | null>(null)
  const countInStepRef = useRef(0)

  // Keep refs in sync
  useEffect(() => { sequencerRef.current = sequencer }, [sequencer])
  useEffect(() => { padsRef.current = pads }, [pads])
  useEffect(() => { padPlayModeRef.current = padPlayMode }, [padPlayMode])

  // Sample browser data
  const { data: samplesData } = useScopedSamples({ type: 'all' }, [], '', false)
  const allSamples = useMemo(() => samplesData?.samples ?? [], [samplesData])
  const filteredSamples = useMemo(() => {
    if (!browserSearch.trim()) return allSamples.slice(0, 50)
    const q = browserSearch.toLowerCase()
    return allSamples.filter(s => s.name.toLowerCase().includes(q)).slice(0, 50)
  }, [allSamples, browserSearch])

  // ─── Metronome click generator ───────────────────────────────
  const playMetronomeClick = useCallback((time: number, isDownbeat: boolean) => {
    const ctx = getAudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = isDownbeat ? 1000 : 800
    gain.gain.setValueAtTime(0.3, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(time)
    osc.stop(time + 0.05)
  }, [getAudioContext])

  // Stop any currently playing manual source
  const stopManualSource = useCallback(() => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.source.stop() } catch { /* already stopped */ }
      activeSourceRef.current = null
    }
  }, [])

  // Play a pad manually (exclusive — stops any previous manual playback)
  const triggerPadManual = useCallback((padIndex: number) => {
    const pad = padsRef.current[padIndex]
    if (!pad.slice || pad.muted) return
    const buffer = getAudioBuffer(pad.slice.id)
    if (!buffer) return

    stopManualSource()

    const ctx = getAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = pad.volume
    source.connect(gain)
    gain.connect(ctx.destination)

    activeSourceRef.current = { source, gain, padIndex }

    source.onended = () => {
      if (activeSourceRef.current?.source === source) {
        activeSourceRef.current = null
        setActivePads(prev => { const n = new Set(prev); n.delete(padIndex); return n })
      }
    }

    source.start()
    setActivePads(prev => new Set(prev).add(padIndex))

    // If recording, write this hit to the current step
    if (sequencerRef.current.recording && sequencerRef.current.playing && currentStepRef.current >= 0) {
      const step = currentStepRef.current
      setSequencer(prev => {
        const steps = prev.steps.map(row => [...row])
        if (steps[padIndex][step] === 0) {
          steps[padIndex][step] = 1 // full velocity
        }
        return { ...prev, steps }
      })
    }
  }, [getAudioBuffer, getAudioContext, stopManualSource])

  // Stop manual playback (for hold mode release)
  const releasePad = useCallback(() => {
    const active = activeSourceRef.current
    if (active) {
      const padIndex = active.padIndex
      stopManualSource()
      setActivePads(prev => { const n = new Set(prev); n.delete(padIndex); return n })
    }
  }, [stopManualSource])

  // Play a pad from the sequencer (non-exclusive, fire-and-forget)
  const triggerPadSequencer = useCallback((padIndex: number, time: number, velocity: number) => {
    const pad = padsRef.current[padIndex]
    if (!pad.slice || pad.muted) return
    const buffer = getAudioBuffer(pad.slice.id)
    if (!buffer) return
    const ctx = getAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = pad.volume * velocity
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start(time)
  }, [getAudioBuffer, getAudioContext])

  // ─── Sequencer scheduler ─────────────────────────────────────
  const scheduleStep = useCallback(() => {
    if (!isRunningRef.current) return

    const ctx = getAudioContext()
    const seq = sequencerRef.current
    const lookahead = 0.1
    const scheduleAheadTime = 0.05

    while (nextStepTimeRef.current < ctx.currentTime + lookahead) {
      const step = (currentStepRef.current + 1) % STEPS
      currentStepRef.current = step

      // Trigger pads for this step
      for (let pad = 0; pad < PAD_COUNT; pad++) {
        const vel = seq.steps[pad][step]
        if (vel > 0) {
          triggerPadSequencer(pad, nextStepTimeRef.current, vel)
        }
      }

      // Metronome click on quarter notes (steps 0, 4, 8, 12)
      if (seq.metronomeOn && step % 4 === 0) {
        playMetronomeClick(nextStepTimeRef.current, step === 0)
      }

      setSequencer(prev => ({ ...prev, currentStep: step }))

      const secondsPerBeat = 60.0 / seq.bpm
      const secondsPerStep = secondsPerBeat / 4
      nextStepTimeRef.current += secondsPerStep
    }

    if (isRunningRef.current) {
      timerRef.current = window.setTimeout(scheduleStep, scheduleAheadTime * 1000)
    }
  }, [triggerPadSequencer, getAudioContext, playMetronomeClick])

  // ─── Count-in logic ──────────────────────────────────────────
  const startCountIn = useCallback((onComplete: () => void) => {
    const bars = sequencerRef.current.countInBars
    if (bars === 0) {
      onComplete()
      return
    }

    const totalBeats = bars * 4 // 4 beats per bar
    countInStepRef.current = 0
    setCountInRemaining(totalBeats)

    const ctx = getAudioContext()
    const secondsPerBeat = 60.0 / sequencerRef.current.bpm
    let nextTime = ctx.currentTime + 0.05

    const scheduleCountIn = () => {
      if (countInStepRef.current >= totalBeats) {
        setCountInRemaining(-1)
        onComplete()
        return
      }

      const isDownbeat = countInStepRef.current % 4 === 0
      playMetronomeClick(nextTime, isDownbeat)

      countInStepRef.current++
      setCountInRemaining(totalBeats - countInStepRef.current)
      nextTime += secondsPerBeat

      countInTimerRef.current = window.setTimeout(scheduleCountIn, secondsPerBeat * 1000 * 0.9)
    }

    scheduleCountIn()
  }, [getAudioContext, playMetronomeClick])

  const startSequencer = useCallback(() => {
    if (isRunningRef.current) return
    isRunningRef.current = true
    const ctx = getAudioContext()
    currentStepRef.current = -1
    nextStepTimeRef.current = ctx.currentTime
    scheduleStep()
  }, [getAudioContext, scheduleStep])

  const stopSequencer = useCallback(() => {
    isRunningRef.current = false
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (countInTimerRef.current !== null) {
      clearTimeout(countInTimerRef.current)
      countInTimerRef.current = null
    }
    currentStepRef.current = -1
    setCountInRemaining(-1)
  }, [])

  const togglePlay = useCallback(() => {
    if (sequencerRef.current.playing) {
      stopSequencer()
      setSequencer(prev => ({ ...prev, playing: false, currentStep: -1, recording: false }))
    } else {
      const startPlaying = () => {
        startSequencer()
        setSequencer(prev => ({ ...prev, playing: true, currentStep: -1 }))
      }

      if (sequencerRef.current.recording && sequencerRef.current.countInBars > 0) {
        startCountIn(startPlaying)
      } else {
        startPlaying()
      }
    }
  }, [startSequencer, stopSequencer, startCountIn])

  const toggleMetronome = useCallback(() => {
    setSequencer(prev => ({ ...prev, metronomeOn: !prev.metronomeOn }))
  }, [])

  const toggleLooping = useCallback(() => {
    setSequencer(prev => ({ ...prev, looping: !prev.looping }))
  }, [])

  // ─── Tap Tempo ───────────────────────────────────────────────
  const handleTapTempo = useCallback(() => {
    const now = performance.now()
    const taps = tapTimesRef.current

    // Reset if last tap was more than 2 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = []
    }

    tapTimesRef.current.push(now)

    // Keep last 8 taps
    if (tapTimesRef.current.length > 8) {
      tapTimesRef.current = tapTimesRef.current.slice(-8)
    }

    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1])
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const bpm = Math.round(60000 / avgInterval)
      const clampedBpm = Math.max(40, Math.min(300, bpm))
      setSequencer(prev => ({ ...prev, bpm: clampedBpm }))
    }
  }, [])

  // ─── Keyboard handler ────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }

      const key = e.key.toLowerCase()
      const padIndex = KEY_MAP[key]
      if (padIndex !== undefined) {
        e.preventDefault()
        triggerPadManual(padIndex)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const padIndex = KEY_MAP[key]
      if (padIndex !== undefined && padPlayModeRef.current === 'hold') {
        if (activeSourceRef.current?.padIndex === padIndex) {
          releasePad()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [triggerPadManual, releasePad, togglePlay])

  // ─── Mouse up handler for drag painting + velocity ───────────
  useEffect(() => {
    const handleMouseUp = () => {
      paintRef.current = null
      velocityDragRef.current = null
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  // Velocity drag mouse move
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = velocityDragRef.current
      if (!drag?.active) return

      const deltaY = drag.startY - e.clientY // up = more velocity
      const newVel = Math.max(0.05, Math.min(1, drag.startVelocity + deltaY / 100))

      setSequencer(prev => {
        const steps = prev.steps.map(row => [...row])
        steps[drag.padIndex][drag.stepIndex] = newVel
        return { ...prev, steps }
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      stopSequencer()
    }
  }, [stopSequencer])

  // ─── Step actions ────────────────────────────────────────────
  const handleAssignSample = useCallback((padIndex: number, slice: Slice) => {
    assignSample(padIndex, slice)
    setShowBrowser(null)
    setBrowserSearch('')
    stopPreview()
  }, [assignSample, stopPreview])

  const handleClearPad = useCallback((padIndex: number) => {
    clearPad(padIndex)
    setSequencer(prev => {
      const steps = [...prev.steps]
      steps[padIndex] = Array(STEPS).fill(0)
      return { ...prev, steps }
    })
  }, [clearPad])

  // ─── Drag painting ──────────────────────────────────────────
  const handleStepMouseDown = useCallback((padIndex: number, stepIndex: number) => {
    if (editMode === 'velocity') return // velocity mode uses different drag
    const currentVal = sequencerRef.current.steps[padIndex][stepIndex]
    const newVal = currentVal > 0 ? 0 : 1
    paintRef.current = { active: true, padIndex, paintValue: newVal }

    setSequencer(prev => {
      const steps = prev.steps.map(row => [...row])
      steps[padIndex][stepIndex] = newVal
      return { ...prev, steps }
    })
  }, [editMode])

  const handleStepMouseEnter = useCallback((padIndex: number, stepIndex: number) => {
    const paint = paintRef.current
    if (!paint?.active || paint.padIndex !== padIndex) return

    setSequencer(prev => {
      const steps = prev.steps.map(row => [...row])
      steps[padIndex][stepIndex] = paint.paintValue
      return { ...prev, steps }
    })
  }, [])

  // ─── Velocity drag (edit mode) ──────────────────────────────
  const handleVelocityMouseDown = useCallback((padIndex: number, stepIndex: number, e: React.MouseEvent) => {
    const currentVel = sequencerRef.current.steps[padIndex][stepIndex]
    if (currentVel === 0) {
      // If step is off, turn it on at full velocity
      setSequencer(prev => {
        const steps = prev.steps.map(row => [...row])
        steps[padIndex][stepIndex] = 1
        return { ...prev, steps }
      })
      return
    }
    velocityDragRef.current = {
      active: true,
      padIndex,
      stepIndex,
      startY: e.clientY,
      startVelocity: currentVel,
    }
  }, [])

  // Handle drag & drop
  const handleDrop = useCallback((padIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    try {
      const data = e.dataTransfer.getData('application/json')
      if (data) {
        const slice = JSON.parse(data) as Slice
        assignSample(padIndex, slice)
      }
    } catch { /* ignore */ }
  }, [assignSample])

  // Clear all steps
  const clearAll = useCallback(() => {
    setSequencer(prev => ({
      ...prev,
      steps: Array.from({ length: PAD_COUNT }, () => Array(STEPS).fill(0)),
    }))
  }, [])

  const adjustBpm = useCallback((delta: number) => {
    setSequencer(prev => ({
      ...prev,
      bpm: Math.max(40, Math.min(300, prev.bpm + delta)),
    }))
  }, [])

  // ─── Load preset pattern ────────────────────────────────────
  const loadPattern = useCallback((pattern: PresetPattern) => {
    setSequencer(prev => {
      const steps = Array.from({ length: PAD_COUNT }, () => Array(STEPS).fill(0))
      for (const [padStr, stepIndices] of Object.entries(pattern.steps)) {
        const padIndex = parseInt(padStr)
        if (padIndex < PAD_COUNT) {
          for (const stepIdx of stepIndices) {
            if (stepIdx < STEPS) {
              steps[padIndex][stepIdx] = 1
            }
          }
        }
      }
      return { ...prev, steps }
    })
    setShowPatterns(false)
  }, [])

  // Download all samples
  const handleDownloadAll = useCallback(() => {
    const loadedPads = pads.filter(p => p.slice)
    if (loadedPads.length === 0) return
    loadedPads.forEach((pad, i) => {
      setTimeout(() => {
        const link = document.createElement('a')
        link.href = getSliceDownloadUrl(pad.slice!.id)
        link.download = `${pad.slice!.name}.mp3`
        link.click()
      }, i * 200)
    })
  }, [pads])

  const getPadIndex = (row: number, col: number) => (3 - row) * 4 + col
  const loadedPadCount = pads.filter(p => p.slice).length

  return (
    <div className="h-full flex flex-col bg-surface-base">
      {/* Transport Bar */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 bg-surface-raised border-b border-surface-border flex-wrap">
        {/* Play/Stop */}
        <button
          onClick={togglePlay}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all flex-shrink-0 ${
            sequencer.playing
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40'
              : 'bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 border border-accent-primary/40'
          }`}
          title="Play/Stop (Space)"
        >
          {sequencer.playing ? <Square size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>

        {/* Metronome */}
        <button
          onClick={toggleMetronome}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all flex-shrink-0 ${
            sequencer.metronomeOn
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'bg-surface-base text-slate-500 hover:text-slate-300 border border-surface-border'
          }`}
          title="Metronome"
        >
          <Mic size={14} />
        </button>

        {/* Loop */}
        <button
          onClick={toggleLooping}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all flex-shrink-0 ${
            sequencer.looping
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-surface-base text-slate-500 hover:text-slate-300 border border-surface-border'
          }`}
          title="Loop"
        >
          <Repeat size={14} />
        </button>

        <div className="w-px h-6 bg-surface-border mx-0.5" />

        {/* BPM Control */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">BPM</span>
          <div className="flex items-center bg-surface-base border border-surface-border rounded-lg">
            <button
              onClick={() => adjustBpm(-1)}
              className="px-1.5 py-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <ChevronDown size={13} />
            </button>
            <input
              type="number"
              value={sequencer.bpm}
              onChange={(e) => setSequencer(prev => ({ ...prev, bpm: Math.max(40, Math.min(300, Number(e.target.value) || 120)) }))}
              className="w-10 text-center bg-transparent text-white text-sm font-mono focus:outline-none no-spinner"
            />
            <button
              onClick={() => adjustBpm(1)}
              className="px-1.5 py-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <ChevronUp size={13} />
            </button>
          </div>
        </div>

        {/* Tap Tempo */}
        <button
          onClick={handleTapTempo}
          className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white bg-surface-base border border-surface-border rounded-lg transition-colors active:bg-accent-primary/20 active:text-accent-primary active:border-accent-primary/40"
          title="Tap to set BPM"
        >
          TAP
        </button>

        {/* Count-in */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider hidden sm:inline">Count</span>
          <select
            value={sequencer.countInBars}
            onChange={(e) => setSequencer(prev => ({ ...prev, countInBars: Number(e.target.value) }))}
            className="bg-surface-base border border-surface-border rounded-lg text-xs text-slate-300 px-1.5 py-1.5 focus:outline-none focus:border-accent-primary cursor-pointer"
          >
            <option value={0}>Off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
            <option value={4}>4 bars</option>
          </select>
        </div>

        <div className="w-px h-6 bg-surface-border mx-0.5" />

        {/* Pad play mode toggle */}
        <div className="flex items-center bg-surface-base border border-surface-border rounded-lg overflow-hidden">
          <button
            onClick={() => setPadPlayMode('one-shot')}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs transition-colors ${
              padPlayMode === 'one-shot'
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="One-shot: click to play full sample"
          >
            <MousePointerClick size={12} />
            <span className="hidden lg:inline">One-shot</span>
          </button>
          <div className="w-px h-5 bg-surface-border" />
          <button
            onClick={() => setPadPlayMode('hold')}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs transition-colors ${
              padPlayMode === 'hold'
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Hold: plays while you hold, stops on release"
          >
            <Hand size={12} />
            <span className="hidden lg:inline">Hold</span>
          </button>
        </div>

        {/* Edit Mode Toggle */}
        <div className="flex items-center bg-surface-base border border-surface-border rounded-lg overflow-hidden">
          <button
            onClick={() => setEditMode('grid')}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs transition-colors ${
              editMode === 'grid'
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Grid mode"
          >
            <Grid3X3 size={12} />
            <span className="hidden lg:inline">Grid</span>
          </button>
          <div className="w-px h-5 bg-surface-border" />
          <button
            onClick={() => setEditMode('velocity')}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs transition-colors ${
              editMode === 'velocity'
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Velocity editor"
          >
            <BarChart3 size={12} />
            <span className="hidden lg:inline">Velocity</span>
          </button>
        </div>

        {/* Step indicator */}
        <div className="hidden xl:flex items-center gap-0.5 ml-1">
          {Array.from({ length: STEPS }, (_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                sequencer.currentStep === i
                  ? 'bg-accent-primary scale-150'
                  : i % 4 === 0
                    ? 'bg-slate-500'
                    : 'bg-slate-700'
              }`}
            />
          ))}
        </div>

        <div className="flex-1" />

        {/* Count-in display */}
        {countInRemaining > 0 && (
          <div className="px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-400 text-sm font-mono font-bold animate-pulse">
            {Math.ceil(countInRemaining / 4)} bar{Math.ceil(countInRemaining / 4) !== 1 ? 's' : ''}...
          </div>
        )}

        {/* Patterns */}
        <div className="relative">
          <button
            onClick={() => setShowPatterns(!showPatterns)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white bg-surface-base border border-surface-border rounded-lg transition-colors"
            title="Load preset pattern"
          >
            <Layers size={13} />
            <span className="hidden sm:inline">Patterns</span>
          </button>

          {showPatterns && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-surface-raised border border-surface-border rounded-xl shadow-2xl z-50 py-1 max-h-80 overflow-y-auto">
              {PRESET_PATTERNS.map((pattern, i) => (
                <button
                  key={i}
                  onClick={() => loadPattern(pattern)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-overlay text-left transition-colors"
                >
                  <Music size={12} className="text-slate-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-200">{pattern.name}</div>
                    <div className="text-[10px] text-slate-500">{pattern.category}</div>
                  </div>
                </button>
              ))}
              <div className="border-t border-surface-border mt-1 pt-1">
                <button
                  onClick={() => { clearAll(); setShowPatterns(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-overlay text-left transition-colors"
                >
                  <Trash2 size={12} className="text-slate-500" />
                  <span className="text-xs text-slate-400">Clear all steps</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {loadedPadCount > 0 && (
          <button
            onClick={handleDownloadAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white bg-surface-base border border-surface-border rounded-lg transition-colors"
            title="Download all loaded samples"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Export</span>
          </button>
        )}

        <button
          onClick={clearAll}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white bg-surface-base border border-surface-border rounded-lg transition-colors"
        >
          <Trash2 size={13} />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Pad Grid */}
        <div className="flex-shrink-0 p-3 sm:p-4 lg:p-6 flex justify-center lg:justify-start">
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {PAD_KEYS.map((row, rowIdx) =>
              row.map((key, colIdx) => {
                const padIndex = getPadIndex(rowIdx, colIdx)
                const pad = pads[padIndex]
                const isActive = activePads.has(padIndex)
                const hasSteps = sequencer.steps[padIndex].some(v => v > 0)

                return (
                  <button
                    key={padIndex}
                    onClick={() => {
                      if (pad.slice) {
                        triggerPadManual(padIndex)
                      } else {
                        setShowBrowser(padIndex)
                      }
                    }}
                    onMouseUp={() => {
                      if (pad.slice && padPlayMode === 'hold' && activeSourceRef.current?.padIndex === padIndex) {
                        releasePad()
                      }
                    }}
                    onMouseLeave={() => {
                      if (pad.slice && padPlayMode === 'hold' && activeSourceRef.current?.padIndex === padIndex) {
                        releasePad()
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      if (pad.slice) handleClearPad(padIndex)
                      else setShowBrowser(padIndex)
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(padIndex, e)}
                    className={`relative w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 rounded-lg sm:rounded-xl border transition-all duration-75 flex flex-col items-center justify-center gap-0.5 group ${
                      isActive
                        ? `bg-gradient-to-br ${PAD_COLORS[padIndex]} border-white/30 scale-95 shadow-lg`
                        : pad.slice
                          ? `bg-gradient-to-br ${PAD_COLORS[padIndex]} border-surface-border hover:border-white/20`
                          : 'bg-surface-overlay border-surface-border border-dashed hover:border-slate-500'
                    } ${pad.muted ? 'opacity-40' : ''}`}
                  >
                    <span className={`absolute top-1 left-1.5 sm:top-1.5 sm:left-2 text-[9px] sm:text-[10px] font-mono font-bold ${
                      pad.slice ? 'text-white/50' : 'text-slate-600'
                    }`}>
                      {key}
                    </span>

                    {hasSteps && (
                      <div className={`absolute top-1 right-1.5 sm:top-1.5 sm:right-2 w-1.5 h-1.5 rounded-full ${STEP_COLORS[padIndex]}`} />
                    )}

                    {pad.slice ? (
                      <span className="text-[9px] sm:text-[11px] text-white/80 text-center px-1 truncate w-full mt-2">
                        {pad.slice.name.length > 10 ? pad.slice.name.slice(0, 10) + '…' : pad.slice.name}
                      </span>
                    ) : (
                      <span className="text-[9px] sm:text-[10px] text-slate-600">empty</span>
                    )}

                    {pad.slice && (
                      <div className="absolute bottom-1 right-1 sm:bottom-1.5 sm:right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleMute(padIndex) }}
                          className="p-0.5 rounded text-white/40 hover:text-white/80"
                        >
                          {pad.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleClearPad(padIndex) }}
                          className="p-0.5 rounded text-white/40 hover:text-red-400"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Sequencer Grid / Velocity Editor */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-3 sm:p-4 lg:p-6 lg:pl-2">
          <div className="min-w-fit">
            {/* Step numbers */}
            <div className="flex items-center mb-2 ml-[80px] sm:ml-[100px]">
              {Array.from({ length: STEPS }, (_, i) => (
                <div
                  key={i}
                  className={`w-7 sm:w-8 h-5 flex items-center justify-center text-[9px] sm:text-[10px] font-mono ${
                    sequencer.currentStep === i ? 'text-accent-primary font-bold' : i % 4 === 0 ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Sequencer rows */}
            {editMode === 'grid' ? (
              // ─── Grid Mode ────────────────────────────────────────
              <>
                {Array.from({ length: PAD_COUNT }, (_, padIndex) => {
                  const pad = pads[padIndex]
                  if (!pad.slice) return null

                  return (
                    <div key={padIndex} className="flex items-center gap-1 mb-1 group/row">
                      <div className="w-[80px] sm:w-[96px] flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => toggleMute(padIndex)}
                          className={`p-0.5 sm:p-1 rounded transition-colors ${
                            pad.muted ? 'text-red-400' : 'text-slate-500 hover:text-white'
                          }`}
                        >
                          {pad.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                        <span className={`text-[10px] sm:text-[11px] truncate ${pad.muted ? 'text-slate-600 line-through' : 'text-slate-300'}`}>
                          {pad.slice.name.length > 8 ? pad.slice.name.slice(0, 8) + '…' : pad.slice.name}
                        </span>
                      </div>

                      <div className="flex gap-[2px]">
                        {Array.from({ length: STEPS }, (_, stepIdx) => {
                          const vel = sequencer.steps[padIndex][stepIdx]
                          const isActive = vel > 0
                          const isCurrent = sequencer.currentStep === stepIdx
                          const isDownbeat = stepIdx % 4 === 0

                          return (
                            <button
                              key={stepIdx}
                              onMouseDown={(e) => { e.preventDefault(); handleStepMouseDown(padIndex, stepIdx) }}
                              onMouseEnter={() => handleStepMouseEnter(padIndex, stepIdx)}
                              className={`w-7 sm:w-8 h-6 sm:h-7 rounded transition-all select-none ${
                                isActive
                                  ? `${STEP_COLORS[padIndex]} ${isCurrent ? 'brightness-150 scale-105' : 'opacity-80 hover:opacity-100'}`
                                  : isCurrent
                                    ? 'bg-white/10 border border-white/20'
                                    : isDownbeat
                                      ? 'bg-surface-overlay hover:bg-surface-overlay/80 border border-surface-border'
                                      : 'bg-surface-raised hover:bg-surface-overlay border border-transparent'
                              }`}
                            />
                          )
                        })}
                      </div>

                      <div className="w-16 ml-2 opacity-0 group-hover/row:opacity-100 transition-opacity hidden sm:block">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={pad.volume}
                          onChange={(e) => setVolume(padIndex, parseFloat(e.target.value))}
                          className="w-full h-1 appearance-none bg-surface-border rounded-full slider-thumb"
                        />
                      </div>
                    </div>
                  )
                })}
              </>
            ) : (
              // ─── Velocity Mode ────────────────────────────────────
              <>
                {Array.from({ length: PAD_COUNT }, (_, padIndex) => {
                  const pad = pads[padIndex]
                  if (!pad.slice) return null

                  return (
                    <div key={padIndex} className="flex items-end gap-1 mb-1 group/row">
                      <div className="w-[80px] sm:w-[96px] flex items-center gap-1 sm:gap-1.5 flex-shrink-0 pb-1">
                        <button
                          onClick={() => toggleMute(padIndex)}
                          className={`p-0.5 sm:p-1 rounded transition-colors ${
                            pad.muted ? 'text-red-400' : 'text-slate-500 hover:text-white'
                          }`}
                        >
                          {pad.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                        <span className={`text-[10px] sm:text-[11px] truncate ${pad.muted ? 'text-slate-600 line-through' : 'text-slate-300'}`}>
                          {pad.slice.name.length > 8 ? pad.slice.name.slice(0, 8) + '…' : pad.slice.name}
                        </span>
                      </div>

                      <div className="flex gap-[2px] items-end">
                        {Array.from({ length: STEPS }, (_, stepIdx) => {
                          const vel = sequencer.steps[padIndex][stepIdx]
                          const isActive = vel > 0
                          const isCurrent = sequencer.currentStep === stepIdx
                          const isDownbeat = stepIdx % 4 === 0
                          const barHeight = isActive ? Math.max(4, vel * 40) : 0

                          return (
                            <div
                              key={stepIdx}
                              onMouseDown={(e) => { e.preventDefault(); handleVelocityMouseDown(padIndex, stepIdx, e) }}
                              className={`w-7 sm:w-8 h-10 rounded flex items-end justify-center cursor-pointer select-none relative ${
                                isCurrent ? 'bg-white/5' : isDownbeat ? 'bg-surface-overlay/50' : 'bg-surface-raised/50'
                              }`}
                              title={isActive ? `Velocity: ${Math.round(vel * 100)}%` : 'Click to add'}
                            >
                              {isActive ? (
                                <div
                                  className={`w-5 sm:w-6 rounded-t transition-all ${STEP_COLORS[padIndex]} ${isCurrent ? 'brightness-150' : 'opacity-80 hover:opacity-100'}`}
                                  style={{ height: `${barHeight}px` }}
                                />
                              ) : (
                                <div className={`w-5 sm:w-6 h-1 rounded-full ${isDownbeat ? 'bg-surface-border' : 'bg-surface-border/50'}`} />
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <div className="w-16 ml-2 opacity-0 group-hover/row:opacity-100 transition-opacity hidden sm:block pb-1">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={pad.volume}
                          onChange={(e) => setVolume(padIndex, parseFloat(e.target.value))}
                          className="w-full h-1 appearance-none bg-surface-border rounded-full slider-thumb"
                        />
                      </div>
                    </div>
                  )
                })}
              </>
            )}

            {pads.every(p => !p.slice) && (
              <div className="flex items-center justify-center h-32 sm:h-48 text-slate-600 text-xs sm:text-sm">
                Load samples into pads to use the sequencer
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Close patterns dropdown when clicking outside */}
      {showPatterns && (
        <div className="fixed inset-0 z-40" onClick={() => setShowPatterns(false)} />
      )}

      {/* Sample Browser Modal */}
      {showBrowser !== null && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => { setShowBrowser(null); setBrowserSearch(''); stopPreview() }}
        >
          <div
            className="bg-surface-raised border border-surface-border rounded-xl w-full max-w-[520px] max-h-[65vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-surface-border">
              <h3 className="text-sm font-medium text-white mb-3">
                Load sample into pad {Object.entries(KEY_MAP).find(([, v]) => v === showBrowser)?.[0].toUpperCase()}
              </h3>
              <input
                type="text"
                value={browserSearch}
                onChange={(e) => setBrowserSearch(e.target.value)}
                placeholder="Search samples..."
                autoFocus
                className="w-full px-3 py-2 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredSamples.length === 0 ? (
                <div className="text-center text-slate-600 text-sm py-8">No samples found</div>
              ) : (
                filteredSamples.map((sample) => {
                  const isPreviewing = previewingSliceId === sample.id

                  return (
                    <div
                      key={sample.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-overlay transition-colors group"
                    >
                      {/* Preview button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); previewSample(sample) }}
                        className={`w-8 h-8 rounded-md border flex items-center justify-center flex-shrink-0 transition-all ${
                          isPreviewing
                            ? 'bg-accent-primary/20 border-accent-primary/40 text-accent-primary'
                            : 'bg-surface-overlay border-surface-border text-slate-400 hover:text-white hover:border-slate-500'
                        }`}
                        title={isPreviewing ? 'Stop preview' : 'Preview sample'}
                      >
                        {isPreviewing ? <Square size={10} /> : <Play size={11} className="ml-0.5" />}
                      </button>

                      {/* Sample info — click to assign */}
                      <button
                        onClick={() => handleAssignSample(showBrowser, sample)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="text-sm text-slate-200 truncate group-hover:text-white transition-colors">{sample.name}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-2">
                          {sample.bpm && <span>{Math.round(sample.bpm)} BPM</span>}
                          {sample.keyEstimate && <span>{sample.keyEstimate}</span>}
                          {sample.instrumentPrimary && <span>{sample.instrumentPrimary}</span>}
                        </div>
                      </button>

                      {/* Assign button */}
                      <button
                        onClick={() => handleAssignSample(showBrowser, sample)}
                        className="p-1.5 rounded-md text-slate-500 hover:text-accent-primary hover:bg-accent-primary/10 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                        title="Assign to pad"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
