import { useCallback, useState } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { useDrumRack } from '../contexts/DrumRackContext'
import { Led } from './lab/Led'
import { VstKnob } from './lab/VstKnob'
import { formatDb } from './lab/helpers'
import { DEFAULT_LAB_SETTINGS, type LabPitchMode, type LabSettings } from '../services/LabAudioEngine'

const PITCH_MODES: LabPitchMode[] = ['tape', 'granular', 'hq']

const getPitchModeLabel = (mode: LabPitchMode) => {
  if (mode === 'hq') return 'HQ'
  if (mode === 'granular') return 'Gran'
  return 'Tape'
}

const KNOB_SIZE = 44
const CORE_PITCH_KNOB_SIZE = 40
const CORE_FADE_KNOB_SIZE = 32

export function DrumRackEffectsPanel() {
  const {
    globalFxSettings,
    setGlobalFxSettings,
    clearGlobalFx,
  } = useDrumRack()

  const [showAdvanced, setShowAdvanced] = useState(false)

  const updateGlobal = useCallback(<K extends keyof LabSettings>(key: K, value: LabSettings[K]) => {
    setGlobalFxSettings({
      ...globalFxSettings,
      [key]: value,
    })
  }, [globalFxSettings, setGlobalFxSettings])

  return (
    <div className="mx-auto w-full max-w-[960px] min-w-0 space-y-3 sm:space-y-4" data-tour="drum-rack-global-effects">
      <div className="rounded-xl border border-surface-border bg-surface-raised overflow-hidden">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-surface-border/60">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-accent-secondary">Global FX Chain</div>
            <div className="text-[10px] text-text-muted mt-0.5">Applies to all Drum Rack playback. Pitch/fades are global for every sample.</div>
          </div>
          <button
            onClick={clearGlobalFx}
            className="text-[10px] text-text-muted hover:text-text-secondary uppercase tracking-wider transition-colors"
          >
            Reset Global
          </button>
        </div>

        <div className="px-3 sm:px-4 py-3 border-b border-surface-border/40">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <div className="rounded-md border border-accent-secondary/35 bg-accent-secondary/10 p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-accent-secondary uppercase tracking-wider">Core</span>
                <select
                  value={globalFxSettings.pitchMode}
                  onChange={(e) => updateGlobal('pitchMode', e.target.value as LabPitchMode)}
                  className="bg-surface-base border border-surface-border rounded text-[9px] px-1 py-0.5 text-text-primary focus:outline-none focus:border-accent-secondary"
                  title="Pitch mode"
                >
                  {PITCH_MODES.map((mode) => (
                    <option key={mode} value={mode}>{getPitchModeLabel(mode)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-x-1.5 gap-y-1 place-items-center">
                <div className="col-span-2 flex justify-center pb-0.5">
                  <VstKnob
                    label="Pitch"
                    value={globalFxSettings.pitchSemitones}
                    min={-24}
                    max={24}
                    step={0.1}
                    defaultValue={DEFAULT_LAB_SETTINGS.pitchSemitones}
                    onChange={(v) => updateGlobal('pitchSemitones', v)}
                    format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}st`}
                    color="#06b6d4"
                    size={CORE_PITCH_KNOB_SIZE}
                  />
                </div>
                <VstKnob
                  label="In"
                  value={globalFxSettings.fadeIn}
                  min={0}
                  max={5}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.fadeIn}
                  onChange={(v) => updateGlobal('fadeIn', v)}
                  format={(v) => `${v.toFixed(2)}s`}
                  color="#06b6d4"
                  size={CORE_FADE_KNOB_SIZE}
                />
                <VstKnob
                  label="Out"
                  value={globalFxSettings.fadeOut}
                  min={0}
                  max={5}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.fadeOut}
                  onChange={(v) => updateGlobal('fadeOut', v)}
                  format={(v) => `${v.toFixed(2)}s`}
                  color="#06b6d4"
                  size={CORE_FADE_KNOB_SIZE}
                />
              </div>
              <button
                type="button"
                onClick={() => updateGlobal('preserveFormants', !globalFxSettings.preserveFormants)}
                disabled={globalFxSettings.pitchMode === 'tape'}
                className={`mt-1.5 w-full rounded border px-1.5 py-1 text-[9px] uppercase tracking-wider transition-colors ${
                  globalFxSettings.preserveFormants
                    ? 'border-emerald-500/70 bg-emerald-500/18 text-emerald-100'
                    : 'border-surface-border bg-surface-base text-text-primary'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Preserve vocal formants when using Granular/HQ pitch modes"
              >
                Preserve Formants
              </button>
            </div>

            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
              <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider mb-1.5">Output</div>
              <div className="flex items-center justify-center">
                <VstKnob
                  label="Gain"
                  value={globalFxSettings.outputGain}
                  min={0}
                  max={2}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.outputGain}
                  onChange={(v) => updateGlobal('outputGain', v)}
                  format={formatDb}
                  color="#34d399"
                  size={KNOB_SIZE}
                />
              </div>
            </div>

            <div className="rounded-md border border-indigo-500/25 bg-indigo-500/5 p-2">
              <div className="text-[10px] text-indigo-300/80 uppercase tracking-wider mb-1.5">Filters</div>
              <div className="grid grid-cols-1 gap-2">
                <div className="rounded border border-indigo-400/20 bg-indigo-500/5 p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-indigo-300/80 uppercase tracking-wider">LP</span>
                    <Led
                      active={globalFxSettings.lowpassEnabled}
                      onClick={() => updateGlobal('lowpassEnabled', !globalFxSettings.lowpassEnabled)}
                      color="#818cf8"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1 place-items-center">
                    <VstKnob
                      label="Freq"
                      value={globalFxSettings.lowpassFrequency}
                      min={100}
                      max={20000}
                      step={1}
                      defaultValue={DEFAULT_LAB_SETTINGS.lowpassFrequency}
                      onChange={(v) => updateGlobal('lowpassFrequency', v)}
                      format={(v) => `${Math.round(v)}Hz`}
                      color="#818cf8"
                      size={34}
                      disabled={!globalFxSettings.lowpassEnabled}
                    />
                    <VstKnob
                      label="Q"
                      value={globalFxSettings.lowpassQ}
                      min={0.1}
                      max={24}
                      step={0.1}
                      defaultValue={DEFAULT_LAB_SETTINGS.lowpassQ}
                      onChange={(v) => updateGlobal('lowpassQ', v)}
                      format={(v) => v.toFixed(1)}
                      color="#818cf8"
                      size={34}
                      disabled={!globalFxSettings.lowpassEnabled}
                    />
                  </div>
                </div>

                <div className="rounded border border-indigo-400/20 bg-indigo-500/5 p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-indigo-300/80 uppercase tracking-wider">HP</span>
                    <Led
                      active={globalFxSettings.highpassEnabled}
                      onClick={() => updateGlobal('highpassEnabled', !globalFxSettings.highpassEnabled)}
                      color="#818cf8"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1 place-items-center">
                    <VstKnob
                      label="Freq"
                      value={globalFxSettings.highpassFrequency}
                      min={20}
                      max={4000}
                      step={1}
                      defaultValue={DEFAULT_LAB_SETTINGS.highpassFrequency}
                      onChange={(v) => updateGlobal('highpassFrequency', v)}
                      format={(v) => `${Math.round(v)}Hz`}
                      color="#818cf8"
                      size={34}
                      disabled={!globalFxSettings.highpassEnabled}
                    />
                    <VstKnob
                      label="Q"
                      value={globalFxSettings.highpassQ}
                      min={0.1}
                      max={24}
                      step={0.1}
                      defaultValue={DEFAULT_LAB_SETTINGS.highpassQ}
                      onChange={(v) => updateGlobal('highpassQ', v)}
                      format={(v) => v.toFixed(1)}
                      color="#818cf8"
                      size={34}
                      disabled={!globalFxSettings.highpassEnabled}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-orange-500/25 bg-orange-500/5 p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-orange-300/80 uppercase tracking-wider">Dist</span>
                <Led
                  active={globalFxSettings.distortionEnabled}
                  onClick={() => updateGlobal('distortionEnabled', !globalFxSettings.distortionEnabled)}
                  color="#fb923c"
                />
              </div>
              <div className="flex items-center justify-center">
                <VstKnob
                  label="Amt"
                  value={globalFxSettings.distortionAmount}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.distortionAmount}
                  onChange={(v) => updateGlobal('distortionAmount', v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  color="#fb923c"
                  size={KNOB_SIZE}
                  disabled={!globalFxSettings.distortionEnabled}
                />
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
        >
          <span className="inline-flex items-center gap-1.5 uppercase tracking-wider">
            <SlidersHorizontal size={12} />
            More Global FX
          </span>
          {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {showAdvanced && (
          <div className="px-3 sm:px-4 pb-3 pt-1 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
            <div className="rounded-md border border-rose-500/25 bg-rose-500/5 p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-rose-300/80 uppercase tracking-wider">Compressor</span>
                <Led
                  active={globalFxSettings.compressorEnabled}
                  onClick={() => updateGlobal('compressorEnabled', !globalFxSettings.compressorEnabled)}
                  color="#fb7185"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 place-items-center">
                <VstKnob
                  label="Thresh"
                  value={globalFxSettings.compressorThreshold}
                  min={-80}
                  max={0}
                  step={1}
                  defaultValue={DEFAULT_LAB_SETTINGS.compressorThreshold}
                  onChange={(v) => updateGlobal('compressorThreshold', v)}
                  format={(v) => `${Math.round(v)}dB`}
                  color="#fb7185"
                  size={34}
                  disabled={!globalFxSettings.compressorEnabled}
                />
                <VstKnob
                  label="Ratio"
                  value={globalFxSettings.compressorRatio}
                  min={1}
                  max={20}
                  step={0.1}
                  defaultValue={DEFAULT_LAB_SETTINGS.compressorRatio}
                  onChange={(v) => updateGlobal('compressorRatio', v)}
                  format={(v) => `${v.toFixed(1)}:1`}
                  color="#fb7185"
                  size={34}
                  disabled={!globalFxSettings.compressorEnabled}
                />
              </div>
            </div>

            <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-amber-300/80 uppercase tracking-wider">Delay</span>
                <Led
                  active={globalFxSettings.delayEnabled}
                  onClick={() => updateGlobal('delayEnabled', !globalFxSettings.delayEnabled)}
                  color="#fbbf24"
                />
              </div>
              <div className="grid grid-cols-3 gap-1 place-items-center">
                <VstKnob
                  label="Time"
                  value={globalFxSettings.delayTime}
                  min={0}
                  max={2}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.delayTime}
                  onChange={(v) => updateGlobal('delayTime', v)}
                  format={(v) => `${v.toFixed(2)}s`}
                  color="#fbbf24"
                  size={34}
                  disabled={!globalFxSettings.delayEnabled}
                />
                <VstKnob
                  label="FB"
                  value={globalFxSettings.delayFeedback}
                  min={0}
                  max={0.95}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.delayFeedback}
                  onChange={(v) => updateGlobal('delayFeedback', v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  color="#fbbf24"
                  size={34}
                  disabled={!globalFxSettings.delayEnabled}
                />
                <VstKnob
                  label="Mix"
                  value={globalFxSettings.delayMix}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.delayMix}
                  onChange={(v) => updateGlobal('delayMix', v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  color="#fbbf24"
                  size={34}
                  disabled={!globalFxSettings.delayEnabled}
                />
              </div>
            </div>

            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-emerald-300/80 uppercase tracking-wider">Reverb</span>
                <Led
                  active={globalFxSettings.reverbEnabled}
                  onClick={() => updateGlobal('reverbEnabled', !globalFxSettings.reverbEnabled)}
                  color="#34d399"
                />
              </div>
              <div className="grid grid-cols-3 gap-1 place-items-center">
                <VstKnob
                  label="Len"
                  value={globalFxSettings.reverbSeconds}
                  min={0.1}
                  max={8}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.reverbSeconds}
                  onChange={(v) => updateGlobal('reverbSeconds', v)}
                  format={(v) => `${v.toFixed(2)}s`}
                  color="#34d399"
                  size={34}
                  disabled={!globalFxSettings.reverbEnabled}
                />
                <VstKnob
                  label="Decay"
                  value={globalFxSettings.reverbDecay}
                  min={0.5}
                  max={8}
                  step={0.05}
                  defaultValue={DEFAULT_LAB_SETTINGS.reverbDecay}
                  onChange={(v) => updateGlobal('reverbDecay', v)}
                  format={(v) => v.toFixed(2)}
                  color="#34d399"
                  size={34}
                  disabled={!globalFxSettings.reverbEnabled}
                />
                <VstKnob
                  label="Mix"
                  value={globalFxSettings.reverbMix}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={DEFAULT_LAB_SETTINGS.reverbMix}
                  onChange={(v) => updateGlobal('reverbMix', v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  color="#34d399"
                  size={34}
                  disabled={!globalFxSettings.reverbEnabled}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
