import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { Slice } from '../types'
import { getSliceDownloadUrl } from '../api/client'
import { getGlobalAudioVolume, setGlobalAudioVolume } from '../services/globalAudioVolume'
import { LabAudioEngine, type LabSettings } from '../services/LabAudioEngine'

const PAD_COUNT = 16

export interface PadState {
  slice: Slice | null
  volume: number
  muted: boolean
}

interface DrumRackContextValue {
  pads: PadState[]
  assignSample: (padIndex: number, slice: Slice) => void
  clearPad: (padIndex: number) => void
  toggleMute: (padIndex: number) => void
  setVolume: (padIndex: number, volume: number) => void
  setMasterVolume: (volume: number) => void
  getMasterVolume: () => number
  getAudioBuffer: (sliceId: number) => AudioBuffer | undefined
  getAudioContext: () => AudioContext
  getPadInputNode: (padIndex: number) => AudioNode
  getMasterInputNode: () => AudioNode
  previewSample: (slice: Slice) => void
  stopPreview: () => void
  previewingSliceId: number | null
  padFxSettings: Map<number, LabSettings>
  setPadFxSettings: (padIndex: number, settings: LabSettings) => void
  clearPadFx: (padIndex: number) => void
}

const DrumRackContext = createContext<DrumRackContextValue | null>(null)

export function useDrumRack() {
  const ctx = useContext(DrumRackContext)
  if (!ctx) throw new Error('useDrumRack must be used within DrumRackProvider')
  return ctx
}

