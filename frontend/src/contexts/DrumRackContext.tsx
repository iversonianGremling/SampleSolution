import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { Slice } from '../types'
import { getSliceDownloadUrl } from '../api/client'
import { getGlobalAudioVolume, setGlobalAudioVolume } from '../services/globalAudioVolume'
import { DEFAULT_LAB_SETTINGS, type LabSettings } from '../services/LabAudioEngine'

const PAD_COUNT = 16

const cloneDefaultLabSettings = (): LabSettings => ({
  ...DEFAULT_LAB_SETTINGS,
  fxOrder: [...DEFAULT_LAB_SETTINGS.fxOrder],
})

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const createDistortionCurve = (amount: number, samples: number = 32768) => {
  const curve = new Float32Array(samples)
  const k = clamp(amount, 0, 1) * 180
  const deg = Math.PI / 180

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
  }

  return curve
}

const createLinearDistortionCurve = (samples: number = 1024) => {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    curve[i] = (i / (samples - 1)) * 2 - 1
  }
  return curve
}

const LINEAR_DISTORTION_CURVE = createLinearDistortionCurve()

const createImpulseResponse = (
  context: BaseAudioContext,
  durationSeconds: number,
  decay: number,
  dampingHz: number
) => {
  const seconds = clamp(durationSeconds, 0.1, 12)
  const decayAmount = clamp(decay, 0.5, 8)
  const length = Math.max(1, Math.floor(context.sampleRate * seconds))
  const impulse = context.createBuffer(2, length, context.sampleRate)
  const damping = clamp(dampingHz, 600, 20000)
  const nyquist = context.sampleRate * 0.5
  const dampingFactor = clamp(damping / Math.max(1, nyquist), 0.02, 1)

  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const position = i / length
      const envelope = Math.pow(1 - position, decayAmount)
      const dampingEnvelope = Math.pow(1 - position, 1 - dampingFactor)
      data[i] = (Math.random() * 2 - 1) * envelope
      data[i] *= dampingEnvelope
    }
  }

  return impulse
}

