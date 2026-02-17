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
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-vst text-slate-400 hover:text-slate-200 transition-colors"
    >
      <span
        className="block w-2.5 h-2.5 rounded-full transition-all"
        style={{
          backgroundColor: active ? color : '#1e2028',
          boxShadow: active ? `0 0 6px ${color}, 0 0 2px ${color}` : 'inset 0 1px 2px rgba(0,0,0,0.6)',
          border: active ? 'none' : '1px solid #2a2d35',
        }}
      />
      {label && <span>{label}</span>}
    </button>
  )
}
