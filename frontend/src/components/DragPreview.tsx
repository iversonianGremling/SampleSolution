import { Layers } from 'lucide-react'

interface DragPreviewProps {
  count: number
}

export function DragPreview({ count }: DragPreviewProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-accent-primary rounded-lg shadow-lg">
      <Layers size={20} className="text-white" />
      <span className="text-white font-semibold">{count}</span>
    </div>
  )
}

// Helper function to create a custom drag image
export function createDragPreview(count: number): HTMLElement {
  const preview = document.createElement('div')

  // Position it visible but far to the right temporarily
  preview.style.position = 'fixed'
  preview.style.top = '0px'
  preview.style.left = '100vw'
  preview.style.display = 'flex'
  preview.style.alignItems = 'center'
  preview.style.gap = '8px'
  preview.style.padding = '8px 12px'
  preview.style.backgroundColor = '#6366f1'
  preview.style.borderRadius = '8px'
  preview.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
  preview.style.zIndex = '9999'
  preview.style.pointerEvents = 'none'

  const icon = document.createElement('div')
  icon.style.display = 'flex'
  icon.style.alignItems = 'center'
  icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>`

  const countText = document.createElement('span')
  countText.style.color = 'white'
  countText.style.fontWeight = '600'
  countText.style.fontSize = '14px'
  countText.textContent = count.toString()

  preview.appendChild(icon)
  preview.appendChild(countText)
  document.body.appendChild(preview)

  return preview
}
