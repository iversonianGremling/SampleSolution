// cspell:ignore soundtouchjs
import { getGlobalAudioVolume } from './globalAudioVolume'
import { SoundTouch, SimpleFilter, WebAudioBufferSource, getWebAudioNode } from 'soundtouchjs'

export type LabPitchMode = 'tape' | 'granular' | 'hq'
export type FxSlotId = 'filter' | 'distortion' | 'compressor' | 'delay' | 'reverb'

export const DEFAULT_FX_ORDER: FxSlotId[] = ['filter', 'distortion', 'compressor', 'delay', 'reverb']

export interface LabSettings {
  offset: number
  pitchSemitones: number
  pitchMode: LabPitchMode
  preserveFormants: boolean
  velocity: number
  fadeIn: number
  fadeOut: number
  lowpassEnabled: boolean
  lowpassFrequency: number
  lowpassQ: number
  highpassEnabled: boolean
  highpassFrequency: number
  highpassQ: number
  peakingEnabled: boolean
  peakingFrequency: number
  peakingGain: number
  peakingQ: number
  delayEnabled: boolean
  delayTime: number
  delayFeedback: number
  delayMix: number
  delayTone: number
  compressorEnabled: boolean
  compressorThreshold: number
  compressorRatio: number
  compressorAttack: number
  compressorRelease: number
  reverbEnabled: boolean
  reverbSeconds: number
  reverbDecay: number
  reverbMix: number
  reverbDamping: number
  distortionEnabled: boolean
  distortionAmount: number
  tempo: number
  outputGain: number
  fxOrder: FxSlotId[]
}

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  offset: 0,
  pitchSemitones: 0,
  pitchMode: 'hq',
  preserveFormants: false,
  velocity: 1,
  fadeIn: 0,
  fadeOut: 0,
  lowpassEnabled: true,
  lowpassFrequency: 18000,
  lowpassQ: 0.7,
  highpassEnabled: true,
  highpassFrequency: 20,
  highpassQ: 0.7,
  peakingEnabled: false,
  peakingFrequency: 1000,
  peakingGain: 0,
  peakingQ: 1,
  delayEnabled: false,
  delayTime: 0.22,
  delayFeedback: 0.28,
  delayMix: 0.2,
  delayTone: 12000,
  compressorEnabled: false,
  compressorThreshold: -24,
  compressorRatio: 4,
  compressorAttack: 0.003,
  compressorRelease: 0.2,
  reverbEnabled: false,
  reverbSeconds: 1.5,
  reverbDecay: 2.2,
  reverbMix: 0.2,
  reverbDamping: 11000,
  distortionEnabled: false,
  distortionAmount: 0.22,
  tempo: 1,
  outputGain: 1,
  fxOrder: ['filter', 'distortion', 'compressor', 'delay', 'reverb'],
}

type WaveformListener = (samples: Float32Array) => void
type AnimationHandle = ReturnType<typeof globalThis.setTimeout> | number
type PitchShiftQuality = 'granular' | 'hq'

interface SoundTouchProfile {
  bufferSize: number
  sequenceMs: number
  seekWindowMs: number
  overlapMs: number
  quickSeek: boolean
}

const SOUND_TOUCH_PROFILES: Record<PitchShiftQuality, SoundTouchProfile> = {
  granular: {
    bufferSize: 2048,
    sequenceMs: 56,
    seekWindowMs: 18,
    overlapMs: 8,
    quickSeek: true,
  },
  hq: {
    bufferSize: 4096,
    sequenceMs: 82,
    seekWindowMs: 24,
    overlapMs: 12,
    quickSeek: false,
  },
}

interface RealtimeFxChain {
  inputNode: AudioNode
  envelopeNode: GainNode
  analyser: AnalyserNode
  nodes: AudioNode[]
  velocityGain: GainNode
  formantLowShelf: BiquadFilterNode
  formantHighShelf: BiquadFilterNode
  outputGain: GainNode
  highpass: BiquadFilterNode
  peaking: BiquadFilterNode
  lowpass: BiquadFilterNode
  distortion: WaveShaperNode
  compressor: DynamicsCompressorNode
  delaySplit: GainNode
  delayDry: GainNode
  delay: DelayNode
  delayTone: BiquadFilterNode
  delayFeedback: GainNode
  delayWet: GainNode
  delayMerge: GainNode
  reverbSplit: GainNode
  reverbDry: GainNode
  reverbConvolver: ConvolverNode
  reverbDamping: BiquadFilterNode
  reverbWet: GainNode
  reverbMerge: GainNode
  reverbSignature: string
}

const scheduleFrame = (callback: FrameRequestCallback): AnimationHandle => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback)
  }
  return globalThis.setTimeout(() => callback(performance.now()), 16)
}

const cancelFrame = (id: AnimationHandle) => {
  if (typeof id === 'number' && typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(id)
    return
  }
  globalThis.clearTimeout(id)
}

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const yieldToMainThread = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const writeString = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
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

