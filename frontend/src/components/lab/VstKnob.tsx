import { useCallback, useId, useRef } from 'react'
import { clamp } from './helpers'

const KNOB_ARC_START = 225
const KNOB_ARC_RANGE = 270

export interface VstKnobProps {
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  onChange: (next: number) => void
  label: string
  format?: (value: number) => string
  color?: string
  size?: number
  disabled?: boolean
}

export function VstKnob({
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  onChange,
  label,
  format,
  color = '#06b6d4',
  size = 44,
  disabled = false,
}: VstKnobProps) {
  const uid = useId()
  const knobRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null)

  const normalized = clamp((value - min) / (max - min), 0, 1)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { startY: e.clientY, startValue: value }
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
    },
    [value, disabled],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current || disabled) return
      const sensitivity = e.shiftKey ? 600 : 200
      const dy = dragRef.current.startY - e.clientY
      const range = max - min
      const delta = (dy / sensitivity) * range
      let next = dragRef.current.startValue + delta
      next = Math.round(next / step) * step
      next = clamp(next, min, max)
      onChange(next)
    },
    [min, max, step, onChange, disabled],
  )

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      if (defaultValue !== undefined) {
        onChange(defaultValue)
      }
    },
    [disabled, defaultValue, onChange],
  )

  const r = size / 2
  const strokeWidth = 3
  const arcR = r - strokeWidth - 2
  const cx = r
  const cy = r

  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180
  const arcPoint = (deg: number) => ({
    x: cx + arcR * Math.cos(toRad(deg)),
    y: cy + arcR * Math.sin(toRad(deg)),
  })

  const startAngle = KNOB_ARC_START
  const valueAngle = startAngle + normalized * KNOB_ARC_RANGE

  const describeArc = (from: number, to: number) => {
    const s = arcPoint(from)
    const e = arcPoint(to)
    const sweep = to - from
    const largeArc = sweep > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${arcR} ${arcR} 0 ${largeArc} 1 ${e.x} ${e.y}`
  }

  const indRad = toRad(valueAngle)
  const indLen = arcR - 4
  const indX = cx + indLen * Math.cos(indRad)
  const indY = cy + indLen * Math.sin(indRad)
  const indStartX = cx + 6 * Math.cos(indRad)
  const indStartY = cy + 6 * Math.sin(indRad)

  const displayValue = format ? format(value) : value.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)
  const bodyGradTop = 'rgb(var(--color-surface-overlay-rgb) / 0.96)'
  const bodyGradMiddle = 'rgb(var(--color-surface-border-rgb) / 0.95)'
  const bodyGradBottom = 'rgb(var(--color-surface-base-rgb) / 1)'
  const bodyStroke = 'rgb(var(--color-surface-border-rgb) / 0.95)'
  const arcTrack = 'rgb(var(--color-surface-border-rgb) / 0.9)'

  return (
    <div
      draggable={false}
      className={`flex flex-col items-center gap-0.5 select-none ${disabled ? 'opacity-30 pointer-events-none' : ''}`}
    >
      <svg
        ref={knobRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="cursor-ns-resize"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <radialGradient id={`${uid}-body`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={bodyGradTop} />
            <stop offset="60%" stopColor={bodyGradMiddle} />
            <stop offset="100%" stopColor={bodyGradBottom} />
          </radialGradient>
          <filter id={`${uid}-glow`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Body */}
        <circle cx={cx} cy={cy} r={arcR + 1} fill={`url(#${uid}-body)`} stroke={bodyStroke} strokeWidth="1" />

        {/* Track arc (background) */}
        <path d={describeArc(startAngle, startAngle + KNOB_ARC_RANGE)} fill="none" stroke={arcTrack} strokeWidth={strokeWidth} strokeLinecap="round" />

        {/* Active arc */}
        {normalized > 0.003 && (
          <path
            d={describeArc(startAngle, valueAngle)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            filter={`url(#${uid}-glow)`}
            opacity={0.9}
          />
        )}

        {/* Indicator line */}
        <line
          x1={indStartX}
          y1={indStartY}
          x2={indX}
          y2={indY}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>

      <span className="font-vst text-[10px] tracking-widest uppercase text-text-muted leading-none mt-0.5">
        {label}
      </span>
      <span className="font-vst-mono text-[10px] leading-none" style={{ color }}>
        {displayValue}
      </span>
    </div>
  )
}
