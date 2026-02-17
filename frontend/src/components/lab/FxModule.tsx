import { GripVertical } from 'lucide-react'

export interface FxModuleProps {
  title: string
  color: string
  enabled?: boolean
  onToggle?: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDragOver?: boolean
  children: React.ReactNode
}

export function FxModule({
  title,
  color,
  enabled = true,
  onToggle,
  draggable: isDraggable = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragOver = false,
  children,
}: FxModuleProps) {
  return (
    <div
      onDragOver={onDragOver}
      className={`min-w-[170px] flex-1 rounded-lg p-2.5 flex flex-col gap-2 transition-all ${isDragOver ? 'ring-1 ring-white/20' : ''}`}
      style={{
        background: isDragOver ? '#13151c' : '#0d0f14',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: enabled ? `${color}44` : '#1e2028',
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          {isDraggable && (
            <div
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              className="cursor-grab active:cursor-grabbing flex-shrink-0 p-0.5 -ml-1 rounded hover:bg-white/5"
            >
              <GripVertical size={14} className="text-slate-600" />
            </div>
          )}
          <span
            className="font-vst text-[11px] tracking-[0.2em] uppercase font-semibold"
            style={{ color: enabled ? color : '#4a4e58' }}
          >
            {title}
          </span>
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 px-2 py-1 rounded transition-all text-[10px] uppercase tracking-wider font-vst"
            style={{
              background: enabled ? `${color}22` : '#1a1c22',
              border: `1px solid ${enabled ? `${color}66` : '#2a2d35'}`,
              color: enabled ? color : '#4a4e58',
            }}
          >
            <span
              className="block w-2 h-2 rounded-full transition-all flex-shrink-0"
              style={{
                backgroundColor: enabled ? color : '#1e2028',
                boxShadow: enabled ? `0 0 6px ${color}` : 'none',
              }}
            />
            {enabled ? 'ON' : 'OFF'}
          </button>
        )}
      </div>
      <div className={enabled ? '' : 'opacity-30 pointer-events-none'}>{children}</div>
    </div>
  )
}