const hannWindow = (size: number) => {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return window
}

const resampleLinear = async (input: Float32Array, ratio: number) => {
  const safeRatio = Math.max(0.01, ratio)
  const outputLength = Math.max(1, Math.floor(input.length / safeRatio))
  const output = new Float32Array(outputLength)

  const chunkSize = 65536
  for (let start = 0; start < outputLength; start += chunkSize) {
    const end = Math.min(start + chunkSize, outputLength)
    for (let i = start; i < end; i++) {
      const sourcePos = i * safeRatio
      const index = Math.floor(sourcePos)
      const nextIndex = Math.min(index + 1, input.length - 1)
      const frac = sourcePos - index
      const valueA = input[index] || 0
      const valueB = input[nextIndex] || 0
      output[i] = valueA + (valueB - valueA) * frac
    }
    await yieldToMainThread()
  }

  return output
}

const granularTimeStretch = async (
  input: Float32Array,
  stretch: number,
  grainSize: number,
  overlap: number
) => {
  const stretchAmount = clamp(stretch, 0.25, 4)
  const outputLength = Math.max(1, Math.floor(input.length * stretchAmount))
  const output = new Float32Array(outputLength)
  const weights = new Float32Array(outputLength)

  const safeGrain = Math.max(128, grainSize)
  const safeOverlap = clamp(overlap, 0.1, 0.95)
  const analysisHop = Math.max(1, Math.floor(safeGrain * (1 - safeOverlap)))
  const synthesisHop = Math.max(1, Math.floor(analysisHop * stretchAmount))
  const window = hannWindow(safeGrain)

  let inputPos = 0
  let outputPos = 0
  let grainsSinceYield = 0

  while (inputPos + safeGrain < input.length && outputPos < outputLength) {
    for (let i = 0; i < safeGrain; i++) {
      const outIndex = outputPos + i
      if (outIndex >= outputLength) break
      const value = input[inputPos + i] || 0
      const w = window[i]
      output[outIndex] += value * w
      weights[outIndex] += w
    }

    inputPos += analysisHop
    outputPos += synthesisHop

    grainsSinceYield += 1
    if (grainsSinceYield >= 8) {
      grainsSinceYield = 0
      await yieldToMainThread()
    }
  }

  const normalizeChunkSize = 65536
  for (let start = 0; start < outputLength; start += normalizeChunkSize) {
    const end = Math.min(start + normalizeChunkSize, outputLength)
    for (let i = start; i < end; i++) {
      if (weights[i] > 0.000001) {
        output[i] /= weights[i]
      }
    }
    await yieldToMainThread()
  }

  return output
}

const trimBufferFromOffset = (source: AudioBuffer, offsetSeconds: number) => {
  const safeOffset = clamp(offsetSeconds, 0, Math.max(0, source.duration - 0.0001))
  const startSample = Math.floor(safeOffset * source.sampleRate)
  const length = Math.max(1, source.length - startSample)
  const trimmed = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length,
    sampleRate: source.sampleRate,
  })

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = source.getChannelData(channel)
    const outData = trimmed.getChannelData(channel)
    outData.set(sourceData.subarray(startSample, startSample + length))
  }

  return trimmed
}

interface FormantCompensationSettings {
  enabled: boolean
  lowFrequency: number
  highFrequency: number
  lowGainDb: number
  highGainDb: number
}

const getFormantCompensationSettings = (
  settings: Pick<LabSettings, 'pitchMode' | 'pitchSemitones' | 'preserveFormants'>
): FormantCompensationSettings => {
  const semitones = Number.isFinite(settings.pitchSemitones) ? settings.pitchSemitones : 0

  if (!settings.preserveFormants || settings.pitchMode === 'tape' || Math.abs(semitones) < 0.01) {
    return {
      enabled: false,
      lowFrequency: 750,
      highFrequency: 2800,
      lowGainDb: 0,
      highGainDb: 0,
    }
  }

  const magnitude = clamp(Math.abs(semitones) / 12, 0, 1.5)
  const baseGain = magnitude * 7
  const shiftingUp = semitones > 0

  return {
    enabled: true,
    lowFrequency: 750,
    highFrequency: 2800,
    lowGainDb: shiftingUp ? baseGain * 0.82 : -baseGain * 0.82,
    highGainDb: shiftingUp ? -baseGain : baseGain,
  }
}

