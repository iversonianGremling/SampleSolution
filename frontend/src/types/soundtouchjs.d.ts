declare module 'soundtouchjs' {
  export class SoundTouch {
    tempo: number
    rate: number
    pitchSemitones: number
    stretch: {
      setParameters: (sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number) => void
      quickSeek: boolean
    }
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer)
  }

  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, soundTouch: SoundTouch, onEnd?: () => void)
    extract(target: Float32Array, numFrames?: number): number
  }

  export function getWebAudioNode(
    context: AudioContext,
    filter: SimpleFilter,
    sourcePositionCallback?: (sourcePosition: number) => void,
    bufferSize?: number
  ): ScriptProcessorNode

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
