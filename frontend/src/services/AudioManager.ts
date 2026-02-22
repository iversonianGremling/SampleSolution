/**
 * Centralized audio management system for preventing duplicate playback
 * and coordinating audio across the application
 */

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
   * Stop any currently playing audio
   */
  stopAll(): void {
    if (this.currentPlayback) {
      const { audioElement } = this.currentPlayback
      audioElement.pause()
      audioElement.currentTime = 0
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

    // Stop any currently playing audio
    this.stopAll()

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
          this.currentPlayback.isPlaying = false
          this.currentPlayback.onEnd?.()
        }
      }

      // Handle audio error
      const handleError = () => {
        if (this.currentPlayback?.audioId === audioId) {
          this.currentPlayback.isPlaying = false
          this.currentPlayback.onEnd?.()
        }
      }

      audio.addEventListener('ended', handleEnd)
      audio.addEventListener('error', handleError)

      // Attempt to play
      audio.play().catch(() => {
        if (this.currentPlayback?.audioId === audioId) {
          this.currentPlayback.isPlaying = false
          this.currentPlayback.onEnd?.()
        }
      })

      return true
    } catch (error) {
      console.error('Failed to create audio element:', error)
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
}

export default AudioManager