const pitchShiftPreservingDuration = async (
  source: AudioBuffer,
  semitones: number,
  quality: 'granular' | 'hq'
) => {
  const ratio = Math.pow(2, semitones / 12)
  if (Math.abs(ratio - 1) < 0.00001) return source

  const grainSize = quality === 'hq' ? 4096 : 1024
  const overlap = quality === 'hq' ? 0.86 : 0.64

  const shifted = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: source.length,
    sampleRate: source.sampleRate,
  })

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const inData = source.getChannelData(channel)
    const resampled = await resampleLinear(inData, ratio)
    const stretched = await granularTimeStretch(resampled, ratio, grainSize, overlap)
    const outData = shifted.getChannelData(channel)

    if (stretched.length >= outData.length) {
      outData.set(stretched.subarray(0, outData.length))
    } else {
      outData.set(stretched)
      outData.fill(0, stretched.length)
    }

    await yieldToMainThread()
  }

  return shifted
}

const getPitchShiftQualityFromMode = (mode: LabPitchMode): PitchShiftQuality =>
  mode === 'hq' ? 'hq' : 'granular'

const configureSoundTouchProcessor = (
  soundTouch: SoundTouch,
  sampleRate: number,
  quality: PitchShiftQuality
): SoundTouchProfile => {
  const profile = SOUND_TOUCH_PROFILES[quality]
  soundTouch.stretch.setParameters(
    sampleRate,
    profile.sequenceMs,
    profile.seekWindowMs,
    profile.overlapMs
  )
  soundTouch.stretch.quickSeek = profile.quickSeek
  return profile
}

const processPitchAndTempoWithGranularFallback = async (
  source: AudioBuffer,
  semitones: number,
  tempo: number,
  quality: PitchShiftQuality
): Promise<AudioBuffer> => {
  const safeTempo = clamp(tempo, 0.25, 4)
  const needsPitchShift = Math.abs(semitones) > 0.001
  const needsTempoChange = Math.abs(safeTempo - 1) > 0.001

  if (!needsPitchShift && !needsTempoChange) {
    return source
  }

  const pitched = needsPitchShift
    ? await pitchShiftPreservingDuration(source, semitones, quality)
    : source

  if (!needsTempoChange) {
    return pitched
  }

  const grainSize = quality === 'hq' ? 4096 : 1024
  const overlap = quality === 'hq' ? 0.86 : 0.64
  const stretchFactor = 1 / safeTempo
  const stretched = new AudioBuffer({
    numberOfChannels: pitched.numberOfChannels,
    length: Math.max(1, Math.floor(pitched.length * stretchFactor)),
    sampleRate: pitched.sampleRate,
  })

  for (let channel = 0; channel < pitched.numberOfChannels; channel++) {
    const inData = pitched.getChannelData(channel)
    const stretchedData = await granularTimeStretch(inData, stretchFactor, grainSize, overlap)
    const outData = stretched.getChannelData(channel)

    if (stretchedData.length >= outData.length) {
      outData.set(stretchedData.subarray(0, outData.length))
    } else {
      outData.set(stretchedData)
      outData.fill(0, stretchedData.length)
    }

    await yieldToMainThread()
  }

  return stretched
}

const processPitchAndTempoWithSoundTouch = async (
  source: AudioBuffer,
  semitones: number,
  tempo: number,
  quality: PitchShiftQuality
): Promise<AudioBuffer> => {
  const safeTempo = clamp(tempo, 0.25, 4)
  const soundTouch = new SoundTouch()
  const profile = configureSoundTouchProcessor(soundTouch, source.sampleRate, quality)

  soundTouch.pitchSemitones = semitones
  soundTouch.tempo = safeTempo

  const sourceProvider = new WebAudioBufferSource(source)
  const filter = new SimpleFilter(sourceProvider, soundTouch, () => {
    // no-op: offline extraction stops once frames are exhausted
  })

  const frameBlock = Math.max(1024, profile.bufferSize)
  const scratch = new Float32Array(frameBlock * 2)
  const chunks: Float32Array[] = []
  let totalFrames = 0

  while (true) {
    const extractedFrames = filter.extract(scratch, frameBlock)
    if (extractedFrames <= 0) break

    chunks.push(scratch.slice(0, extractedFrames * 2))
    totalFrames += extractedFrames

    if (chunks.length % 24 === 0) {
      await yieldToMainThread()
    }
  }

  if (totalFrames <= 0) {
    return source
  }

  const rendered = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: totalFrames,
    sampleRate: source.sampleRate,
  })

  const leftOut = rendered.getChannelData(0)
  const rightOut = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : null
  let frameOffset = 0

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]
    const frames = Math.floor(chunk.length / 2)

    for (let i = 0; i < frames; i++) {
      const base = i * 2
      leftOut[frameOffset + i] = chunk[base]
      if (rightOut) {
        rightOut[frameOffset + i] = chunk[base + 1]
      }
    }

    frameOffset += frames

    if (chunkIndex % 24 === 23) {
      await yieldToMainThread()
    }
  }

  return rendered
}