interface GlobalFxChain {
  inputNode: GainNode
  highpass: BiquadFilterNode
  peaking: BiquadFilterNode
  lowpass: BiquadFilterNode
  distortion: WaveShaperNode
  compressor: DynamicsCompressorNode
  delayDry: GainNode
  delay: DelayNode
  delayTone: BiquadFilterNode
  delayFeedback: GainNode
  delayWet: GainNode
  reverbDry: GainNode
  reverbConvolver: ConvolverNode
  reverbDamping: BiquadFilterNode
  reverbWet: GainNode
  outputGain: GainNode
  reverbSignature: string
}

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
  globalFxSettings: LabSettings
  setGlobalFxSettings: (settings: LabSettings) => void
  clearGlobalFx: () => void
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
  const [globalFxSettings, setGlobalFxSettingsState] = useState<LabSettings>(() => cloneDefaultLabSettings())
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBuffersRef = useRef<Map<number, AudioBuffer>>(new Map())
  const masterGainRef = useRef<GainNode | null>(null)
  const padGainNodesRef = useRef<GainNode[]>([])
  const globalFxChainRef = useRef<GlobalFxChain | null>(null)
  const globalFxSettingsRef = useRef<LabSettings>(cloneDefaultLabSettings())
  const previewSourceRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null)

  const makeReverbSignature = useCallback((settings: LabSettings) => {
    return [
      clamp(settings.reverbSeconds, 0.1, 12).toFixed(3),
      clamp(settings.reverbDecay, 0.5, 8).toFixed(3),
      clamp(settings.reverbDamping, 600, 18000).toFixed(1),
    ].join('|')
  }, [])

  const createGlobalFxChain = useCallback((ctx: AudioContext) => {
    const inputNode = ctx.createGain()

    const highpass = ctx.createBiquadFilter()
    const peaking = ctx.createBiquadFilter()
    peaking.type = 'peaking'
    const lowpass = ctx.createBiquadFilter()
    const distortion = ctx.createWaveShaper()
    const compressor = ctx.createDynamicsCompressor()

    const delaySplit = ctx.createGain()
    const delayDry = ctx.createGain()
    const delay = ctx.createDelay(3)
    const delayTone = ctx.createBiquadFilter()
    delayTone.type = 'lowpass'
    delayTone.Q.value = 0.0001
    const delayFeedback = ctx.createGain()
    const delayWet = ctx.createGain()
    const delayMerge = ctx.createGain()

    const reverbSplit = ctx.createGain()
    const reverbDry = ctx.createGain()
    const reverbConvolver = ctx.createConvolver()
    const reverbDamping = ctx.createBiquadFilter()
    reverbDamping.type = 'lowpass'
    reverbDamping.Q.value = 0.0001
    const reverbWet = ctx.createGain()
    const reverbMerge = ctx.createGain()

    const outputGain = ctx.createGain()

    inputNode.connect(highpass)
    highpass.connect(peaking)
    peaking.connect(lowpass)
    lowpass.connect(distortion)
    distortion.connect(compressor)
    compressor.connect(delaySplit)

    delaySplit.connect(delayDry)
    delayDry.connect(delayMerge)
    delaySplit.connect(delay)
    delay.connect(delayTone)
    delayTone.connect(delayFeedback)
    delayFeedback.connect(delay)
    delayTone.connect(delayWet)
    delayWet.connect(delayMerge)

    delayMerge.connect(reverbSplit)

    reverbSplit.connect(reverbDry)
    reverbDry.connect(reverbMerge)
    reverbSplit.connect(reverbConvolver)
    reverbConvolver.connect(reverbDamping)
    reverbDamping.connect(reverbWet)
    reverbWet.connect(reverbMerge)

    reverbMerge.connect(outputGain)

    const chain: GlobalFxChain = {
      inputNode,
      highpass,
      peaking,
      lowpass,
      distortion,
      compressor,
      delayDry,
      delay,
      delayTone,
      delayFeedback,
      delayWet,
      reverbDry,
      reverbConvolver,
      reverbDamping,
      reverbWet,
      outputGain,
      reverbSignature: '',
    }

    return chain
  }, [])

  const applyGlobalFxSettings = useCallback((ctx: AudioContext, chain: GlobalFxChain, settings: LabSettings) => {
    const now = ctx.currentTime

    chain.outputGain.gain.setTargetAtTime(clamp(settings.outputGain, 0, 2), now, 0.015)

    chain.highpass.type = settings.highpassEnabled ? 'highpass' : 'allpass'
    chain.highpass.frequency.setTargetAtTime(clamp(settings.highpassFrequency, 20, 18000), now, 0.02)
    chain.highpass.Q.setTargetAtTime(clamp(settings.highpassQ, 0.1, 24), now, 0.02)

    if (settings.peakingEnabled) {
      chain.peaking.type = 'peaking'
      chain.peaking.frequency.setTargetAtTime(clamp(settings.peakingFrequency, 20, 20000), now, 0.02)
      chain.peaking.gain.setTargetAtTime(clamp(settings.peakingGain, -12, 12), now, 0.02)
      chain.peaking.Q.setTargetAtTime(clamp(settings.peakingQ, 0.1, 24), now, 0.02)
    } else {
      chain.peaking.type = 'allpass'
    }

    chain.lowpass.type = settings.lowpassEnabled ? 'lowpass' : 'allpass'
    chain.lowpass.frequency.setTargetAtTime(clamp(settings.lowpassFrequency, 20, 20000), now, 0.02)
    chain.lowpass.Q.setTargetAtTime(clamp(settings.lowpassQ, 0.1, 24), now, 0.02)

    if (settings.distortionEnabled) {
      chain.distortion.curve = createDistortionCurve(clamp(settings.distortionAmount, 0, 1))
      chain.distortion.oversample = '2x'
    } else {
      chain.distortion.curve = LINEAR_DISTORTION_CURVE
      chain.distortion.oversample = 'none'
    }

    if (settings.compressorEnabled) {
      chain.compressor.threshold.setTargetAtTime(clamp(settings.compressorThreshold, -100, 0), now, 0.02)
      chain.compressor.knee.setTargetAtTime(30, now, 0.02)
      chain.compressor.ratio.setTargetAtTime(clamp(settings.compressorRatio, 1, 20), now, 0.02)
      chain.compressor.attack.setTargetAtTime(clamp(settings.compressorAttack, 0, 1), now, 0.02)
      chain.compressor.release.setTargetAtTime(clamp(settings.compressorRelease, 0, 1), now, 0.02)
    } else {
      chain.compressor.threshold.setTargetAtTime(0, now, 0.02)
      chain.compressor.knee.setTargetAtTime(0, now, 0.02)
      chain.compressor.ratio.setTargetAtTime(1, now, 0.02)
      chain.compressor.attack.setTargetAtTime(0, now, 0.02)
      chain.compressor.release.setTargetAtTime(0.01, now, 0.02)
    }

    chain.delayDry.gain.setTargetAtTime(1, now, 0.02)
    chain.delay.delayTime.setTargetAtTime(clamp(settings.delayTime, 0, 2), now, 0.02)
    chain.delayTone.frequency.setTargetAtTime(clamp(settings.delayTone, 600, 18000), now, 0.02)
    chain.delayFeedback.gain.setTargetAtTime(
      settings.delayEnabled ? clamp(settings.delayFeedback, 0, 0.95) : 0,
      now,
      0.02
    )
    chain.delayWet.gain.setTargetAtTime(
      settings.delayEnabled ? clamp(settings.delayMix, 0, 1) : 0,
      now,
      0.02
    )

    chain.reverbDry.gain.setTargetAtTime(1, now, 0.02)
    chain.reverbDamping.frequency.setTargetAtTime(clamp(settings.reverbDamping, 600, 18000), now, 0.02)
    const reverbSignature = makeReverbSignature(settings)
    if (settings.reverbEnabled) {
      if (chain.reverbSignature !== reverbSignature) {
        chain.reverbConvolver.buffer = createImpulseResponse(
          ctx,
          settings.reverbSeconds,
          settings.reverbDecay,
          settings.reverbDamping
        )
        chain.reverbSignature = reverbSignature
      }
      chain.reverbWet.gain.setTargetAtTime(clamp(settings.reverbMix, 0, 1), now, 0.02)
    } else {
      chain.reverbWet.gain.setTargetAtTime(0, now, 0.02)
    }
  }, [makeReverbSignature])

  const ensureAudioRouting = useCallback((ctx: AudioContext) => {
    if (!masterGainRef.current) {
      const masterGain = ctx.createGain()
      masterGain.gain.value = masterVolumeRef.current
      masterGain.connect(ctx.destination)
      masterGainRef.current = masterGain
    }

    if (!globalFxChainRef.current) {
      const chain = createGlobalFxChain(ctx)
      chain.outputGain.connect(masterGainRef.current!)
      globalFxChainRef.current = chain
    }

    if (globalFxChainRef.current) {
      applyGlobalFxSettings(ctx, globalFxChainRef.current, globalFxSettingsRef.current)
    }

    if (padGainNodesRef.current.length !== PAD_COUNT) {
      padGainNodesRef.current = Array.from({ length: PAD_COUNT }, (_, index) => {
        const padGain = ctx.createGain()
        const padState = pads[index]
        padGain.gain.value = padState && !padState.muted ? padState.volume : 0
        padGain.connect(globalFxChainRef.current ? globalFxChainRef.current.inputNode : masterGainRef.current!)
        return padGain
      })
    }
  }, [applyGlobalFxSettings, createGlobalFxChain, pads])

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
    return globalFxChainRef.current?.inputNode || masterGainRef.current || ctx.destination
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
  }, [])

  const setGlobalFxSettings = useCallback((settings: LabSettings) => {
    const next = {
      ...settings,
      fxOrder: Array.isArray(settings.fxOrder) ? [...settings.fxOrder] : [...DEFAULT_LAB_SETTINGS.fxOrder],
    }
    globalFxSettingsRef.current = next
    setGlobalFxSettingsState(next)

    const ctx = audioContextRef.current
    const chain = globalFxChainRef.current
    if (!ctx || !chain) return

    applyGlobalFxSettings(ctx, chain, next)
  }, [applyGlobalFxSettings])

  const clearGlobalFx = useCallback(() => {
    setGlobalFxSettings(cloneDefaultLabSettings())
  }, [setGlobalFxSettings])

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
      globalFxSettings,
      setGlobalFxSettings,
      clearGlobalFx,
    }}>
      {children}
    </DrumRackContext.Provider>
  )
}
