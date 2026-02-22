import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Loader2,
  Save,
  Square,
  Play,
  RotateCcw,
} from 'lucide-react'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl, persistLabRender } from '../api/client'
// import { batchReanalyzeSamples } from '../api/client'
import { useScopedSamples, useInvalidateScopedSamples } from '../hooks/useScopedSamples'
import {
  DEFAULT_LAB_SETTINGS,
  DEFAULT_FX_ORDER,
  LabAudioEngine,
  type FxSlotId,
  type LabPitchMode,
  type LabSettings,
} from '../services/LabAudioEngine'
import { subscribeGlobalAudioVolume } from '../services/globalAudioVolume'
import { VstKnob } from './lab/VstKnob'
import { Led } from './lab/Led'
import { FxModule } from './lab/FxModule'
import { clamp, formatDb } from './lab/helpers'
import { useAppDialog } from '../hooks/useAppDialog'

const buildWaveformOverview = (buffer: AudioBuffer, targetPoints = 400) => {
  const points = Math.max(32, targetPoints)
  const peaks = new Float32Array(points)
  const blockSize = Math.max(1, Math.floor(buffer.length / points))

  for (let i = 0; i < points; i++) {
    const start = i * blockSize
    const end = Math.min(buffer.length, start + blockSize)
    let peak = 0

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel)
      for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
        const sample = Math.abs(data[sampleIndex] || 0)
        if (sample > peak) peak = sample
      }
    }

    peaks[i] = peak
  }

  return peaks
}

function makeExportName(slice: SliceWithTrackExtended) {
  const safe = (slice.name || `sample-${slice.id}`)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safe || `sample-${slice.id}`}-lab.wav`
}

const formatTime = (seconds: number) => {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`
}

/* ─── Waveform Canvas ───────────────────────────────────── */

interface WaveformDrawParams {
  peaks: Float32Array
  offsetRatio: number
  fadeInRatio: number
  fadeOutRatio: number
  effectiveRate: number
  sampleDurationSec: number
}

function drawWaveform(canvas: HTMLCanvasElement, params: WaveformDrawParams) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = rect.width * dpr
  const h = rect.height * dpr

  canvas.width = w
  canvas.height = h
  ctx.clearRect(0, 0, w, h)

  const { peaks, offsetRatio, fadeInRatio, fadeOutRatio, effectiveRate, sampleDurationSec } = params
  if (peaks.length === 0) return

  const midY = h / 2

  // Grid lines
  ctx.strokeStyle = 'rgba(148,163,184,0.08)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = (h / 4) * i
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // Time markers with labels (adapted to playback rate)
  const effectiveDuration = sampleDurationSec / Math.max(0.01, effectiveRate)
  ctx.strokeStyle = 'rgba(148,163,184,0.12)'
  ctx.fillStyle = 'rgba(148,163,184,0.35)'
  ctx.font = `${9 * dpr}px "JetBrains Mono", monospace`
  ctx.textAlign = 'center'
  const numMarkers = 10
  for (let i = 1; i < numMarkers; i++) {
    const x = (w / numMarkers) * i
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    const timeSec = (i / numMarkers) * effectiveDuration
    ctx.fillText(`${timeSec.toFixed(1)}s`, x, h - 3 * dpr)
  }

  // Offset dimming region
  if (offsetRatio > 0.001) {
    const ox = offsetRatio * w
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, ox, h)

    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 1.5 * dpr
    ctx.setLineDash([4 * dpr, 3 * dpr])
    ctx.beginPath()
    ctx.moveTo(ox, 0)
    ctx.lineTo(ox, h)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Waveform polygon
  const waveGrad = ctx.createLinearGradient(0, 0, 0, h)
  waveGrad.addColorStop(0, 'rgba(6,182,212,0.7)')
  waveGrad.addColorStop(0.5, 'rgba(6,182,212,0.3)')
  waveGrad.addColorStop(1, 'rgba(6,182,212,0.7)')

  ctx.fillStyle = waveGrad
  ctx.beginPath()
  ctx.moveTo(0, midY)

  for (let i = 0; i < peaks.length; i++) {
    const x = (i / (peaks.length - 1)) * w
    const amp = clamp(peaks[i], 0, 1)
    ctx.lineTo(x, midY - amp * (midY - 2))
  }

  for (let i = peaks.length - 1; i >= 0; i--) {
    const x = (i / (peaks.length - 1)) * w
    const amp = clamp(peaks[i], 0, 1)
    ctx.lineTo(x, midY + amp * (midY - 2))
  }

  ctx.closePath()
  ctx.fill()

  // Center line
  ctx.strokeStyle = 'rgba(6,182,212,0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, midY)
  ctx.lineTo(w, midY)
  ctx.stroke()

  // Fade In envelope
  if (fadeInRatio > 0.001) {
    const startX = offsetRatio * w
    const endX = Math.min(1, offsetRatio + fadeInRatio) * w

    ctx.fillStyle = 'rgba(167,139,250,0.18)'
    ctx.beginPath()
    ctx.moveTo(startX, 0)
    ctx.lineTo(endX, 0)
    ctx.lineTo(startX, midY)
    ctx.closePath()
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(startX, h)
    ctx.lineTo(endX, h)
    ctx.lineTo(startX, midY)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#a78bfa'
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()
    ctx.moveTo(startX, midY)
    ctx.lineTo(endX, 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(startX, midY)
    ctx.lineTo(endX, h - 2)
    ctx.stroke()
  }

  // Fade Out envelope
  if (fadeOutRatio > 0.001) {
    const startX = Math.max(0, 1 - fadeOutRatio) * w
    const endX = w

    ctx.fillStyle = 'rgba(167,139,250,0.18)'
    ctx.beginPath()
    ctx.moveTo(startX, 0)
    ctx.lineTo(endX, 0)
    ctx.lineTo(endX, midY)
    ctx.closePath()
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(startX, h)
    ctx.lineTo(endX, h)
    ctx.lineTo(endX, midY)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#a78bfa'
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()
    ctx.moveTo(startX, 2)
    ctx.lineTo(endX, midY)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(startX, h - 2)
    ctx.lineTo(endX, midY)
    ctx.stroke()
  }
}

