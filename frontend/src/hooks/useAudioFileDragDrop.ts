import { useCallback, useState, useRef } from 'react'

interface UseAudioFileDragDropOptions {
  fileUrl: string
  fileName: string
}

interface DragHandlers {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}

export function useAudioFileDragDrop({
  fileUrl,
  fileName,
}: UseAudioFileDragDropOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const fileRef = useRef<File | null>(null)

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      setIsDragging(true)

      // Fetch the audio file and create a File object for dragging
      fetch(fileUrl)
        .then((response) => response.blob())
        .then((blob) => {
          const file = new File([blob], fileName, { type: blob.type })
          fileRef.current = file

          // Set up the drag image and data transfer
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copy'
            e.dataTransfer.setData('Files', fileName)
            // Set custom drag image
            const dragImage = new Image()
            dragImage.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M9 19V5m-4 7h8m-8 0l-4-4m4 4l4-4"/%3E%3C/svg%3E'
            e.dataTransfer.setDragImage(dragImage, 16, 16)
          }
        })
        .catch(() => {
          // Fallback if fetch fails
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copy'
          }
        })
    },
    [fileUrl, fileName]
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    fileRef.current = null
  }, [])

  const handlers: DragHandlers = {
    draggable: true,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
  }

  return {
    isDragging,
    handlers,
  }
}
