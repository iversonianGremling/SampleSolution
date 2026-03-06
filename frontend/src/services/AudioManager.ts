/**
 * Centralized audio management system for preventing duplicate playback
 * and coordinating audio across the application
 */
import { logRendererError, logRendererInfo } from '../utils/rendererLog'

interface AudioPlaybackState {
  audioId: number | string
  audioElement: HTMLAudioElement
  isPlaying: boolean
  isPaused: boolean
  onEnd?: () => void
}

export class AudioManager {
  private static instance: AudioManager
  private currentPlayback: AudioPlaybackState | null = null

  private constructor() {}

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager()
    }
    return AudioManager.instance
  }

  /**
   * Check if audio with a specific ID is currently playing
   */
  isPlayingId(audioId: number | string): boolean {
    return this.currentPlayback?.audioId === audioId && this.currentPlayback?.isPlaying
  }

  /**
   * Check if any audio is currently playing
   */
  isAnyAudioPlaying(): boolean {
    return this.currentPlayback?.isPlaying ?? false
  }

  /**
   * Get the ID of currently playing audio, or null if nothing is playing
   */
  getCurrentAudioId(): number | string | null {
    return this.currentPlayback?.audioId ?? null
  }

  /**
   * Stop any currently playing audio and fully release the HTMLAudioElement.
   *
   * On Windows Electron each HTMLAudioElement holds an open WASAPI stream handle.
   * Simply calling .pause() keeps the handle alive until GC. With rapid hover-play
   * (8+ elements created in <2 seconds) the OS audio session limit is hit and the
   * renderer crashes (exit -1073741819 / 0xC0000005).
   *
   * Setting src='' and calling load() forces Chromium to immediately close the
   * underlying media pipeline and release the WASAPI handle synchronously.
   */
  stopAll(): void {
    if (this.currentPlayback) {
      const { audioElement } = this.currentPlayback
      logRendererInfo('AudioManager.stopAll', `Stopping audioId=${this.currentPlayback.audioId}`)
      audioElement.pause()
      audioElement.src = ''
      audioElement.load()
      this.currentPlayback.isPlaying = false
      this.currentPlayback.isPaused = false
    }
  }

  /**
   * Pause currently playing audio
   */
  pause(): void {
    if (this.currentPlayback && this.currentPlayback.isPlaying) {
      this.currentPlayback.audioElement.pause()
      this.currentPlayback.isPlaying = false
      this.currentPlayback.isPaused = true
    }
  }

  /**
   * Resume paused audio
   */
  resume(): void {
    if (this.currentPlayback && this.currentPlayback.isPaused) {
      this.currentPlayback.audioElement.play().catch(() => {
        this.currentPlayback!.isPlaying = false
      })
      this.currentPlayback.isPlaying = true
      this.currentPlayback.isPaused = false
    }
  }

  /**
   * Check if audio is currently paused
   */
  isPaused(): boolean {
    return this.currentPlayback?.isPaused ?? false
  }

  /**
   * Play audio with the given ID and source URL
   * Returns false if audio with the same ID is already playing (prevents retrigger)
   */
  play(
    audioId: number | string,
    audioUrl: string,
    options?: { volume?: number; playbackRate?: number; onEnd?: () => void }
  ): boolean {
    // Prevent retriggering the same audio
    if (this.isPlayingId(audioId)) {
      return false
    }

    // Fully destroy the previous element before creating a new one.
    // On Windows, stopAll() only pauses — releaseCurrentElement() also clears
    // src and calls load() to synchronously release the WASAPI stream handle.
    this.releaseCurrentElement()
    logRendererInfo(
      'AudioManager.play',
      `audioId=${audioId} url=${audioUrl} rate=${options?.playbackRate ?? 1} volume=${options?.volume ?? 1}`
    )

    try {
      const audio = new Audio(audioUrl)
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

      if (options?.volume !== undefined) {
        audio.volume = Math.max(0, Math.min(1, options.volume))
      }
      if (options?.playbackRate !== undefined && Number.isFinite(options.playbackRate)) {
        audio.playbackRate = Math.max(0.25, Math.min(4, options.playbackRate))
      }

      this.currentPlayback = {
        audioId,
        audioElement: audio,
        isPlaying: true,
        isPaused: false,
        onEnd: options?.onEnd,
      }

      // Handle audio end
      const handleEnd = () => {
        if (this.currentPlayback?.audioId === audioId) {
          logRendererInfo('AudioManager.ended', `audioId=${audioId}`)
          this.currentPlayback.isPlaying = false
          this.currentPlayback.onEnd?.()
        }
      }

      // Handle audio error
      const handleError = () => {
        if (this.currentPlayback?.audioId === audioId) {
          logRendererError(
            'AudioManager.error',
            `audioId=${audioId} src=${audio.currentSrc || audioUrl} code=${audio.error?.code ?? 'unknown'}`
          )
          this.currentPlayback.isPlaying = false
          this.currentPlayback.onEnd?.()
        }
      }

      audio.addEventListener('ended', handleEnd)
      audio.addEventListener('error', handleError)

      // Attempt to play
      audio.play().catch((error) => {
        if (this.currentPlayback?.audioId === audioId) {
          logRendererError('AudioManager.playReject', error)
          this.currentPlayback.isPlaying = false
          this.currentPlayback.onEnd?.()
        }
      })

      return true
    } catch (error) {
      logRendererError('AudioManager.createFailed', error)
      this.currentPlayback = null
      return false
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopAll()
    this.currentPlayback = null
  }

  /**
   * Fully tear down the current audio element (src='', load()) without logging.
   * Called internally when replacing playback to ensure the old WASAPI handle
   * is released before a new element is created.
   */
  private releaseCurrentElement(): void {
    if (!this.currentPlayback) return
    const { audioElement } = this.currentPlayback
    audioElement.pause()
    audioElement.src = ''
    audioElement.load()
    this.currentPlayback = null
  }
}

export default AudioManager