export function DrumRackProvider({ children }: { children: React.ReactNode }) {
  const [pads, setPads] = useState<PadState[]>(() =>
    Array.from({ length: PAD_COUNT }, () => ({ slice: null, volume: 0.8, muted: false }))
  )
  const masterVolumeRef = useRef(getGlobalAudioVolume())

  const [previewingSliceId, setPreviewingSliceId] = useState<number | null>(null)
  const [padFxSettings, setPadFxSettingsState] = useState<Map<number, LabSettings>>(() => new Map())
  const padLabEnginesRef = useRef<Map<number, LabAudioEngine>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBuffersRef = useRef<Map<number, AudioBuffer>>(new Map())
  const masterGainRef = useRef<GainNode | null>(null)
  const padGainNodesRef = useRef<GainNode[]>([])
  const previewSourceRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null)

  const ensureAudioRouting = useCallback((ctx: AudioContext) => {
    if (!masterGainRef.current) {
      const masterGain = ctx.createGain()
      masterGain.gain.value = masterVolumeRef.current
      masterGain.connect(ctx.destination)
      masterGainRef.current = masterGain
    }

    if (padGainNodesRef.current.length !== PAD_COUNT) {
      padGainNodesRef.current = Array.from({ length: PAD_COUNT }, (_, index) => {
        const padGain = ctx.createGain()
        const padState = pads[index]
        padGain.gain.value = padState && !padState.muted ? padState.volume : 0
        padGain.connect(masterGainRef.current!)
        return padGain
      })
    }
  }, [pads])

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume()
    }
    ensureAudioRouting(audioContextRef.current)
    return audioContextRef.current
  }, [ensureAudioRouting])

  const getMasterInputNode = useCallback((): AudioNode => {
    const ctx = getAudioContext()
    return masterGainRef.current || ctx.destination
  }, [getAudioContext])

  const getPadInputNode = useCallback((padIndex: number): AudioNode => {
    const ctx = getAudioContext()
    return padGainNodesRef.current[padIndex] || masterGainRef.current || ctx.destination
  }, [getAudioContext])

  const updatePadBusGain = useCallback((padIndex: number, volume: number, muted: boolean) => {
    const ctx = audioContextRef.current
    if (!ctx) return

    ensureAudioRouting(ctx)
    const padGain = padGainNodesRef.current[padIndex]
    if (!padGain) return

    padGain.gain.setValueAtTime(muted ? 0 : volume, ctx.currentTime)
  }, [ensureAudioRouting])

  const loadBuffer = useCallback(async (sliceId: number) => {
    if (audioBuffersRef.current.has(sliceId)) return
    const ctx = getAudioContext()
    try {
      const response = await fetch(getSliceDownloadUrl(sliceId))
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      audioBuffersRef.current.set(sliceId, audioBuffer)
    } catch (e) {
      console.error('Failed to load audio buffer:', e)
    }
  }, [getAudioContext])

  const assignSample = useCallback((padIndex: number, slice: Slice) => {
    setPads(prev => {
      const next = [...prev]
      next[padIndex] = { ...next[padIndex], slice }
      return next
    })
    loadBuffer(slice.id)
  }, [loadBuffer])

  const clearPad = useCallback((padIndex: number) => {
    setPads(prev => {
      const next = [...prev]
      next[padIndex] = { ...next[padIndex], slice: null }
      return next
    })
  }, [])

  const toggleMute = useCallback((padIndex: number) => {
    setPads(prev => {
      const next = [...prev]
      const nextMuted = !next[padIndex].muted
      next[padIndex] = { ...next[padIndex], muted: nextMuted }
      updatePadBusGain(padIndex, next[padIndex].volume, nextMuted)
      return next
    })
  }, [updatePadBusGain])

  const setVolume = useCallback((padIndex: number, volume: number) => {
    setPads(prev => {
      const next = [...prev]
      const clampedVolume = Math.max(0, Math.min(1, volume))
      next[padIndex] = { ...next[padIndex], volume: clampedVolume }
      updatePadBusGain(padIndex, clampedVolume, next[padIndex].muted)
      return next
    })
  }, [updatePadBusGain])

  const setMasterVolume = useCallback((volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume))
    masterVolumeRef.current = clampedVolume
    setGlobalAudioVolume(clampedVolume)

    const ctx = audioContextRef.current
    if (!ctx) return

    ensureAudioRouting(ctx)
    if (!masterGainRef.current) return

    masterGainRef.current.gain.setValueAtTime(clampedVolume, ctx.currentTime)
  }, [ensureAudioRouting])

  const getMasterVolume = useCallback(() => masterVolumeRef.current, [])

  const getAudioBuffer = useCallback((sliceId: number) => {
    return audioBuffersRef.current.get(sliceId)
  }, [])

  const stopPreview = useCallback(() => {
    if (previewSourceRef.current) {
      try { previewSourceRef.current.source.stop() } catch { /* already stopped */ }
      previewSourceRef.current = null
    }
    setPreviewingSliceId(null)
  }, [])

  const previewSample = useCallback(async (slice: Slice) => {
    // If already previewing this slice, stop it
    if (previewSourceRef.current && previewingSliceId === slice.id) {
      stopPreview()
      return
    }
    // Stop any current preview
    stopPreview()

    const ctx = getAudioContext()
    // Load buffer if not cached
    if (!audioBuffersRef.current.has(slice.id)) {
      try {
        const response = await fetch(getSliceDownloadUrl(slice.id))
        const arrayBuffer = await response.arrayBuffer()
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        audioBuffersRef.current.set(slice.id, audioBuffer)
      } catch (e) {
        console.error('Failed to load preview buffer:', e)
        return
      }
    }

    const buffer = audioBuffersRef.current.get(slice.id)
    if (!buffer) return

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = 0.8
    source.connect(gain)
    gain.connect(getMasterInputNode())

    previewSourceRef.current = { source, gain }
    setPreviewingSliceId(slice.id)

    source.onended = () => {
      if (previewSourceRef.current?.source === source) {
        previewSourceRef.current = null
        setPreviewingSliceId(null)
      }
    }

    source.start()
  }, [getAudioContext, getMasterInputNode, stopPreview, previewingSliceId])

  const setPadFxSettings = useCallback((padIndex: number, settings: LabSettings) => {
    setPadFxSettingsState(prev => {
      const next = new Map(prev)
      next.set(padIndex, settings)
      return next
    })
  }, [])

  const clearPadFx = useCallback((padIndex: number) => {
    setPadFxSettingsState(prev => {
      const next = new Map(prev)
      next.delete(padIndex)
      return next
    })
    const engine = padLabEnginesRef.current.get(padIndex)
    if (engine) {
      void engine.dispose()
      padLabEnginesRef.current.delete(padIndex)
    }
  }, [])

  useEffect(() => {
    return () => {
      audioContextRef.current?.close()
      for (const engine of padLabEnginesRef.current.values()) {
        void engine.dispose()
      }
      padLabEnginesRef.current.clear()
    }
  }, [])

  return (
    <DrumRackContext.Provider value={{
      pads,
      assignSample,
      clearPad,
      toggleMute,
      setVolume,
      setMasterVolume,
      getMasterVolume,
      getAudioBuffer,
      getAudioContext,
      getPadInputNode,
      getMasterInputNode,
      previewSample,
      stopPreview,
      previewingSliceId,
      padFxSettings,
      setPadFxSettings,
      clearPadFx,
    }}>
      {children}
    </DrumRackContext.Provider>
  )
}
