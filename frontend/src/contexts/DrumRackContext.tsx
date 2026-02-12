import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { Slice } from '../types'
import { getSliceDownloadUrl } from '../api/client'

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
  getAudioBuffer: (sliceId: number) => AudioBuffer | undefined
  getAudioContext: () => AudioContext
  previewSample: (slice: Slice) => void
  stopPreview: () => void
  previewingSliceId: number | null
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

  const [previewingSliceId, setPreviewingSliceId] = useState<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBuffersRef = useRef<Map<number, AudioBuffer>>(new Map())
  const previewSourceRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null)

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

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
      next[padIndex] = { ...next[padIndex], muted: !next[padIndex].muted }
      return next
    })
  }, [])

  const setVolume = useCallback((padIndex: number, volume: number) => {
    setPads(prev => {
      const next = [...prev]
      next[padIndex] = { ...next[padIndex], volume }
      return next
    })
  }, [])

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
    gain.connect(ctx.destination)

    previewSourceRef.current = { source, gain }
    setPreviewingSliceId(slice.id)

    source.onended = () => {
      if (previewSourceRef.current?.source === source) {
        previewSourceRef.current = null
        setPreviewingSliceId(null)
      }
    }

    source.start()
  }, [getAudioContext, stopPreview, previewingSliceId])

  useEffect(() => {
    return () => {
      audioContextRef.current?.close()
    }
  }, [])

  return (
    <DrumRackContext.Provider value={{
      pads,
      assignSample,
      clearPad,
      toggleMute,
      setVolume,
      getAudioBuffer,
      getAudioContext,
      previewSample,
      stopPreview,
      previewingSliceId,
    }}>
      {children}
    </DrumRackContext.Provider>
  )
}