const processPitchAndTempoPreservingDuration = async (
  source: AudioBuffer,
  semitones: number,
  tempo: number,
  quality: PitchShiftQuality
): Promise<AudioBuffer> => {
  const safeTempo = clamp(tempo, 0.25, 4)
  const needsPitchShift = Math.abs(semitones) > 0.001
  const needsTempoChange = Math.abs(safeTempo - 1) > 0.001

  if (!needsPitchShift && !needsTempoChange) {
    return source
  }

  // SoundTouchJS is stereo-first; keep a safe fallback for uncommon channel layouts.
  if (source.numberOfChannels > 2) {
    return processPitchAndTempoWithGranularFallback(source, semitones, safeTempo, quality)
  }

  try {
    return await processPitchAndTempoWithSoundTouch(source, semitones, safeTempo, quality)
  } catch (error) {
    console.warn('SoundTouch pitch processing failed; falling back to granular algorithm.', error)
    return processPitchAndTempoWithGranularFallback(source, semitones, safeTempo, quality)
  }
}

export async function renderLabAudioBuffer(
  source: AudioBuffer,
  settings: LabSettings
): Promise<AudioBuffer> {
  const trimmed = trimBufferFromOffset(source, settings.offset)
  const pitchRatio = Math.pow(2, settings.pitchSemitones / 12)
  const isTapeMode = settings.pitchMode === 'tape'
  const nonTapeQuality = getPitchShiftQualityFromMode(settings.pitchMode)
  const timePitchProcessed =
    !isTapeMode
      ? await processPitchAndTempoPreservingDuration(
          trimmed,
          settings.pitchSemitones,
          settings.tempo,
          nonTapeQuality
        )
      : trimmed

  const playbackRate = isTapeMode ? clamp(pitchRatio, 0.25, 4) : 1
  const baseDuration = timePitchProcessed.duration / playbackRate
  const delayTail = settings.delayEnabled ? clamp(settings.delayTime, 0, 2) * 3.8 : 0
  const reverbTail = settings.reverbEnabled
    ? clamp(settings.reverbSeconds, 0.1, 12) * (1 + clamp(settings.reverbDecay, 0.5, 8) * 0.35)
    : 0
  const totalDuration = Math.max(0.05, baseDuration + delayTail + reverbTail)

  const offline = new OfflineAudioContext(
    timePitchProcessed.numberOfChannels,
    Math.ceil(totalDuration * timePitchProcessed.sampleRate),
    timePitchProcessed.sampleRate
  )

  const sourceNode = offline.createBufferSource()
  sourceNode.buffer = timePitchProcessed
  sourceNode.playbackRate.value = playbackRate

  const fadeGain = offline.createGain()
  const velocityGain = offline.createGain()
  velocityGain.gain.value = clamp(settings.velocity, 0, 1)
  const outputGain = offline.createGain()
  outputGain.gain.value = clamp(settings.outputGain, 0, 2)

  sourceNode.connect(fadeGain)
  fadeGain.connect(velocityGain)

  const formantCompensation = getFormantCompensationSettings(settings)
  let serialNode: AudioNode = velocityGain
  if (formantCompensation.enabled) {
    const formantLowShelf = offline.createBiquadFilter()
    formantLowShelf.type = 'lowshelf'
    formantLowShelf.frequency.value = clamp(formantCompensation.lowFrequency, 80, 4000)
    formantLowShelf.gain.value = clamp(formantCompensation.lowGainDb, -24, 24)

    const formantHighShelf = offline.createBiquadFilter()
    formantHighShelf.type = 'highshelf'
    formantHighShelf.frequency.value = clamp(formantCompensation.highFrequency, 400, 12000)
    formantHighShelf.gain.value = clamp(formantCompensation.highGainDb, -24, 24)

    serialNode.connect(formantLowShelf)
    formantLowShelf.connect(formantHighShelf)
    serialNode = formantHighShelf
  }

  const fxOrder = settings.fxOrder || DEFAULT_FX_ORDER

  for (const slotId of fxOrder) {
    switch (slotId) {
      case 'filter': {
        if (settings.highpassEnabled) {
          const hp = offline.createBiquadFilter()
          hp.type = 'highpass'
          hp.frequency.value = clamp(settings.highpassFrequency, 20, 18000)
          hp.Q.value = clamp(settings.highpassQ, 0.1, 24)
          serialNode.connect(hp)
          serialNode = hp
        }
        if (settings.peakingEnabled) {
          const pk = offline.createBiquadFilter()
          pk.type = 'peaking'
          pk.frequency.value = clamp(settings.peakingFrequency, 20, 20000)
          pk.gain.value = clamp(settings.peakingGain, -12, 12)
          pk.Q.value = clamp(settings.peakingQ, 0.1, 24)
          serialNode.connect(pk)
          serialNode = pk
        }
        if (settings.lowpassEnabled) {
          const lp = offline.createBiquadFilter()
          lp.type = 'lowpass'
          lp.frequency.value = clamp(settings.lowpassFrequency, 20, 20000)
          lp.Q.value = clamp(settings.lowpassQ, 0.1, 24)
          serialNode.connect(lp)
          serialNode = lp
        }
        break
      }
      case 'distortion': {
        if (settings.distortionEnabled) {
          const shaper = offline.createWaveShaper()
          shaper.curve = createDistortionCurve(clamp(settings.distortionAmount, 0, 1))
          shaper.oversample = '2x'
          serialNode.connect(shaper)
          serialNode = shaper
        }
        break
      }
      case 'compressor': {
        if (settings.compressorEnabled) {
          const comp = offline.createDynamicsCompressor()
          comp.threshold.value = clamp(settings.compressorThreshold, -100, 0)
          comp.ratio.value = clamp(settings.compressorRatio, 1, 20)
          comp.attack.value = clamp(settings.compressorAttack, 0, 1)
          comp.release.value = clamp(settings.compressorRelease, 0, 1)
          serialNode.connect(comp)
          serialNode = comp
        }
        break
      }
      case 'delay': {
        if (settings.delayEnabled) {
          const split = offline.createGain()
          const dry = offline.createGain()
          const delay = offline.createDelay(3)
          const delayTone = offline.createBiquadFilter()
          delayTone.type = 'lowpass'
          const feedback = offline.createGain()
          const wet = offline.createGain()
          const merge = offline.createGain()

          delay.delayTime.value = clamp(settings.delayTime, 0, 2)
          delayTone.frequency.value = clamp(settings.delayTone, 600, 18000)
          delayTone.Q.value = 0.0001
          feedback.gain.value = clamp(settings.delayFeedback, 0, 0.95)
          wet.gain.value = clamp(settings.delayMix, 0, 1)

          serialNode.connect(split)
          split.connect(dry)
          dry.connect(merge)
          split.connect(delay)
          delay.connect(delayTone)
          delayTone.connect(feedback)
          feedback.connect(delay)
          delayTone.connect(wet)
          wet.connect(merge)

          serialNode = merge
        }
        break
      }
      case 'reverb': {
        if (settings.reverbEnabled) {
          const split = offline.createGain()
          const dry = offline.createGain()
          const convolver = offline.createConvolver()
          const damping = offline.createBiquadFilter()
          damping.type = 'lowpass'
          const wet = offline.createGain()
          const merge = offline.createGain()

          convolver.buffer = createImpulseResponse(
            offline,
            settings.reverbSeconds,
            settings.reverbDecay,
            settings.reverbDamping
          )
          damping.frequency.value = clamp(settings.reverbDamping, 600, 18000)
          damping.Q.value = 0.0001
          wet.gain.value = clamp(settings.reverbMix, 0, 1)

          serialNode.connect(split)
          split.connect(dry)
          dry.connect(merge)
          split.connect(convolver)
          convolver.connect(damping)
          damping.connect(wet)
          wet.connect(merge)

          serialNode = merge
        }
        break
      }
    }
  }

  serialNode.connect(outputGain)
  outputGain.connect(offline.destination)

  const envelope = fadeGain.gain
  const fadeIn = clamp(settings.fadeIn, 0, baseDuration)
  const fadeOut = clamp(settings.fadeOut, 0, baseDuration)

  if (fadeIn > 0) {
    envelope.setValueAtTime(0, 0)
    envelope.linearRampToValueAtTime(1, fadeIn)
  } else {
    envelope.setValueAtTime(1, 0)
  }

  if (fadeOut > 0) {
    const start = Math.max(fadeIn, baseDuration - fadeOut)
    envelope.setValueAtTime(1, start)
    envelope.linearRampToValueAtTime(0, baseDuration)
  }

  sourceNode.start(0, 0)
  sourceNode.stop(baseDuration)

  return offline.startRendering()
}

