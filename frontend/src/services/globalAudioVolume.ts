let globalMasterVolume = 0.9

const activeAudio = new Map<HTMLAudioElement, number>()
const volumeListeners = new Set<(volume: number) => void>()

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

const applyVolume = (audio: HTMLAudioElement, baseVolume: number) => {
  audio.volume = clamp01(baseVolume) * globalMasterVolume
}

const disablePitchPreservation = (audio: HTMLAudioElement) => {
  const media = audio as HTMLAudioElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }

  if (typeof media.preservesPitch === 'boolean') {
    media.preservesPitch = false
  }
  if (typeof media.mozPreservesPitch === 'boolean') {
    media.mozPreservesPitch = false
  }
  if (typeof media.webkitPreservesPitch === 'boolean') {
    media.webkitPreservesPitch = false
  }
}

export function getGlobalAudioVolume() {
  return globalMasterVolume
}

export function setGlobalAudioVolume(volume: number) {
  globalMasterVolume = clamp01(volume)

  for (const [audio, baseVolume] of activeAudio.entries()) {
    applyVolume(audio, baseVolume)
  }
  for (const listener of volumeListeners) {
    listener(globalMasterVolume)
  }
}

export function subscribeGlobalAudioVolume(listener: (volume: number) => void) {
  volumeListeners.add(listener)
  return () => { volumeListeners.delete(listener) }
}

export function createManagedAudio(
  src: string,
  options?: {
    baseVolume?: number
    loop?: boolean
  }
) {
  const audio = new Audio(src)
  const baseVolume = clamp01(options?.baseVolume ?? 1)

  audio.loop = options?.loop ?? false
  disablePitchPreservation(audio)
  activeAudio.set(audio, baseVolume)
  applyVolume(audio, baseVolume)

  const cleanup = () => {
    activeAudio.delete(audio)
    audio.removeEventListener('ended', cleanup)
    audio.removeEventListener('error', cleanup)
  }

  audio.addEventListener('ended', cleanup)
  audio.addEventListener('error', cleanup)

  return audio
}

export function releaseManagedAudio(audio: HTMLAudioElement | null) {
  if (!audio) return

  activeAudio.delete(audio)
}
