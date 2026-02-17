import { useState, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react'
import { VstKnob } from './lab/VstKnob'
import { Led } from './lab/Led'
import { clamp, formatDb } from './lab/helpers'
import { useDrumRack } from '../contexts/DrumRackContext'
import { DEFAULT_LAB_SETTINGS, type LabPitchMode, type LabSettings } from '../services/LabAudioEngine'

interface PadFxChainProps {
  padIndex: number
  onClose: () => void
}

const PITCH_MODES: LabPitchMode[] = ['tape', 'granular', 'hq']

const getPitchModeLabel = (mode: LabPitchMode) => {
  if (mode === 'hq') return 'HQ'
  if (mode === 'granular') return 'Gran'
  return 'Tape'
}

export function PadFxChain({ padIndex, onClose }: PadFxChainProps) {
  const { pads, padFxSettings, setPadFxSettings, clearPadFx } = useDrumRack()
  const settings = padFxSettings.get(padIndex) ?? DEFAULT_LAB_SETTINGS
  const [showAdvanced, setShowAdvanced] = useState(false)

  const sample = pads[padIndex]?.slice
  const sampleDuration = sample ? Math.max(0, sample.endTime - sample.startTime) : 0
  const maxOffset = useMemo(() => {
    if (sampleDuration <= 0) return 8
    return Math.max(0.01, Math.min(sampleDuration, 64))
  }, [sampleDuration])

  const update = useCallback(<K extends keyof LabSettings>(key: K, value: LabSettings[K]) => {
    const next = { ...settings, [key]: value }
    setPadFxSettings(padIndex, next)
  }, [settings, padIndex, setPadFxSettings])

  const safeOffset = clamp(settings.offset, 0, maxOffset)

  return (
    <div className="bg-[#0a0c10] border border-surface-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border/50">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-300 uppercase tracking-wider font-medium truncate">
            Pad {padIndex + 1} • Mini FX
          </div>
          {sample && (
            <div className="text-[10px] text-slate-500 truncate">
              {sample.name} {sampleDuration > 0 ? `• ${sampleDuration.toFixed(2)}s` : ''}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => clearPadFx(padIndex)}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-wider"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="p-0.5 text-slate-500 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Mini controls - always visible */}
      <div className="px-3 py-3 border-b border-surface-border/30">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <div className="rounded-md border border-cyan-500/25 bg-cyan-500/5 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-cyan-300/80 uppercase tracking-wider">Core</span>
              <select
                value={settings.pitchMode}
                onChange={(e) => update('pitchMode', e.target.value as LabPitchMode)}
                className="bg-surface-base border border-surface-border rounded text-[9px] px-1 py-0.5 text-cyan-300 focus:outline-none focus:border-cyan-400 cursor-pointer"
                title="Pitch mode"
              >
                {PITCH_MODES.map((mode) => (
                  <option key={mode} value={mode}>{getPitchModeLabel(mode)}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Pitch"
                value={settings.pitchSemitones}
                min={-24}
                max={24}
                step={0.1}
                defaultValue={DEFAULT_LAB_SETTINGS.pitchSemitones}
                onChange={(v) => update('pitchSemitones', v)}
                format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}st`}
                color="#06b6d4"
                size={36}
              />
              <VstKnob
                label="Spd"
                value={settings.tempo}
                min={0.25}
                max={4}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.tempo}
                onChange={(v) => update('tempo', v)}
                format={(v) => `${v.toFixed(2)}x`}
                color="#06b6d4"
                size={36}
                disabled={settings.pitchMode === 'tape'}
              />
            </div>
          </div>

          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
            <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider mb-1">Dynamics</div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Vel"
                value={settings.velocity}
                min={0}
                max={1}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.velocity}
                onChange={(v) => update('velocity', v)}
                format={(v) => `${Math.round(v * 100)}%`}
                color="#34d399"
                size={36}
              />
              <VstKnob
                label="Gain"
                value={settings.outputGain}
                min={0}
                max={2}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.outputGain}
                onChange={(v) => update('outputGain', v)}
                format={formatDb}
                color="#34d399"
                size={36}
              />
            </div>
          </div>

          <div className="rounded-md border border-violet-500/25 bg-violet-500/5 p-2">
            <div className="text-[10px] text-violet-300/80 uppercase tracking-wider mb-1">Env</div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="In"
                value={settings.fadeIn}
                min={0}
                max={5}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.fadeIn}
                onChange={(v) => update('fadeIn', v)}
                format={(v) => `${v.toFixed(2)}s`}
                color="#a78bfa"
                size={36}
              />
              <VstKnob
                label="Out"
                value={settings.fadeOut}
                min={0}
                max={5}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.fadeOut}
                onChange={(v) => update('fadeOut', v)}
                format={(v) => `${v.toFixed(2)}s`}
                color="#a78bfa"
                size={36}
              />
            </div>
          </div>

          <div className="rounded-md border border-indigo-500/25 bg-indigo-500/5 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-indigo-300/80 uppercase tracking-wider">LP</span>
              <Led
                active={settings.lowpassEnabled}
                onClick={() => update('lowpassEnabled', !settings.lowpassEnabled)}
                color="#818cf8"
              />
            </div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Freq"
                value={settings.lowpassFrequency}
                min={100}
                max={20000}
                step={1}
                defaultValue={DEFAULT_LAB_SETTINGS.lowpassFrequency}
                onChange={(v) => update('lowpassFrequency', v)}
                format={(v) => `${Math.round(v)}Hz`}
                color="#818cf8"
                size={36}
                disabled={!settings.lowpassEnabled}
              />
              <VstKnob
                label="Q"
                value={settings.lowpassQ}
                min={0.1}
                max={24}
                step={0.1}
                defaultValue={DEFAULT_LAB_SETTINGS.lowpassQ}
                onChange={(v) => update('lowpassQ', v)}
                format={(v) => v.toFixed(1)}
                color="#818cf8"
                size={36}
                disabled={!settings.lowpassEnabled}
              />
            </div>
          </div>

          <div className="rounded-md border border-indigo-500/25 bg-indigo-500/5 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-indigo-300/80 uppercase tracking-wider">HP</span>
              <Led
                active={settings.highpassEnabled}
                onClick={() => update('highpassEnabled', !settings.highpassEnabled)}
                color="#818cf8"
              />
            </div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Freq"
                value={settings.highpassFrequency}
                min={20}
                max={4000}
                step={1}
                defaultValue={DEFAULT_LAB_SETTINGS.highpassFrequency}
                onChange={(v) => update('highpassFrequency', v)}
                format={(v) => `${Math.round(v)}Hz`}
                color="#818cf8"
                size={36}
                disabled={!settings.highpassEnabled}
              />
              <VstKnob
                label="Q"
                value={settings.highpassQ}
                min={0.1}
                max={24}
                step={0.1}
                defaultValue={DEFAULT_LAB_SETTINGS.highpassQ}
                onChange={(v) => update('highpassQ', v)}
                format={(v) => v.toFixed(1)}
                color="#818cf8"
                size={36}
                disabled={!settings.highpassEnabled}
              />
            </div>
          </div>

          <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2">
            <div className="text-[10px] text-amber-300/80 uppercase tracking-wider mb-1">Offset</div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Start"
                value={safeOffset}
                min={0}
                max={maxOffset}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.offset}
                onChange={(v) => update('offset', clamp(v, 0, maxOffset))}
                format={(v) => `${v.toFixed(2)}s`}
                color="#fbbf24"
                size={44}
              />
            </div>
            <div className="text-[10px] text-slate-500 text-center mt-0.5">
              max {maxOffset.toFixed(2)}s
            </div>
          </div>
        </div>
      </div>

      {/* Advanced FX - collapsed by default */}
      <button
        onClick={() => setShowAdvanced(prev => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className="inline-flex items-center gap-1.5 uppercase tracking-wider">
          <SlidersHorizontal size={12} />
          More FX (hidden by default)
        </span>
        {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      <div className={`fx-accordion ${showAdvanced ? 'fx-accordion-open' : ''}`}>
        <div className="px-3 pb-3 pt-1 grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div className="rounded-md border border-orange-500/25 bg-orange-500/5 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-orange-300/80 uppercase tracking-wider">Distortion</span>
              <Led
                active={settings.distortionEnabled}
                onClick={() => update('distortionEnabled', !settings.distortionEnabled)}
                color="#fb923c"
              />
            </div>
            <div className="flex items-center justify-center">
              <VstKnob
                label="Amount"
                value={settings.distortionAmount}
                min={0}
                max={1}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.distortionAmount}
                onChange={(v) => update('distortionAmount', v)}
                format={(v) => `${Math.round(v * 100)}%`}
                color="#fb923c"
                size={42}
                disabled={!settings.distortionEnabled}
              />
            </div>
          </div>

          <div className="rounded-md border border-rose-500/25 bg-rose-500/5 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-rose-300/80 uppercase tracking-wider">Dynamics</span>
              <Led
                active={settings.compressorEnabled}
                onClick={() => update('compressorEnabled', !settings.compressorEnabled)}
                color="#fb7185"
              />
            </div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Thresh"
                value={settings.compressorThreshold}
                min={-80}
                max={0}
                step={1}
                defaultValue={DEFAULT_LAB_SETTINGS.compressorThreshold}
                onChange={(v) => update('compressorThreshold', v)}
                format={(v) => `${Math.round(v)}dB`}
                color="#fb7185"
                size={36}
                disabled={!settings.compressorEnabled}
              />
              <VstKnob
                label="Ratio"
                value={settings.compressorRatio}
                min={1}
                max={20}
                step={0.1}
                defaultValue={DEFAULT_LAB_SETTINGS.compressorRatio}
                onChange={(v) => update('compressorRatio', v)}
                format={(v) => `${v.toFixed(1)}:1`}
                color="#fb7185"
                size={36}
                disabled={!settings.compressorEnabled}
              />
            </div>
          </div>

          <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-amber-300/80 uppercase tracking-wider">Delay</span>
              <Led
                active={settings.delayEnabled}
                onClick={() => update('delayEnabled', !settings.delayEnabled)}
                color="#fbbf24"
              />
            </div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Time"
                value={settings.delayTime}
                min={0}
                max={2}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.delayTime}
                onChange={(v) => update('delayTime', v)}
                format={(v) => `${v.toFixed(2)}s`}
                color="#fbbf24"
                size={36}
                disabled={!settings.delayEnabled}
              />
              <VstKnob
                label="FB"
                value={settings.delayFeedback}
                min={0}
                max={0.95}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.delayFeedback}
                onChange={(v) => update('delayFeedback', v)}
                format={(v) => `${Math.round(v * 100)}%`}
                color="#fbbf24"
                size={36}
                disabled={!settings.delayEnabled}
              />
              <VstKnob
                label="Mix"
                value={settings.delayMix}
                min={0}
                max={1}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.delayMix}
                onChange={(v) => update('delayMix', v)}
                format={(v) => `${Math.round(v * 100)}%`}
                color="#fbbf24"
                size={36}
                disabled={!settings.delayEnabled}
              />
            </div>
          </div>

          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-emerald-300/80 uppercase tracking-wider">Reverb</span>
              <Led
                active={settings.reverbEnabled}
                onClick={() => update('reverbEnabled', !settings.reverbEnabled)}
                color="#34d399"
              />
            </div>
            <div className="flex items-center justify-center gap-1">
              <VstKnob
                label="Len"
                value={settings.reverbSeconds}
                min={0.1}
                max={8}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.reverbSeconds}
                onChange={(v) => update('reverbSeconds', v)}
                format={(v) => `${v.toFixed(2)}s`}
                color="#34d399"
                size={36}
                disabled={!settings.reverbEnabled}
              />
              <VstKnob
                label="Decay"
                value={settings.reverbDecay}
                min={0.5}
                max={8}
                step={0.05}
                defaultValue={DEFAULT_LAB_SETTINGS.reverbDecay}
                onChange={(v) => update('reverbDecay', v)}
                format={(v) => v.toFixed(2)}
                color="#34d399"
                size={36}
                disabled={!settings.reverbEnabled}
              />
              <VstKnob
                label="Mix"
                value={settings.reverbMix}
                min={0}
                max={1}
                step={0.01}
                defaultValue={DEFAULT_LAB_SETTINGS.reverbMix}
                onChange={(v) => update('reverbMix', v)}
                format={(v) => `${Math.round(v * 100)}%`}
                color="#34d399"
                size={36}
                disabled={!settings.reverbEnabled}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
