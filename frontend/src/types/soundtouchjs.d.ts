declare module 'soundtouchjs' {
  export class PitchShifter {
    constructor(
      context: AudioContext,
      buffer: AudioBuffer,
      bufferSize: number,
      onEnd?: () => void
    )

    tempo: number
    pitchSemitones: number

    connect(toNode: AudioNode): void
    disconnect(): void
  }
}