declare module 'react-rotary-knob' {
  import type { ComponentType } from 'react'

  export interface KnobProps {
    min?: number
    max?: number
    step?: number
    value?: number
    width?: number
    height?: number
    unlockDistance?: number
    onChange?: (value: number) => void
  }

  export const Knob: ComponentType<KnobProps>
  export default Knob
}