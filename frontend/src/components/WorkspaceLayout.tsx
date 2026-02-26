import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, FlaskConical, Info, Layers3 } from 'lucide-react'
import { useResizablePanel } from '../hooks/useResizablePanel'
import { ResizableDivider } from './ResizableDivider'
import { SourcesView } from './SourcesView'
import { BulkRenamePanel } from './BulkRenamePanel'
import { LabView } from './LabView'
import { DrumRackView } from './DrumRackView'
import { SampleDetailsView } from './SampleDetailsView'
import {
  DEFAULT_BULK_RENAME_RULES,
  type BulkRenameRules,
} from '../utils/bulkRename'
import type { SliceWithTrackExtended } from '../types'
import type { WorkspaceState, WorkspaceTab } from '../types/workspace'
import type { PlayMode } from './SourcesView'
import { useToast } from '../contexts/ToastContext'

const DEFAULT_VIEWPORT_WIDTH = 1366

function getViewportWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_VIEWPORT_WIDTH
  return window.innerWidth
}

interface WorkspaceLayoutProps {
  mode: 'workspace' | 'bulk-rename'
  tuneTargetNote: string | null
  onTuneToNote: (note: string | null) => void
  samplePlayMode: PlayMode
  sampleLoopEnabled: boolean
}

export function WorkspaceLayout({
  mode,
  tuneTargetNote,
  onTuneToNote,
  samplePlayMode,
  sampleLoopEnabled,
}: WorkspaceLayoutProps) {
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('details')
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null)
  const [showIconOnlyTabs, setShowIconOnlyTabs] = useState(false)
  const [isPanelHidden, setIsPanelHidden] = useState(true)
  const [showNotification, setShowNotification] = useState(false)
  const [visibleSamples, setVisibleSamples] = useState<SliceWithTrackExtended[]>([])
  const [selectedSamples, setSelectedSamples] = useState<SliceWithTrackExtended[]>([])
  const [isSourcesLoading, setIsSourcesLoading] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth())
  const lastNotifiedSampleIdRef = useRef<number | null>(null)
  const previousShowRightPanelRef = useRef<boolean | null>(null)
  const [bulkRenameRules, setBulkRenameRules] = useState<BulkRenameRules>(() => ({
    ...DEFAULT_BULK_RENAME_RULES,
    filterText: '',
  }))

  const dividerWidth = 2
  const panelToggleWidth = 14
  const splitAvailableWidth = Math.max(viewportWidth - dividerWidth, 0)
  const sidePanelMinWidth = Math.max(120, Math.floor(splitAvailableWidth * 0.15))
  const sidePanelMaxWidth = Math.max(sidePanelMinWidth, Math.floor(splitAvailableWidth * 0.35))
  const sidePanelDefaultWidth = Math.max(
    sidePanelMinWidth,
    Math.min(sidePanelMaxWidth, Math.floor(splitAvailableWidth * 0.2)),
  )
  const sourcesPanelMinWidth = Math.max(120, splitAvailableWidth - sidePanelMaxWidth)
  const sourcesPanelMaxWidth = Math.max(sourcesPanelMinWidth, splitAvailableWidth - sidePanelMinWidth)
  const sourcesPanelInitialWidth = Math.max(
    sourcesPanelMinWidth,
    Math.min(sourcesPanelMaxWidth, splitAvailableWidth - sidePanelDefaultWidth),
  )

  const horizontal = useResizablePanel({
    direction: 'horizontal',
    initialSize: sourcesPanelInitialWidth,
    minSize: sourcesPanelMinWidth,
    maxSize: sourcesPanelMaxWidth,
    storageKey: 'workspace-h-size-v2',
    clampOnBoundsChange: true,
  })

  const isBulkRenameMode = mode === 'bulk-rename'
  const hasSelectedSample = workspaceState?.selectedSample !== null
  const shouldShowPanel = isBulkRenameMode || activeTab !== 'details' || hasSelectedSample
  const showRightPanel = isBulkRenameMode ? true : shouldShowPanel && !isPanelHidden
  const panelVisibilityChangedThisRender =
    previousShowRightPanelRef.current !== null && previousShowRightPanelRef.current !== showRightPanel
  const shouldAnimate = !horizontal.isDragging && !panelVisibilityChangedThisRender
  const shouldReserveToggleGutter = !isBulkRenameMode && shouldShowPanel

  useEffect(() => {
    const handleResize = () => setViewportWidth(getViewportWidth())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    previousShowRightPanelRef.current = showRightPanel
  }, [showRightPanel])

  useEffect(() => {
    // Keep room for panel controls by collapsing labels on narrower viewports.
    setShowIconOnlyTabs(viewportWidth < 1280)
  }, [viewportWidth])

  // Notify when content changes while panel is closed
  useEffect(() => {
    if (isBulkRenameMode) {
      setShowNotification(false)
      return
    }
    if (isPanelHidden && shouldShowPanel) {
      setShowNotification(true)
      const timer = setTimeout(() => setShowNotification(false), 1200) // 600ms * 2 cycles
      return () => clearTimeout(timer)
    }
  }, [workspaceState?.selectedSample?.id, activeTab, isPanelHidden, shouldShowPanel, isBulkRenameMode])

  useEffect(() => {
    if (isBulkRenameMode) return

    const selectedSampleId = workspaceState?.selectedSample?.id ?? null
    if (selectedSampleId === null) {
      lastNotifiedSampleIdRef.current = null
      return
    }

    const isNewSelection = lastNotifiedSampleIdRef.current !== selectedSampleId
    if (!isNewSelection) return

    lastNotifiedSampleIdRef.current = selectedSampleId
    if (!showRightPanel && shouldShowPanel) {
      showToast({
        kind: 'info',
        message: 'Sample loaded. Open the right panel with the arrow button to view details.',
        actionLabel: 'Open Panel',
        onAction: () => {
          setActiveTab('details')
          setIsPanelHidden(false)
          setShowNotification(false)
        },
      })
    }
  }, [
    workspaceState?.selectedSample?.id,
    isBulkRenameMode,
    showRightPanel,
    shouldShowPanel,
    showToast,
  ])

  const handleClosePanel = () => {
    if (isBulkRenameMode) return
    setIsPanelHidden(true)
  }

  const handleShowPanel = useCallback(() => {
    setIsPanelHidden(false)
    setShowNotification(false)
  }, [])

  return (
    <div className="h-full flex overflow-hidden bg-surface-base">
      <div
        className={shouldAnimate ? 'panel-animate' : ''}
        style={{
          width: showRightPanel ? horizontal.size : '100%',
          minWidth: showRightPanel ? sourcesPanelMinWidth : 0,
          flexShrink: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          position: 'relative',
          paddingRight: shouldReserveToggleGutter ? panelToggleWidth : 0,
        }}
      >
        <SourcesView
          workspaceTab={activeTab}
          tuneTargetNote={tuneTargetNote}
          onTuneToNote={onTuneToNote}
          playMode={samplePlayMode}
          loopEnabled={sampleLoopEnabled}
          bulkRenameMode={isBulkRenameMode}
          bulkRenameRules={bulkRenameRules}
          onBulkRenameRulesChange={setBulkRenameRules}
          onWorkspaceStateChange={setWorkspaceState}
          onVisibleSamplesChange={setVisibleSamples}
          onSelectedSamplesChange={setSelectedSamples}
          onSamplesLoadingChange={setIsSourcesLoading}
        />

        {/* Toggle panel button */}
        {!isBulkRenameMode && shouldShowPanel && (
          <button
            onClick={showRightPanel ? handleClosePanel : handleShowPanel}
            className={`absolute inset-y-0 right-0 border-l border-surface-border bg-surface-overlay flex items-center justify-center transition-colors hover:bg-surface-border/80 z-10 ${showNotification ? 'chevron-notify' : ''}`}
            style={{ width: panelToggleWidth }}
            title={showRightPanel ? "Close panel" : "Show panel"}
          >
            <ChevronLeft
              size={12}
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
          <div
            className="relative flex-1 min-w-0 flex flex-col overflow-hidden"
            style={{ minWidth: sidePanelMinWidth }}
          >
            {isBulkRenameMode ? (
              <BulkRenamePanel
                scopedSamples={visibleSamples}
                selectedSamples={selectedSamples}
                isSamplesLoading={isSourcesLoading}
                rules={bulkRenameRules}
                onRulesChange={setBulkRenameRules}
              />
            ) : (
              <>
                <div className="border-b border-surface-border bg-surface-raised px-2 flex items-center justify-end">
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => setActiveTab('details')}
                      className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                        activeTab === 'details'
                          ? 'text-text-primary'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                      title="Details"
                    >
                      <Info size={12} />
                      {!showIconOnlyTabs && <span>Details</span>}
                      {activeTab === 'details' && (
                        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-text-secondary/50 rounded-t-full" />
                      )}
                    </button>
                    <button
                      onClick={() => setActiveTab('rack')}
                      className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                        activeTab === 'rack'
                          ? 'text-accent-primary'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                      title="Rack"
                    >
                      <Layers3 size={12} />
                      {!showIconOnlyTabs && <span>Rack</span>}
                      {activeTab === 'rack' && (
                        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent-primary/60 rounded-t-full" />
                      )}
                    </button>
                    <button
                      onClick={() => setActiveTab('lab')}
                      className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                        activeTab === 'lab'
                          ? 'text-cyan-300'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                      title="Lab"
                    >
                      <FlaskConical size={12} />
                      {!showIconOnlyTabs && <span>Lab</span>}
                      {activeTab === 'lab' && (
                        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-cyan-400/50 rounded-t-full" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {activeTab === 'rack' ? (
                    <DrumRackView />
                  ) : activeTab === 'lab' ? (
                    <LabView selectedSample={workspaceState?.selectedSample ?? null} />
                  ) : activeTab === 'details' && workspaceState?.selectedSample ? (
                    <SampleDetailsView
                      sample={workspaceState.selectedSample}
                      allTags={workspaceState.allTags}
                      folders={workspaceState.folders}
                      pitchSemitones={workspaceState.pitchSemitones}
                      tuneTargetNote={tuneTargetNote}
                      onToggleFavorite={workspaceState.onToggleFavorite}
                      onAddTag={workspaceState.onAddTag}
                      onRemoveTag={workspaceState.onRemoveTag}
                      onAddToFolder={workspaceState.onAddToFolder}
                      onRemoveFromFolder={workspaceState.onRemoveFromFolder}
                      onUpdateName={workspaceState.onUpdateName}
                      onUpdateSample={workspaceState.onUpdateSample}
                      onTagClick={workspaceState.onTagClick}
                      onSelectSample={workspaceState.onSelectSample}
                      onFilterBySimilarity={workspaceState.onFilterBySimilarity}
                      onSampleDeleted={workspaceState.onSampleDeleted}
                      onTuneToNote={onTuneToNote}
                    />
                  ) : activeTab === 'details' ? (
                    <div className="h-full flex items-center justify-center px-6">
                      <div className="w-full max-w-md rounded-xl border border-dashed border-surface-border bg-surface-overlay/30 p-8 text-center">
                        <div className="text-sm text-text-secondary font-medium">Select a sample to view details</div>
                        <div className="mt-2 text-xs text-text-muted leading-relaxed">Pick a sample from the Sources panel on the left.</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
