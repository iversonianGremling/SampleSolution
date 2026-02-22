export type TunePlaybackMode = 'tape' | 'granular' | 'hq'

export const TUNE_PLAYBACK_MODE_STORAGE_KEY = 'sources-tune-playback-mode'
export const TUNE_PLAYBACK_MODE_EVENT = 'sample-solution:tune-playback-mode-changed'

const VALID_TUNE_PLAYBACK_MODES: TunePlaybackMode[] = ['tape', 'granular', 'hq']

const isTunePlaybackMode = (value: unknown): value is TunePlaybackMode => {
  return typeof value === 'string' && VALID_TUNE_PLAYBACK_MODES.includes(value as TunePlaybackMode)
}

export const getTunePlaybackMode = (): TunePlaybackMode => {
  if (typeof window === 'undefined') return 'tape'

  const stored = window.localStorage.getItem(TUNE_PLAYBACK_MODE_STORAGE_KEY)
  return isTunePlaybackMode(stored) ? stored : 'tape'
}

export const setTunePlaybackMode = (mode: TunePlaybackMode) => {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(TUNE_PLAYBACK_MODE_STORAGE_KEY, mode)
  window.dispatchEvent(
    new CustomEvent<TunePlaybackMode>(TUNE_PLAYBACK_MODE_EVENT, {
      detail: mode,
    })
  )
}