/* ─── FX Module Definitions ─────────────────────────────── */

const FX_MODULE_META: Record<FxSlotId, { title: string; color: string }> = {
  filter: { title: 'Filter', color: '#818cf8' },
  distortion: { title: 'Distortion', color: '#fb923c' },
  compressor: { title: 'Dynamics', color: '#fb7185' },
  delay: { title: 'Delay', color: '#fbbf24' },
  reverb: { title: 'Reverb', color: '#34d399' },
}

/* ─── Main Component ────────────────────────────────────── */

const getPitchModeLabel = (mode: LabPitchMode) => {
  if (mode === 'tape') return 'TAPE'
  if (mode === 'granular') return 'GRAN'
  return 'HQ'
}

interface LabViewProps {
  selectedSample?: SliceWithTrackExtended | null
}

export function LabView({ selectedSample: propSelectedSample }: LabViewProps) {
  const { confirm, alert: showAlert, dialogNode } = useAppDialog()
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const [settings, setSettings] = useState<LabSettings>(DEFAULT_LAB_SETTINGS)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isPreparingPreview, setIsPreparingPreview] = useState(false)
  const [isExportingCopy, setIsExportingCopy] = useState(false)
  const [isOverwriting, setIsOverwriting] = useState(false)
  // const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [waveformOverview, setWaveformOverview] = useState<Float32Array>(new Float32Array(0))
  const [isWaveformLoading, setIsWaveformLoading] = useState(false)
  const [isSampleDragOver, setIsSampleDragOver] = useState(false)
  const [dragOverSlot, setDragOverSlot] = useState<FxSlotId | null>(null)
  const draggedSlotRef = useRef<FxSlotId | null>(null)
  const [rmsDb, setRmsDb] = useState(-Infinity)

  const { data: samplesData, isLoading: isSamplesLoading } = useScopedSamples(
    { type: 'all' },
    [],
    '',
    false,
  )

  const invalidateScopedSamples = useInvalidateScopedSamples()
  const engineRef = useRef<LabAudioEngine | null>(null)
  const decodedBufferCacheRef = useRef<Map<number, AudioBuffer>>(new Map())

  // Playhead animation refs
  const playStartRef = useRef(0)
  const playDurationRef = useRef(0)
  const sampleDurationRef = useRef(0)
  const playheadRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const handlePreviewToggleRef = useRef<() => void>(() => {})

  const samples = useMemo(() => samplesData?.samples || [], [samplesData?.samples])

  // Auto-select sample from props when it changes
  useEffect(() => {
    if (propSelectedSample?.id && propSelectedSample.id !== selectedSampleId) {
      setSelectedSampleId(propSelectedSample.id)
    }
  }, [propSelectedSample?.id])

  const selectedSample = useMemo(
    () => samples.find((sample) => sample.id === selectedSampleId) ?? propSelectedSample ?? null,
    [samples, selectedSampleId, propSelectedSample],
  )

  const sampleDuration = useMemo(() => {
    if (!selectedSample) return 0
    return Math.max(0, selectedSample.endTime - selectedSample.startTime)
  }, [selectedSample])

  // Effective playback rate based on pitch mode
  const effectiveRate = useMemo(() => {
    if (settings.pitchMode === 'tape') {
      return clamp(Math.pow(2, settings.pitchSemitones / 12), 0.25, 4)
    }
    return clamp(settings.tempo, 0.25, 4)
  }, [settings.pitchMode, settings.pitchSemitones, settings.tempo])

  const effectiveDuration = useMemo(() => {
    if (sampleDuration <= 0) return 0
    return (sampleDuration - settings.offset) / effectiveRate
  }, [sampleDuration, settings.offset, effectiveRate])

  useEffect(() => {
    sampleDurationRef.current = sampleDuration
  }, [sampleDuration])

  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new LabAudioEngine()
    }

    return () => {
      if (engineRef.current) {
        void engineRef.current.dispose()
        engineRef.current = null
      }
      decodedBufferCacheRef.current.clear()
    }
  }, [])

  // Subscribe to global volume changes so Lab output updates live
  useEffect(() => {
    return subscribeGlobalAudioVolume(() => {
      engineRef.current?.updateLiveSettings(settings)
    })
  }, [settings])

  // Subscribe to engine waveform for RMS metering
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    return engine.subscribeWaveform((samples) => {
      if (samples.length === 0) { setRmsDb(-Infinity); return }
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      const rms = Math.sqrt(sum / samples.length)
      setRmsDb(rms > 0.0001 ? 20 * Math.log10(rms) : -Infinity)
    })
  }, [])

  useEffect(() => {
    setErrorMessage(null)
  }, [selectedSampleId, settings])

  useEffect(() => {
    engineRef.current?.updateLiveSettings(settings)
  }, [settings])

  // Waveform draw params
  const waveformParams = useMemo((): WaveformDrawParams => {
    const offsetRatio = sampleDuration > 0 ? settings.offset / sampleDuration : 0
    const fadeInRatio = sampleDuration > 0 ? settings.fadeIn / sampleDuration : 0
    const fadeOutRatio = sampleDuration > 0 ? settings.fadeOut / sampleDuration : 0
    return {
      peaks: waveformOverview,
      offsetRatio,
      fadeInRatio,
      fadeOutRatio,
      effectiveRate,
      sampleDurationSec: sampleDuration,
    }
  }, [waveformOverview, settings.offset, settings.fadeIn, settings.fadeOut, sampleDuration, effectiveRate])

  // Canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawWaveform(canvas, waveformParams)
  }, [waveformParams])

  // ResizeObserver for responsive canvas
  useEffect(() => {
    const wrap = canvasWrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const observer = new ResizeObserver(() => {
      drawWaveform(canvas, waveformParams)
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [waveformParams])

  // Playhead animation loop
  const stopPlayheadAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (playheadRef.current) {
      playheadRef.current.style.opacity = '0'
    }
  }, [])

  const startPlayheadAnimation = useCallback(() => {
    stopPlayheadAnimation()
    if (!playheadRef.current) return

    playheadRef.current.style.opacity = '1'

    const tick = () => {
      const engine = engineRef.current
      if (!engine) return

      const elapsed = engine.getContextTime() - playStartRef.current
      const duration = playDurationRef.current
      if (duration <= 0) return

      const progress = clamp(elapsed / duration, 0, 1)
      const totalDur = sampleDurationRef.current
      const offsetFrac = totalDur > 0 ? settings.offset / totalDur : 0
      const left = offsetFrac + progress * (1 - offsetFrac)

      if (playheadRef.current) {
        playheadRef.current.style.left = `${left * 100}%`
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        stopPlayheadAnimation()
      }
    }

    animFrameRef.current = requestAnimationFrame(tick)
  }, [stopPlayheadAnimation, settings.offset])

  const stopPreview = useCallback(() => {
    engineRef.current?.stop()
    setIsPreviewing(false)
    setIsPreparingPreview(false)
    stopPlayheadAnimation()
  }, [stopPlayheadAnimation])

  const handleSampleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsSampleDragOver(true)
  }

  const handleSampleDragLeave = () => {
    setIsSampleDragOver(false)
  }

  const handleSampleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsSampleDragOver(false)

    const payload = event.dataTransfer.getData('application/json')
    if (!payload) return

    try {
      const parsed = JSON.parse(payload) as {
        id?: number
        slice?: { id?: number }
        sampleIds?: number[]
      }

      const droppedSampleId =
        typeof parsed.slice?.id === 'number'
          ? parsed.slice.id
          : Array.isArray(parsed.sampleIds) && typeof parsed.sampleIds[0] === 'number'
            ? parsed.sampleIds[0]
            : typeof parsed.id === 'number'
              ? parsed.id
              : null

      if (droppedSampleId !== null) {
        stopPreview()
        setSelectedSampleId(droppedSampleId)
        setErrorMessage(null)
      }
    } catch {
      // Ignore unsupported drag payloads
    }
  }

  const withSelectedBuffer = async () => {
    if (!selectedSample) {
      throw new Error('Drop a sample into the Lab to begin.')
    }

    const existing = decodedBufferCacheRef.current.get(selectedSample.id)
    if (existing) return existing

    const engine = engineRef.current
    if (!engine) throw new Error('Audio engine not initialized.')

    const decoded = await engine.decodeFromUrl(getSliceDownloadUrl(selectedSample.id))
    decodedBufferCacheRef.current.set(selectedSample.id, decoded)
    return decoded
  }

  useEffect(() => {
    let cancelled = false

    if (!selectedSample) {
      setWaveformOverview(new Float32Array(0))
      setIsWaveformLoading(false)
      return
    }

    setIsWaveformLoading(true)

    void (async () => {
      try {
        const decoded = await withSelectedBuffer()
        if (cancelled) return
        setWaveformOverview(buildWaveformOverview(decoded))
      } catch {
        if (cancelled) return
        setWaveformOverview(new Float32Array(0))
      } finally {
        if (!cancelled) {
          setIsWaveformLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedSample?.id])

  const handlePreviewToggle = async () => {
    if (isPreviewing || isPreparingPreview) {
      stopPreview()
      return
    }

    try {
      setErrorMessage(null)
      setIsPreparingPreview(true)
      const engine = engineRef.current
      if (!engine) throw new Error('Audio engine not initialized.')

      const buffer = await withSelectedBuffer()
      setIsPreparingPreview(false)
      setIsPreviewing(true)

      playStartRef.current = engine.getContextTime()
      const playDuration = await engine.play(buffer, settings, () => {
        setIsPreviewing(false)
        stopPlayheadAnimation()
      })
      playDurationRef.current = playDuration ?? 0
      startPlayheadAnimation()
    } catch (error) {
      setIsPreparingPreview(false)
      setIsPreviewing(false)
      stopPlayheadAnimation()
      setErrorMessage(error instanceof Error ? error.message : 'Failed to preview sample')
    }
  }

  // Keep a ref to the latest toggle function for the keydown handler
  useEffect(() => {
    handlePreviewToggleRef.current = handlePreviewToggle
  })

  // Space to play/stop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        void handlePreviewToggleRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const updateSettings = <K extends keyof LabSettings>(key: K, value: LabSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const newOffset = clamp(x * sampleDuration, 0, sampleDuration)
    updateSettings('offset', newOffset)
  }

  const handleWaveformPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const newOffset = clamp(x * sampleDuration, 0, sampleDuration)
    updateSettings('offset', newOffset)
  }

  const handleWaveformPointerUp = () => {
    if (isPreviewing) {
      stopPreview()
      setTimeout(() => void handlePreviewToggle(), 50)
    }
  }

  const withRenderedBlob = async () => {
    const engine = engineRef.current
    if (!engine) throw new Error('Audio engine not initialized.')

    const source = await withSelectedBuffer()
    const { blob, duration } = await engine.renderWavBlob(source, settings)

    return {
      blob,
      duration,
      hqPitchRequested: settings.pitchMode === 'hq',
    }
  }

  const handleExportCopy = async () => {
    if (!selectedSample) {
      setErrorMessage('Please select a sample to export.')
      return
    }

    try {
      setErrorMessage(null)
      setIsExportingCopy(true)
      const render = await withRenderedBlob()
      const fileName = makeExportName(selectedSample)
      await persistLabRender(selectedSample.id, {
        mode: 'copy',
        fileName,
        duration: render.duration,
        hqPitchRequested: render.hqPitchRequested,
        audioBlob: render.blob,
      })
      invalidateScopedSamples()
      await showAlert({
        title: 'Export Complete',
        message: 'Exported as a new sample copy.',
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to export sample copy')
    } finally {
      setIsExportingCopy(false)
    }
  }

  const handleOverwrite = async () => {
    if (!selectedSample) {
      setErrorMessage('Please select a sample to overwrite.')
      return
    }

    const confirmed = await confirm({
      title: 'Overwrite Original',
      message: `Overwrite the original file for "${selectedSample.name}"? This marks the sample as modified.`,
      confirmText: 'Overwrite',
      cancelText: 'Cancel',
      isDestructive: true,
    })

    if (!confirmed) return

    try {
      setErrorMessage(null)
      setIsOverwriting(true)
      const render = await withRenderedBlob()
      await persistLabRender(selectedSample.id, {
        mode: 'overwrite',
        fileName: makeExportName(selectedSample),
        duration: render.duration,
        hqPitchRequested: render.hqPitchRequested,
        audioBlob: render.blob,
      })
      invalidateScopedSamples()
      await showAlert({
        title: 'Overwrite Complete',
        message: 'Original sample overwritten successfully.',
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to overwrite sample')
    } finally {
      setIsOverwriting(false)
    }
  }

  // const handleAnalyze = async () => {
  //   if (!selectedSample) return
  //   try {
  //     setIsAnalyzing(true)
  //     await batchReanalyzeSamples([selectedSample.id])
  //     invalidateScopedSamples()
  //   } catch (error) {
  //     setErrorMessage(error instanceof Error ? error.message : 'Failed to analyze sample')
  //   } finally {
  //     setIsAnalyzing(false)
  //   }
  // }

  // FX drag reordering — only the grip handle initiates drag
  const handleFxDragStart = (slotId: FxSlotId) => (e: React.DragEvent) => {
    draggedSlotRef.current = slotId
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleFxDragOver = (slotId: FxSlotId) => (e: React.DragEvent) => {
    e.preventDefault()
    const dragged = draggedSlotRef.current
    if (!dragged || dragged === slotId) {
      setDragOverSlot(null)
      return
    }
    setDragOverSlot(slotId)
    setSettings((prev) => {
      const order = [...(prev.fxOrder || DEFAULT_FX_ORDER)]
      const fromIdx = order.indexOf(dragged)
      const toIdx = order.indexOf(slotId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      order.splice(fromIdx, 1)
      order.splice(toIdx, 0, dragged)
      return { ...prev, fxOrder: order }
    })
  }

  const handleFxDragEnd = () => {
    draggedSlotRef.current = null
    setDragOverSlot(null)
  }

  /* ─── FX Module Renderers ─────────────────────────────── */

  const fxOrder = settings.fxOrder || DEFAULT_FX_ORDER

  const renderFxModuleContent = (slotId: FxSlotId) => {
    switch (slotId) {
      case 'filter':
        return (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Led
                active={settings.lowpassEnabled}
                onClick={() => updateSettings('lowpassEnabled', !settings.lowpassEnabled)}
                label="LP"
                color="#818cf8"
              />
              <div className="flex items-center gap-2">
                <VstKnob
                  label="Freq"
                  value={settings.lowpassFrequency}
                  min={100}
                  max={20000}
                  step={1}
                  defaultValue={DEFAULT_LAB_SETTINGS.lowpassFrequency}
                  onChange={(v) => updateSettings('lowpassFrequency', v)}
                  format={(v) => `${Math.round(v)}Hz`}
                  color="#818cf8"
                  disabled={!settings.lowpassEnabled}
                />
                <VstKnob
                  label="Q"
                  value={settings.lowpassQ}
                  min={0.1}
                  max={24}
                  step={0.1}
                  defaultValue={DEFAULT_LAB_SETTINGS.lowpassQ}
                  onChange={(v) => updateSettings('lowpassQ', v)}
                  format={(v) => v.toFixed(1)}
                  color="#818cf8"
                  disabled={!settings.lowpassEnabled}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Led
                active={settings.highpassEnabled}
                onClick={() => updateSettings('highpassEnabled', !settings.highpassEnabled)}
                label="HP"
                color="#818cf8"
              />
              <div className="flex items-center gap-2">
                <VstKnob
                  label="Freq"
                  value={settings.highpassFrequency}
                  min={20}
                  max={4000}
                  step={1}
                  defaultValue={DEFAULT_LAB_SETTINGS.highpassFrequency}
                  onChange={(v) => updateSettings('highpassFrequency', v)}
                  format={(v) => `${Math.round(v)}Hz`}
                  color="#818cf8"
                  disabled={!settings.highpassEnabled}
                />
                <VstKnob
                  label="Q"
                  value={settings.highpassQ}
                  min={0.1}
                  max={24}
                  step={0.1}
                  defaultValue={DEFAULT_LAB_SETTINGS.highpassQ}
                  onChange={(v) => updateSettings('highpassQ', v)}
                  format={(v) => v.toFixed(1)}
                  color="#818cf8"
                  disabled={!settings.highpassEnabled}
                />
              </div>
            </div>
            {/* Peaking EQ band */}
            <div className="flex flex-col gap-1">
              <Led
                active={settings.peakingEnabled}
                onClick={() => updateSettings('peakingEnabled', !settings.peakingEnabled)}
                label="EQ"
                color="#818cf8"
              />
              <div className="flex items-center gap-2">
                <VstKnob
                  label="Freq"
                  value={settings.peakingFrequency}
                  min={20}
                  max={20000}
                  step={1}
                  defaultValue={DEFAULT_LAB_SETTINGS.peakingFrequency}
                  onChange={(v) => updateSettings('peakingFrequency', v)}
                  format={(v) => `${Math.round(v)}Hz`}
                  color="#818cf8"
                  disabled={!settings.peakingEnabled}
                />
                <VstKnob
                  label="Gain"
                  value={settings.peakingGain}
                  min={-12}
                  max={12}
                  step={0.1}
                  defaultValue={DEFAULT_LAB_SETTINGS.peakingGain}
                  onChange={(v) => updateSettings('peakingGain', v)}
                  format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`}
                  color="#818cf8"
                  disabled={!settings.peakingEnabled}
                />
                <VstKnob
                  label="Q"
                  value={settings.peakingQ}
                  min={0.1}
                  max={24}
                  step={0.1}
                  defaultValue={DEFAULT_LAB_SETTINGS.peakingQ}
                  onChange={(v) => updateSettings('peakingQ', v)}
                  format={(v) => v.toFixed(1)}
                  color="#818cf8"
                  disabled={!settings.peakingEnabled}
                />
              </div>
            </div>
          </div>
        )

      case 'delay':
        return (
          <div className="grid grid-cols-2 gap-1">
            <VstKnob
              label="Time"
              value={settings.delayTime}
              min={0}
              max={2}
              step={0.01}
              defaultValue={DEFAULT_LAB_SETTINGS.delayTime}
              onChange={(v) => updateSettings('delayTime', v)}
              format={(v) => `${v.toFixed(2)}s`}
              color="#fbbf24"
            />
            <VstKnob
              label="Feedback"
              value={settings.delayFeedback}
              min={0}
              max={0.95}
              step={0.01}
              defaultValue={DEFAULT_LAB_SETTINGS.delayFeedback}
              onChange={(v) => updateSettings('delayFeedback', v)}
              format={(v) => `${Math.round(v * 100)}%`}
              color="#fbbf24"
            />
            <VstKnob
              label="Mix"
              value={settings.delayMix}
              min={0}
              max={1}
              step={0.01}
              defaultValue={DEFAULT_LAB_SETTINGS.delayMix}
              onChange={(v) => updateSettings('delayMix', v)}
              format={(v) => `${Math.round(v * 100)}%`}
              color="#fbbf24"
            />
            <VstKnob
              label="Tone"
              value={settings.delayTone}
              min={600}
              max={18000}
              step={10}
              defaultValue={DEFAULT_LAB_SETTINGS.delayTone}
              onChange={(v) => updateSettings('delayTone', v)}
              format={(v) => `${Math.round(v)}Hz`}
              color="#fbbf24"
            />
          </div>
        )

      case 'compressor':
        return (
          <div className="flex flex-col gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-vst text-[9px] uppercase tracking-widest text-slate-500">Threshold</span>
                <span className="font-vst-mono text-[10px] text-rose-400">{Math.round(settings.compressorThreshold)}dB</span>
              </div>
              {/* Threshold slider with RMS meter */}
              <div className="relative">
                <input
                  type="range"
                  min={-80}
                  max={0}
                  step={1}
                  value={settings.compressorThreshold}
                  onChange={(e) => updateSettings('compressorThreshold', Number(e.target.value))}
                  className="w-full h-2 appearance-none rounded-full slider-thumb relative z-10"
                  style={{ background: '#1e2028' }}
                />
                {/* RMS level bar */}
                {settings.compressorEnabled && isPreviewing && Number.isFinite(rmsDb) && (
                  <div
                    className="absolute top-0 left-0 h-2 rounded-full pointer-events-none transition-all duration-75"
                    style={{
                      width: `${clamp((rmsDb + 80) / 80 * 100, 0, 100)}%`,
                      background: rmsDb > settings.compressorThreshold
                        ? 'rgba(251,113,133,0.5)'
                        : 'rgba(52,211,153,0.35)',
                    }}
                  />
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <VstKnob
                label="Ratio"
                value={settings.compressorRatio}
                min={1}
                max={20}
                step={0.1}
                defaultValue={DEFAULT_LAB_SETTINGS.compressorRatio}
                onChange={(v) => updateSettings('compressorRatio', v)}
                format={(v) => `${v.toFixed(1)}:1`}
                color="#fb7185"
                size={38}
              />
              <VstKnob
                label="Attack"
                value={settings.compressorAttack}
                min={0}
                max={1}
                step={0.001}
                defaultValue={DEFAULT_LAB_SETTINGS.compressorAttack}
                onChange={(v) => updateSettings('compressorAttack', v)}
                format={(v) => `${(v * 1000).toFixed(0)}ms`}
                color="#fb7185"
                size={38}
              />
              <VstKnob
                label="Release"
                value={settings.compressorRelease}
                min={0}
                max={1}
                step={0.001}
                defaultValue={DEFAULT_LAB_SETTINGS.compressorRelease}
                onChange={(v) => updateSettings('compressorRelease', v)}
                format={(v) => `${(v * 1000).toFixed(0)}ms`}
                color="#fb7185"
                size={38}
              />
            </div>
          </div>
        )

      case 'reverb':
        return (
          <div className="grid grid-cols-2 gap-1">
            <VstKnob
              label="Length"
              value={settings.reverbSeconds}
              min={0.1}
              max={8}
              step={0.01}
              defaultValue={DEFAULT_LAB_SETTINGS.reverbSeconds}
              onChange={(v) => updateSettings('reverbSeconds', v)}
              format={(v) => `${v.toFixed(2)}s`}
              color="#34d399"
            />
            <VstKnob
              label="Decay"
              value={settings.reverbDecay}
              min={0.5}
              max={8}
              step={0.05}
              defaultValue={DEFAULT_LAB_SETTINGS.reverbDecay}
              onChange={(v) => updateSettings('reverbDecay', v)}
              format={(v) => v.toFixed(2)}
              color="#34d399"
            />
            <VstKnob
              label="Damping"
              value={settings.reverbDamping}
              min={600}
              max={18000}
              step={10}
              defaultValue={DEFAULT_LAB_SETTINGS.reverbDamping}
              onChange={(v) => updateSettings('reverbDamping', v)}
              format={(v) => `${Math.round(v)}Hz`}
              color="#34d399"
            />
            <VstKnob
              label="Mix"
              value={settings.reverbMix}
              min={0}
              max={1}
              step={0.01}
              defaultValue={DEFAULT_LAB_SETTINGS.reverbMix}
              onChange={(v) => updateSettings('reverbMix', v)}
              format={(v) => `${Math.round(v * 100)}%`}
              color="#34d399"
            />
          </div>
        )

      case 'distortion':
        return (
          <div className="flex justify-center">
            <VstKnob
              label="Amount"
              value={settings.distortionAmount}
              min={0}
              max={1}
              step={0.01}
              defaultValue={DEFAULT_LAB_SETTINGS.distortionAmount}
              onChange={(v) => updateSettings('distortionAmount', v)}
              format={(v) => `${Math.round(v * 100)}%`}
              color="#fb923c"
              size={52}
            />
          </div>
        )

      default:
        return null
    }
  }

  const getModuleEnabled = (slotId: FxSlotId): boolean => {
    switch (slotId) {
      case 'filter': return settings.lowpassEnabled || settings.highpassEnabled || settings.peakingEnabled
      case 'delay': return settings.delayEnabled
      case 'compressor': return settings.compressorEnabled
      case 'reverb': return settings.reverbEnabled
      case 'distortion': return settings.distortionEnabled
      default: return true
    }
  }

  const getModuleToggle = (slotId: FxSlotId): (() => void) | undefined => {
    switch (slotId) {
      case 'delay': return () => updateSettings('delayEnabled', !settings.delayEnabled)
      case 'compressor': return () => updateSettings('compressorEnabled', !settings.compressorEnabled)
      case 'reverb': return () => updateSettings('reverbEnabled', !settings.reverbEnabled)
      case 'distortion': return () => updateSettings('distortionEnabled', !settings.distortionEnabled)
      default: return undefined
    }
  }

  /* ─── Render ──────────────────────────────────────────── */

  const pitchModes: LabPitchMode[] = ['tape', 'granular', 'hq']

  return (
    <div
      className="relative h-full min-h-0 flex overflow-hidden font-vst"
      style={{ background: '#09090c' }}
      onDragOver={handleSampleDragOver}
      onDragLeave={handleSampleDragLeave}
      onDrop={handleSampleDrop}
    >
      {isSampleDragOver && (
        <div className="absolute inset-3 z-20 pointer-events-none rounded-xl border-2 border-dashed border-cyan-400/70 bg-cyan-500/10 flex items-center justify-center">
          <div className="text-center px-4">
            <div className="text-sm font-semibold text-cyan-200">Drop sample to load Lab</div>
            <div className="text-[11px] text-cyan-100/70 mt-1">Drag from the Sources panel on the left</div>
          </div>
        </div>
      )}

      <section className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!selectedSample ? (
          <div className="h-full flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-xl border border-dashed border-slate-700 bg-surface-overlay/50 p-6 text-center">
              <div className="text-sm text-slate-300">Drop a sample here to start Lab processing</div>
              <div className="text-xs text-slate-500 mt-2">
                Open the Sources panel using the left sidebar button, then drag and drop a sample into this area.
              </div>
              {isSamplesLoading ? (
                <div className="mt-3 inline-flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="animate-spin" size={12} /> Loading samples…
                </div>
              ) : samples.length === 0 ? (
                <div className="mt-3 text-xs text-amber-300/80">No samples available yet.</div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {/* ─── Waveform Display ─────────────────── */}
            <div className="relative mx-3 mt-3 rounded-lg overflow-hidden" style={{ background: '#080a0f' }}>
              <div
                ref={canvasWrapRef}
                className="relative cursor-crosshair"
                style={{ height: 120, touchAction: 'none' }}
                onPointerDown={handleWaveformPointerDown}
                onPointerMove={handleWaveformPointerMove}
                onPointerUp={handleWaveformPointerUp}
              >
                {isWaveformLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-600">
                    Loading waveform...
                  </div>
                ) : waveformOverview.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-600">
                    No waveform data
                  </div>
                ) : null}
                <canvas ref={canvasRef} className="w-full h-full block" />

                {/* Playhead */}
                <div
                  ref={playheadRef}
                  className="absolute top-0 bottom-0 w-px pointer-events-none opacity-0 transition-opacity"
                  style={{
                    background: '#f1f5f9',
                    boxShadow: '0 0 6px rgba(241,245,249,0.6)',
                    left: '0%',
                  }}
                />

                {/* CRT scanlines */}
                <div className="absolute inset-0 crt-scanlines pointer-events-none" />

                {/* Offset label */}
                {settings.offset > 0.01 && sampleDuration > 0 && (
                  <div
                    className="absolute top-1 pointer-events-none font-vst-mono text-[10px] text-amber-400/80"
                    style={{ left: `${(settings.offset / sampleDuration) * 100}%`, transform: 'translateX(4px)' }}
                  >
                    {settings.offset.toFixed(2)}s
                  </div>
                )}
              </div>

              {/* Offset info bar */}
              <div
                className="flex items-center gap-2 px-2 py-1"
                style={{ background: '#0a0c10', borderTop: '1px solid #1a1c2233' }}
              >
                <span className="font-vst text-[10px] text-slate-600 uppercase tracking-wider">
                  Click waveform to set offset
                </span>
                <input
                  type="number"
                  min={0}
                  max={sampleDuration}
                  step={0.01}
                  value={settings.offset.toFixed(2)}
                  onChange={(e) => updateSettings('offset', clamp(Number(e.target.value), 0, sampleDuration))}
                  className="w-20 px-1.5 py-0.5 text-[10px] font-vst-mono rounded border text-amber-400 focus:outline-none focus:border-cyan-800"
                  style={{ background: '#0d0f14', borderColor: '#1e2028' }}
                />
                <span className="font-vst-mono text-[10px] text-slate-600">sec</span>
              </div>
            </div>

            {/* ─── Transport Bar ────────────────────── */}
            <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#0d0f14', border: '1px solid #1a1c22' }}>
              {/* Play/Stop */}
              <button
                onClick={handlePreviewToggle}
                disabled={isExportingCopy || isOverwriting}
                className="inline-flex items-center justify-center w-9 h-9 rounded-md border transition-all disabled:opacity-50 flex-shrink-0"
                style={{
                  background: isPreviewing ? '#0d0f14' : '#06b6d422',
                  borderColor: isPreviewing ? '#ef4444' : '#06b6d4',
                  boxShadow: isPreviewing ? '0 0 8px rgba(239,68,68,0.3)' : '0 0 8px rgba(6,182,212,0.2)',
                }}
              >
                {isPreparingPreview ? (
                  <Loader2 size={16} className="animate-spin text-cyan-400" />
                ) : isPreviewing ? (
                  <Square size={14} className="text-red-400" />
                ) : (
                  <Play size={14} className="text-cyan-400 ml-0.5" />
                )}
              </button>

              {/* Reset */}
              <button
                onClick={() => { setSettings(DEFAULT_LAB_SETTINGS); stopPreview() }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border transition-colors text-slate-400 hover:text-white flex-shrink-0"
                style={{ background: '#0d0f14', borderColor: '#1e2028' }}
              >
                <RotateCcw size={11} /> Reset
              </button>

              {/* Export Copy */}
              <button
                onClick={handleExportCopy}
                disabled={isExportingCopy || isOverwriting || isPreparingPreview}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border transition-colors disabled:opacity-50 flex-shrink-0"
                style={{ background: '#34d39911', borderColor: '#34d39944', color: '#34d399' }}
              >
                {isExportingCopy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Copy
              </button>

              {/* Overwrite */}
              <button
                onClick={handleOverwrite}
                disabled={isOverwriting || isExportingCopy || isPreparingPreview}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded border transition-colors disabled:opacity-50 flex-shrink-0"
                style={{ background: '#fbbf2411', borderColor: '#fbbf2444', color: '#fbbf24' }}
              >
                {isOverwriting ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Overwrite
              </button>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Sample name + speed */}
              <div className="min-w-0 text-right">
                <div className="text-[12px] text-slate-200 truncate">{selectedSample.name}</div>
                {effectiveRate !== 1 && (
                  <div className="text-[10px] text-slate-500 font-vst-mono">
                    {effectiveRate.toFixed(2)}x speed
                  </div>
                )}
              </div>

              {/* Time readout */}
              <div className="text-right flex-shrink-0">
                <span className="font-vst-mono text-[12px] text-cyan-400 tabular-nums block">
                  {formatTime(effectiveDuration)}
                </span>
                {effectiveRate !== 1 && (
                  <span className="font-vst-mono text-[9px] text-slate-500 tabular-nums block">
                    raw {formatTime(sampleDuration - settings.offset)}
                  </span>
                )}
              </div>
            </div>

            {errorMessage && (
              <div className="mx-3 mt-1 px-3 py-1.5 text-[11px] text-red-300 rounded" style={{ background: '#ef44441a' }}>
                {errorMessage}
              </div>
            )}

            {/* ─── Module Rack ──────────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
              <div className="flex flex-wrap gap-2">
                {/* CORE + ENV row */}
                <div className="flex gap-2 w-full">
                  {/* CORE (always first, not reorderable) */}
                  <div className="flex-shrink-0">
                    <FxModule title="Core" color="#06b6d4">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <VstKnob
                            label="Pitch"
                            value={settings.pitchSemitones}
                            min={-24}
                            max={24}
                            step={0.1}
                            defaultValue={DEFAULT_LAB_SETTINGS.pitchSemitones}
                            onChange={(v) => updateSettings('pitchSemitones', v)}
                            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}st`}
                            color="#06b6d4"
                            size={42}
                          />
                          <div className="flex flex-col gap-1 pt-1">
                            {pitchModes.map((mode) => {
                              const active = settings.pitchMode === mode
                              return (
                                <button
                                  key={mode}
                                  onClick={() => updateSettings('pitchMode', mode)}
                                  className="px-1.5 py-0.5 rounded text-[9px] tracking-wider uppercase transition-all"
                                  style={{
                                    background: active ? '#06b6d422' : '#1a1c22',
                                    color: active ? '#06b6d4' : '#4a4e58',
                                    border: `1px solid ${active ? '#06b6d4' : '#1e2028'}`,
                                  }}
                                >
                                  {getPitchModeLabel(mode)}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <VstKnob
                            label="Tempo"
                            value={settings.tempo}
                            min={0.25}
                            max={4}
                            step={0.01}
                            defaultValue={DEFAULT_LAB_SETTINGS.tempo}
                            onChange={(v) => updateSettings('tempo', v)}
                            format={(v) => `${v.toFixed(2)}x`}
                            color="#06b6d4"
                            size={42}
                            disabled={settings.pitchMode === 'tape'}
                          />
                          <VstKnob
                            label="Gain"
                            value={settings.outputGain}
                            min={0}
                            max={2}
                            step={0.01}
                            defaultValue={DEFAULT_LAB_SETTINGS.outputGain}
                            onChange={(v) => updateSettings('outputGain', v)}
                            format={formatDb}
                            color="#06b6d4"
                            size={42}
                          />
                        </div>
                      </div>
                    </FxModule>
                  </div>

                  {/* ENVELOPE (fills remaining space) */}
                  <div
                    className="flex-1 flex flex-col items-center justify-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: '#0d0f14', border: '1px solid #a78bfa44' }}
                  >
                    <span className="font-vst text-[11px] tracking-[0.2em] uppercase font-semibold" style={{ color: '#a78bfa' }}>
                      Env
                    </span>
                    <div className="flex items-center gap-3">
                      <VstKnob
                        label="Fade In"
                        value={settings.fadeIn}
                        min={0}
                        max={5}
                        step={0.01}
                        defaultValue={DEFAULT_LAB_SETTINGS.fadeIn}
                        onChange={(v) => updateSettings('fadeIn', v)}
                        format={(v) => `${v.toFixed(2)}s`}
                        color="#a78bfa"
                        size={42}
                      />
                      <VstKnob
                        label="Fade Out"
                        value={settings.fadeOut}
                        min={0}
                        max={5}
                        step={0.01}
                        defaultValue={DEFAULT_LAB_SETTINGS.fadeOut}
                        onChange={(v) => updateSettings('fadeOut', v)}
                        format={(v) => `${v.toFixed(2)}s`}
                        color="#a78bfa"
                        size={42}
                      />
                    </div>
                  </div>
                </div>

                {/* FX Modules (drag to reorder) */}
                {fxOrder.map((slotId) => {
                  const meta = FX_MODULE_META[slotId]
                  if (!meta) return null
                  return (
                    <FxModule
                      key={slotId}
                      title={meta.title}
                      color={meta.color}
                      enabled={getModuleEnabled(slotId)}
                      onToggle={getModuleToggle(slotId)}
                      draggable
                      onDragStart={handleFxDragStart(slotId)}
                      onDragOver={handleFxDragOver(slotId)}
                      onDragEnd={handleFxDragEnd}
                      isDragOver={dragOverSlot === slotId}
                    >
                      {renderFxModuleContent(slotId)}
                    </FxModule>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </section>
      {dialogNode}
    </div>
  )
}