export function audioBufferToWavArrayBuffer(audioBuffer: AudioBuffer): ArrayBuffer {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = audioBuffer.length * blockAlign

  const wav = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wav)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = clamp(audioBuffer.getChannelData(channel)[i], -1, 1)
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return wav
}

export async function audioBufferToWavArrayBufferAsync(audioBuffer: AudioBuffer): Promise<ArrayBuffer> {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = audioBuffer.length * blockAlign

  const wav = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wav)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const channelData: Float32Array[] = []
  for (let channel = 0; channel < channels; channel++) {
    channelData.push(audioBuffer.getChannelData(channel))
  }

  let offset = 44
  const frameChunk = 16384
  for (let frameStart = 0; frameStart < audioBuffer.length; frameStart += frameChunk) {
    const frameEnd = Math.min(frameStart + frameChunk, audioBuffer.length)
    for (let i = frameStart; i < frameEnd; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = clamp(channelData[channel][i], -1, 1)
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      }
    }
    await yieldToMainThread()
  }

  return wav
}

class RealtimeSoundTouchShifter {
  private readonly soundTouch: SoundTouch
  private readonly node: ScriptProcessorNode

  constructor(
    context: AudioContext,
    buffer: AudioBuffer,
    quality: PitchShiftQuality,
    onEnded?: () => void
  ) {
    this.soundTouch = new SoundTouch()
    const profile = configureSoundTouchProcessor(this.soundTouch, context.sampleRate, quality)
    const source = new WebAudioBufferSource(buffer)
    const filter = new SimpleFilter(source, this.soundTouch, onEnded)
    this.node = getWebAudioNode(context, filter, () => {
      // no-op: waveform timing is handled elsewhere
    }, profile.bufferSize)
  }

