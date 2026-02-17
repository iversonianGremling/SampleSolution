import { ChevronLeft, ChevronUp } from 'lucide-react'

interface ResizableDividerProps {
  direction: 'horizontal' | 'vertical'
  isDragging?: boolean
  isCollapsed?: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onExpand?: () => void
}

export function ResizableDivider({
  direction,
  isDragging = false,
  isCollapsed = false,
  onMouseDown,
  onDoubleClick,
  onExpand,
}: ResizableDividerProps) {
  const isHorizontal = direction === 'horizontal'

  return (
    <div
      className={`resize-divider ${isHorizontal ? 'resize-divider-horizontal' : 'resize-divider-vertical'} ${isDragging ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {/* Grip dots */}
      <div className={`resize-divider-grip ${isHorizontal ? 'flex-col' : 'flex-row'}`}>
        <span className="resize-divider-dot" />
        <span className="resize-divider-dot" />
        <span className="resize-divider-dot" />
      </div>

      {/* Expand chevron when collapsed */}
      {isCollapsed && onExpand && (
        <button
          className="resize-divider-expand"
          onClick={(e) => {
            e.stopPropagation()
            onExpand()
          }}
        >
          {isHorizontal ? <ChevronLeft size={12} /> : <ChevronUp size={12} />}
        </button>
      )}
    </div>
  )
}
