import { useState, useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useResizablePanel } from '../hooks/useResizablePanel'
import { ResizableDivider } from './ResizableDivider'
import { SourcesView } from './SourcesView'
import { LabView } from './LabView'
import { DrumRackView } from './DrumRackView'
import { SampleDetailsView } from './SampleDetailsView'
import type { SliceWithTrackExtended, Tag, Folder } from '../types'

type RightPanelTab = 'details' | 'rack' | 'lab'

interface WorkspaceState {
  selectedSample: SliceWithTrackExtended | null
  allTags: Tag[]
  folders: Folder[]
  onToggleFavorite: (sliceId: number) => void
  onAddTag: (sliceId: number, tagId: number) => void
  onRemoveTag: (sliceId: number, tagId: number) => void
  onAddToFolder: (folderId: number, sliceId: number) => void
  onRemoveFromFolder: (folderId: number, sliceId: number) => void
  onUpdateName: (sliceId: number, name: string) => void
  onTagClick: (tagId: number) => void
}

export function WorkspaceLayout() {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('details')
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null)
  const [isPanelHidden, setIsPanelHidden] = useState(false)
  const [showNotification, setShowNotification] = useState(false)

  const horizontal = useResizablePanel({
    direction: 'horizontal',
    initialSize: Math.floor(window.innerWidth * 0.55),
    minSize: 320,
    maxSize: Math.floor(window.innerWidth * 0.82),
    storageKey: 'workspace-h-size',
  })

  const shouldAnimate = !horizontal.isDragging
  const shouldShowPanel = activeTab !== 'details' || (activeTab === 'details' && workspaceState?.selectedSample !== null)
  const showRightPanel = shouldShowPanel && !isPanelHidden

  // Notify when content changes while panel is closed
  useEffect(() => {
    if (isPanelHidden && shouldShowPanel) {
      setShowNotification(true)
      const timer = setTimeout(() => setShowNotification(false), 1200) // 600ms * 2 cycles
      return () => clearTimeout(timer)
    }
  }, [workspaceState?.selectedSample?.id, activeTab, isPanelHidden, shouldShowPanel])

  const handleClosePanel = () => {
    setIsPanelHidden(true)
  }

  const handleShowPanel = () => {
    setIsPanelHidden(false)
    setShowNotification(false)
  }

  return (
    <div className="h-full flex overflow-hidden bg-surface-base">
      <div
        className={shouldAnimate ? 'panel-animate' : ''}
        style={{
          width: showRightPanel ? horizontal.size : window.innerWidth,
          minWidth: 320,
          flexShrink: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <SourcesView
          workspaceTab={activeTab}
          onWorkspaceTabChange={setActiveTab}
          onWorkspaceStateChange={setWorkspaceState}
        />

        {/* Toggle panel button */}
        {shouldShowPanel && (
          <button
            onClick={showRightPanel ? handleClosePanel : handleShowPanel}
            className={`absolute top-1/2 right-0 -translate-y-1/2 bg-surface-raised border border-surface-border rounded-l-lg p-2 hover:bg-surface-overlay transition-colors shadow-lg z-10 ${showNotification ? 'chevron-notify' : ''}`}
            title={showRightPanel ? "Close panel" : "Show panel"}
          >
            <ChevronLeft
              size={20}
              className={`text-slate-400 transition-transform duration-300 ${showRightPanel ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {showRightPanel && (
        <>
          <ResizableDivider
            direction="horizontal"
            isDragging={horizontal.isDragging}
            isCollapsed={horizontal.isCollapsed}
            onMouseDown={horizontal.dividerProps.onMouseDown}
            onDoubleClick={horizontal.dividerProps.onDoubleClick}
            onExpand={horizontal.restore}
          />

          {/* Main right-side workspace */}
          <div className="flex-1 min-w-[380px] flex flex-col overflow-hidden">
              {activeTab === 'rack' ? (
                <DrumRackView />
              ) : activeTab === 'lab' ? (
                <LabView selectedSample={workspaceState?.selectedSample ?? null} />
              ) : activeTab === 'details' && workspaceState ? (
                <SampleDetailsView
                  sample={workspaceState.selectedSample}
                  allTags={workspaceState.allTags}
                  folders={workspaceState.folders}
                  onToggleFavorite={workspaceState.onToggleFavorite}
                  onAddTag={workspaceState.onAddTag}
                  onRemoveTag={workspaceState.onRemoveTag}
                  onAddToFolder={workspaceState.onAddToFolder}
                  onRemoveFromFolder={workspaceState.onRemoveFromFolder}
                  onUpdateName={workspaceState.onUpdateName}
                  onTagClick={workspaceState.onTagClick}
                />
              ) : null}
          </div>
        </>
      )}
    </div>
  )
}