  setSettings(tempo: number, pitchSemitones: number) {
    this.soundTouch.tempo = clamp(tempo, 0.25, 4)
    this.soundTouch.pitchSemitones = pitchSemitones
  }

  connect(toNode: AudioNode) {
    this.node.connect(toNode)
  }

  disconnect() {
    this.node.disconnect()
  }
}

export class LabAudioEngine {
  private context: AudioContext | null = null
  private activeSource: AudioBufferSourceNode | null = null
  private activePitchShifter: RealtimeSoundTouchShifter | null = null
  private activeChain: RealtimeFxChain | null = null
  private activeNodes: AudioNode[] = []
  private analyser: AnalyserNode | null = null
  private waveformListeners = new Set<WaveformListener>()
  private waveformFrameHandle: AnimationHandle | null = null
  private endedNotified = true

  private getContext() {
    if (!this.context) {
      this.context = new AudioContext()
    }
    return this.context
  }

  private async ensureContextResumed() {
    const ctx = this.getContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    return ctx
  }

  async decodeFromUrl(url: string) {
    const ctx = await this.ensureContextResumed()
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch audio (${response.status})`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return ctx.decodeAudioData(arrayBuffer.slice(0))
  }

  subscribeWaveform(listener: WaveformListener) {
    this.waveformListeners.add(listener)
    return () => {
      this.waveformListeners.delete(listener)
    }
  }

  private emitWaveform(samples: Float32Array) {
    for (const listener of this.waveformListeners) {
      listener(samples)
    }
  }

  private startWaveformPump() {
    if (!this.analyser) return
    if (this.waveformFrameHandle !== null) return

    const analyser = this.analyser
    const byteData = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!this.analyser || this.analyser !== analyser) {
        this.waveformFrameHandle = null
        return
      }

      analyser.getByteTimeDomainData(byteData)
      const frame = new Float32Array(byteData.length)
      for (let i = 0; i < byteData.length; i++) {
        frame[i] = (byteData[i] - 128) / 128
      }

      this.emitWaveform(frame)
      this.waveformFrameHandle = scheduleFrame(tick)
    }

    this.waveformFrameHandle = scheduleFrame(tick)
  }

  private stopWaveformPump() {
    if (this.waveformFrameHandle !== null) {
      cancelFrame(this.waveformFrameHandle)
      this.waveformFrameHandle = null
    }
    this.emitWaveform(new Float32Array(0))
  }

  private createRealtimeFxChain(settings: LabSettings): RealtimeFxChain {
    const ctx = this.getContext()

    const fadeGain = ctx.createGain()
    const velocityGain = ctx.createGain()
    const formantLowShelf = ctx.createBiquadFilter()
    formantLowShelf.type = 'lowshelf'
    const formantHighShelf = ctx.createBiquadFilter()
    formantHighShelf.type = 'highshelf'

    const highpass = ctx.createBiquadFilter()
    const peaking = ctx.createBiquadFilter()
    peaking.type = 'peaking'
    const lowpass = ctx.createBiquadFilter()
    const distortion = ctx.createWaveShaper()
    const compressor = ctx.createDynamicsCompressor()

    const outputGain = ctx.createGain()

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.72

    // Delay module nodes
    const delaySplit = ctx.createGain()
    const delayDry = ctx.createGain()
    const delay = ctx.createDelay(3)
    const delayTone = ctx.createBiquadFilter()
    delayTone.type = 'lowpass'
    delayTone.Q.value = 0.0001
    const delayFeedback = ctx.createGain()
    const delayWet = ctx.createGain()
    const delayMerge = ctx.createGain()

    // Delay internal connections
    delaySplit.connect(delayDry)
    delayDry.connect(delayMerge)
    delaySplit.connect(delay)
    delay.connect(delayTone)
    delayTone.connect(delayFeedback)
    delayFeedback.connect(delay)
    delayTone.connect(delayWet)
    delayWet.connect(delayMerge)

    // Reverb module nodes
    const reverbSplit = ctx.createGain()
    const reverbDry = ctx.createGain()
    const reverbConvolver = ctx.createConvolver()
    const reverbDamping = ctx.createBiquadFilter()
    reverbDamping.type = 'lowpass'
    reverbDamping.Q.value = 0.0001
    const reverbWet = ctx.createGain()
    const reverbMerge = ctx.createGain()

    // Reverb internal connections
    reverbSplit.connect(reverbDry)
    reverbDry.connect(reverbMerge)
    reverbSplit.connect(reverbConvolver)
    reverbConvolver.connect(reverbDamping)
    reverbDamping.connect(reverbWet)
    reverbWet.connect(reverbMerge)

    // Filter internal connection
    highpass.connect(peaking)
    peaking.connect(lowpass)

    // Build serial chain based on fxOrder
    fadeGain.connect(velocityGain)
    velocityGain.connect(formantLowShelf)
    formantLowShelf.connect(formantHighShelf)

    const fxOrder = settings.fxOrder || DEFAULT_FX_ORDER

    const moduleIO: Record<string, { input: AudioNode; output: AudioNode }> = {
      filter: { input: highpass, output: lowpass },
      distortion: { input: distortion, output: distortion },
      compressor: { input: compressor, output: compressor },
      delay: { input: delaySplit, output: delayMerge },
      reverb: { input: reverbSplit, output: reverbMerge },
    }

    let currentNode: AudioNode = formantHighShelf
    for (const slotId of fxOrder) {
      const mod = moduleIO[slotId]
      if (mod) {
        currentNode.connect(mod.input)
        currentNode = mod.output
      }
    }
    currentNode.connect(outputGain)

    const nodes: AudioNode[] = [
      fadeGain,
      velocityGain,
      formantLowShelf,
      formantHighShelf,
      highpass,
      peaking,
      lowpass,
      distortion,
      compressor,
      delaySplit,
      delayDry,
      delay,
      delayTone,
      delayFeedback,
      delayWet,
      delayMerge,
      reverbSplit,
      reverbDry,
      reverbConvolver,
      reverbDamping,
      reverbWet,
      reverbMerge,
      outputGain,
      analyser,
    ]

    outputGain.connect(analyser)
    analyser.connect(ctx.destination)

    const chain: RealtimeFxChain = {
      inputNode: fadeGain,
      envelopeNode: fadeGain,
      analyser,
      nodes,
      velocityGain,
      formantLowShelf,
      formantHighShelf,
      outputGain,
      highpass,
      peaking,
      lowpass,
      distortion,
      compressor,
      delaySplit,
      delayDry,
      delay,
      delayTone,
      delayFeedback,
      delayWet,
      delayMerge,
      reverbSplit,
      reverbDry,
      reverbConvolver,
      reverbDamping,
      reverbWet,
      reverbMerge,
      reverbSignature: '',
    }

    this.applyRealtimeSettingsToChain(chain, settings)

    return chain
  }

  private makeReverbSignature(settings: LabSettings) {
    return [
      clamp(settings.reverbSeconds, 0.1, 12).toFixed(3),
      clamp(settings.reverbDecay, 0.5, 8).toFixed(3),
      clamp(settings.reverbDamping, 600, 18000).toFixed(1),
    ].join('|')
  }

  private applyRealtimeSettingsToChain(chain: RealtimeFxChain, settings: LabSettings) {
    const ctx = this.getContext()
    const now = ctx.currentTime

    chain.velocityGain.gain.setTargetAtTime(clamp(settings.velocity, 0, 1), now, 0.015)
    chain.outputGain.gain.setTargetAtTime(
      clamp(settings.outputGain, 0, 2) * clamp(getGlobalAudioVolume(), 0, 1),
      now,
      0.015
    )

    const formantCompensation = getFormantCompensationSettings(settings)
    chain.formantLowShelf.frequency.setTargetAtTime(
      clamp(formantCompensation.lowFrequency, 80, 4000),
      now,
      0.02
    )
    chain.formantLowShelf.gain.setTargetAtTime(
      formantCompensation.enabled ? clamp(formantCompensation.lowGainDb, -24, 24) : 0,
      now,
      0.03
    )
    chain.formantHighShelf.frequency.setTargetAtTime(
      clamp(formantCompensation.highFrequency, 400, 12000),
      now,
      0.02
    )
    chain.formantHighShelf.gain.setTargetAtTime(
      formantCompensation.enabled ? clamp(formantCompensation.highGainDb, -24, 24) : 0,
      now,
      0.03
    )

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

    // Delay module
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

    // Reverb module
    chain.reverbDry.gain.setTargetAtTime(1, now, 0.02)
    chain.reverbDamping.frequency.setTargetAtTime(clamp(settings.reverbDamping, 600, 18000), now, 0.02)

    const reverbSignature = this.makeReverbSignature(settings)
    if (settings.reverbEnabled) {
      if (chain.reverbSignature !== reverbSignature) {
        chain.reverbConvolver.buffer = createImpulseResponse(
          this.getContext(),
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
  }

  private applyFadeEnvelope(settings: LabSettings, durationSeconds: number, envelopeNode: GainNode) {
    const ctx = this.getContext()
    const now = ctx.currentTime
    const gain = envelopeNode.gain
    const fadeIn = clamp(settings.fadeIn, 0, durationSeconds)
    const fadeOut = clamp(settings.fadeOut, 0, durationSeconds)

    gain.cancelScheduledValues(now)

    if (fadeIn > 0) {
      gain.setValueAtTime(0, now)
      gain.linearRampToValueAtTime(1, now + fadeIn)
    } else {
      gain.setValueAtTime(1, now)
    }

    if (fadeOut > 0) {
      const fadeOutStart = Math.max(now + fadeIn, now + durationSeconds - fadeOut)
      gain.setValueAtTime(1, fadeOutStart)
      gain.linearRampToValueAtTime(0, now + durationSeconds)
    }
  }

  updateLiveSettings(settings: LabSettings) {
    if (this.activeChain) {
      this.applyRealtimeSettingsToChain(this.activeChain, settings)
    }

    const ctx = this.context
    if (!ctx) return
    const now = ctx.currentTime

    if (this.activeSource) {
      const tapePlaybackRate = clamp(Math.pow(2, settings.pitchSemitones / 12), 0.25, 4)
      this.activeSource.playbackRate.setTargetAtTime(
        settings.pitchMode === 'tape' ? tapePlaybackRate : 1,
        now,
        0.02
      )
    }

    if (this.activePitchShifter) {
      this.activePitchShifter.setSettings(
        clamp(settings.tempo, 0.25, 4),
        settings.pitchMode === 'tape' ? 0 : settings.pitchSemitones
      )
    }
  }

  stop() {
    this.endedNotified = true

    if (this.activeSource) {
      this.activeSource.onended = null
      try {
        this.activeSource.stop()
      } catch {
        // no-op
      }
      this.activeSource.disconnect()
      this.activeSource = null
    }

    if (this.activePitchShifter) {
      try {
        this.activePitchShifter.disconnect()
      } catch {
        // no-op
      }
      this.activePitchShifter = null
    }

    for (const node of this.activeNodes) {
      try {
        node.disconnect()
      } catch {
        // no-op
      }
    }
    this.activeNodes = []
    this.activeChain = null
    this.analyser = null
    this.stopWaveformPump()
  }

  async play(
    source: AudioBuffer,
    settings: LabSettings,
    onEnded?: () => void
  ) {
    this.stop()
    const ctx = await this.ensureContextResumed()

    const trimmed = trimBufferFromOffset(source, settings.offset)
    const pitchRatio = Math.pow(2, settings.pitchSemitones / 12)
    const needsPitchShift = Math.abs(settings.pitchSemitones) > 0.001
    const needsTempoChange = Math.abs(settings.tempo - 1) > 0.001
    const shouldUseRealtimePitchShifter =
      settings.pitchMode !== 'tape' && (needsPitchShift || needsTempoChange)

    const chain = this.createRealtimeFxChain(settings)
    this.activeChain = chain
    this.activeNodes = chain.nodes
    this.analyser = chain.analyser
    this.startWaveformPump()

    this.endedNotified = false

    const notifyEnded = () => {
      if (this.endedNotified) return
      this.endedNotified = true
      onEnded?.()
    }

    let playbackDuration = trimmed.duration

    if (shouldUseRealtimePitchShifter) {
      const quality = getPitchShiftQualityFromMode(settings.pitchMode)
      const shifter = new RealtimeSoundTouchShifter(ctx, trimmed, quality, notifyEnded)
      shifter.setSettings(clamp(settings.tempo, 0.25, 4), settings.pitchSemitones)
      shifter.connect(chain.inputNode)
      this.activePitchShifter = shifter
      playbackDuration = trimmed.duration / clamp(settings.tempo, 0.25, 4)
    } else {
      const sourceNode = ctx.createBufferSource()
      sourceNode.buffer = trimmed
      sourceNode.playbackRate.value =
        settings.pitchMode === 'tape' ? clamp(pitchRatio, 0.25, 4) : 1
      playbackDuration = trimmed.duration / sourceNode.playbackRate.value

      sourceNode.connect(chain.inputNode)
      sourceNode.onended = () => {
        if (this.activeSource !== sourceNode) return
        this.activeSource = null
        notifyEnded()
      }

      this.activeSource = sourceNode
      sourceNode.start()
    }

    this.applyFadeEnvelope(settings, playbackDuration, chain.envelopeNode)

    return playbackDuration
  }

  async renderWavBlob(source: AudioBuffer, settings: LabSettings) {
    const rendered = await renderLabAudioBuffer(source, settings)
    const wav = audioBufferToWavArrayBuffer(rendered)
    return {
      blob: new Blob([wav], { type: 'audio/wav' }),
      duration: rendered.duration,
    }
  }

  getContextTime(): number {
    return this.context?.currentTime ?? 0
  }

  async dispose() {
    this.stop()
    if (this.context) {
      await this.context.close()
      this.context = null
    }
  }
}
