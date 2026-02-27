export interface LedProps {
  active: boolean
  onClick: () => void
  label?: string
  color?: string
}

export function Led({ active, onClick, label, color = '#06b6d4' }: LedProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-vst text-text-muted hover:text-text-secondary transition-colors"
    >
      <span
        className="block w-2.5 h-2.5 rounded-full transition-all"
        style={{
          backgroundColor: active ? color : 'rgb(var(--color-surface-border-rgb) / 1)',
          boxShadow: active ? `0 0 6px ${color}, 0 0 2px ${color}` : 'none',
          border: active ? 'none' : '1px solid rgb(var(--color-surface-border-rgb) / 0.9)',
        }}
      />
      {label && <span>{label}</span>}
    </button>
  )
}
