import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LogOut,
  Settings,
  X,
  Copy,
  Mail,
  ExternalLink,
  Volume2,
  VolumeX,
  Square,
  Play,
  MousePointerClick,
  Repeat,
  HelpCircle,
  Heart,
  ChevronDown,
} from 'lucide-react'
import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import frontendPackageJson from '../package.json'
import { SourcesSettings } from './components/SourcesSettings'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { GlobalTuneControl } from './components/GlobalTuneControl'
import type { PlayMode } from './components/SourcesView'
import { useAuthStatus } from './hooks/useTracks'
import { useImportProgress } from './hooks/useImportProgress'
import { useDrumRack } from './contexts/DrumRackContext'
import { useAccessibility } from './contexts/AccessibilityContext'
import { getBatchReanalyzeStatus, getImportAnalysisStatus, getSliceCount, logout } from './api/client'
import { ensureGlobalAudioTracking, panicStopAllAudio } from './services/globalAudioVolume'
import { formatReanalyzeEtaLabel } from './utils/reanalyzeEta'
import { handleTrustedTourAdvanceClick } from './utils/tourEventGuards'

type Tab = 'workspace' | 'settings'
type TourSectionKey = 'introduction' | 'importSources' | 'navbar' | 'mainPanel' | 'filters' | 'rightPanel' | 'settings'
const SETTINGS_TRANSITION_MS = 220
const LARGE_REANALYZE_SAMPLE_THRESHOLD = 50
const NAVBAR_REANALYZE_SUCCESS_MS = 30_000
const TOUR_INTRO_START_STEP_INDEX = 0
const TOUR_IMPORTS_START_STEP_INDEX = 5
const TOUR_SOURCES_START_STEP_INDEX = 22
const TOUR_NAVBAR_START_STEP_INDEX = 59
const TOUR_IMPORT_DESTINATION_START_STEP_INDEX = 10
const TOUR_FILTERS_START_STEP_INDEX = 63
const TOUR_MUSIC_START_STEP_INDEX = 93
const TOUR_SETTINGS_START_STEP_INDEX = 106
const TOUR_LOCAL_FILES_STEP_INDEX = 7
const TOUR_FOLDER_STEP_INDEX = 8
const TOUR_IMPORT_ASSIGN_HINT_STEP_INDEX = 17
const TOUR_LINK_IMPORT_STEP_INDEX = 18
const TOUR_PLAYLIST_IMPORT_STEP_INDEX = 20
const TOUR_ADVANCED_CATEGORY_MANAGEMENT_STEP_INDEX = 25
const TOUR_ADVANCED_CATEGORY_SOURCE_PANEL_STEP_INDEX = 28
const TOUR_CENTER_PANEL_START_STEP_INDEX = 30
const TOUR_VIEW_TOGGLE_STEP_INDEX = 48

interface TourSection {
  key: TourSectionKey
  label: string
  startStepIndex: number
}

const TOUR_SECTIONS: readonly TourSection[] = [
  {
    key: 'introduction',
    label: 'Introduction',
    startStepIndex: TOUR_INTRO_START_STEP_INDEX,
  },
  {
    key: 'importSources',
    label: 'Import / Sources',
    startStepIndex: TOUR_IMPORTS_START_STEP_INDEX,
  },
  {
    key: 'navbar',
    label: 'Navbar',
    startStepIndex: TOUR_NAVBAR_START_STEP_INDEX,
  },
  {
    key: 'mainPanel',
    label: 'Main Panel',
    startStepIndex: TOUR_CENTER_PANEL_START_STEP_INDEX,
  },
  {
    key: 'filters',
    label: 'Filters',
    startStepIndex: TOUR_FILTERS_START_STEP_INDEX,
  },
  {
    key: 'rightPanel',
    label: 'Right Panel',
    startStepIndex: TOUR_MUSIC_START_STEP_INDEX,
  },
  {
    key: 'settings',
    label: 'Settings',
    startStepIndex: TOUR_SETTINGS_START_STEP_INDEX,
  },
]

const DEFAULT_STRIPE_DONATION_URL = 'https://buy.stripe.com/3cIfZj63T6B72tUfiAaEE00'
const PROJECT_GITHUB_URL = 'https://github.com/iversonianGremling/SampleSolution'
const FEEDBACK_EMAIL_ADDRESS = 'iversonianGremling@protonmail.com'
const FEEDBACK_EMAIL_MAILTO = `mailto:${FEEDBACK_EMAIL_ADDRESS}`
const FEEDBACK_EMAIL_GMAIL_COMPOSE_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(FEEDBACK_EMAIL_ADDRESS)}`
const APP_VERSION = String(frontendPackageJson.version ?? 'unknown')
const APP_RELEASE_STAGE = 'alpha'
const APP_CODENAME = 'Synecdoche New Sample'

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back for browsers without clipboard permissions support.
  }

  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.setAttribute('readonly', '')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textArea)
    return copied
  } catch {
    return false
  }
}

function getStripeDonationUrl(): string | null {
  const rawUrl = (import.meta.env.VITE_STRIPE_DONATION_URL ?? DEFAULT_STRIPE_DONATION_URL).trim()
  if (!rawUrl) return null

  try {
    const parsedUrl = new URL(rawUrl)
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return null
    return parsedUrl.toString()
  } catch {
    return null
  }
}

const STRIPE_DONATION_URL = getStripeDonationUrl()

type NavbarReanalyzeIndicator =
  | {
      kind: 'progress'
      total: number
      processed: number
      progressPercent: number
      isStopping: boolean
      etaLabel: string | null
    }
  | {
      kind: 'success'
    }

type NavbarImportIndicator =
  | {
      kind: 'progress'
      title: string
      detail: string
      progressPercent: number
      isProcessing: boolean
    }
  | {
      kind: 'success'
      message: string
    }
  | {
      kind: 'error'
      message: string
    }

function formatBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (safeBytes < 1024) return `${safeBytes} B`
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`
  if (safeBytes < 1024 * 1024 * 1024) return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface SamplePlayModeControlProps {
  playMode: PlayMode
  loopEnabled: boolean
  onCyclePlayMode: () => void
  onToggleLoop: () => void
}

function SamplePlayModeControl({
  playMode,
  loopEnabled,
  onCyclePlayMode,
  onToggleLoop,
}: SamplePlayModeControlProps) {
  const isHoldMode = playMode === 'reproduce-while-clicking'

  return (
    <div className="flex items-center gap-1 pl-2.5 border-l border-surface-border">
      <button
        type="button"
        onClick={onCyclePlayMode}
        className="flex items-center gap-1 px-2 py-1 bg-surface-overlay border border-surface-border rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
        title={isHoldMode ? 'Only play while clicking' : 'Play until stop'}
      >
        {isHoldMode ? (
          <MousePointerClick size={13} />
        ) : (
          <Play size={13} />
        )}
        <span className="hidden xl:inline">
          {isHoldMode ? 'While clicking' : 'Play until stop'}
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleLoop}
        className={`flex items-center gap-1 px-2 py-1 border rounded-md text-xs transition-colors ${
          loopEnabled
            ? 'bg-accent-warm/20 border-accent-warm/50 text-accent-warm'
            : 'bg-surface-overlay border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-raised'
        }`}
        title={loopEnabled ? 'Loop enabled' : 'Loop disabled'}
      >
        <Repeat size={13} />
      </button>
    </div>
  )
}

function MasterVolumeControl() {
  const { setMasterVolume, getMasterVolume } = useDrumRack()
  const [volume, setVolume] = useState(() => {
    const initialVolume = getMasterVolume()
    return Number.isFinite(initialVolume) ? initialVolume : 0.9
  })

  const handleVolumeChange = (value: number) => {
    const safeVolume = Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0

    setVolume(safeVolume)
    setMasterVolume(safeVolume)
  }

  const volumePercent = Math.round(volume * 100)

  return (
    <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
      {volume <= 0.001 ? (
        <VolumeX size={14} className="text-text-muted shrink-0" />
      ) : (
        <Volume2 size={14} className="text-text-muted shrink-0" />
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => handleVolumeChange(Number(e.target.value))}
        className="w-16 sm:w-20 h-1 appearance-none bg-surface-border rounded-full slider-thumb"
        title={`Master volume ${volumePercent}%`}
      />
      <span className="text-[10px] text-text-muted font-mono w-7 text-right hidden md:inline">
        {volumePercent}
      </span>
    </div>
  )
}

function App() {
  const { theme } = useAccessibility()
  const queryClient = useQueryClient()
  const appTourRef = useRef<ReturnType<typeof driver> | null>(null)
  const tourMenuRef = useRef<HTMLDivElement | null>(null)
  const supportMenuRef = useRef<HTMLDivElement | null>(null)
  const feedbackCopyResetTimeoutRef = useRef<number | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('workspace')
  const [isTourMenuOpen, setIsTourMenuOpen] = useState(false)
  const [isSupportMenuOpen, setIsSupportMenuOpen] = useState(false)
  const [isFeedbackEmailModalOpen, setIsFeedbackEmailModalOpen] = useState(false)
  const [isFeedbackEmailCopied, setIsFeedbackEmailCopied] = useState(false)
  const [isSettingsRendered, setIsSettingsRendered] = useState(false)
  const [isSettingsVisible, setIsSettingsVisible] = useState(false)
  const [tuneTargetNote, setTuneTargetNote] = useState<string | null>(null)
  const [samplePlayMode, setSamplePlayMode] = useState<PlayMode>('normal')
  const [sampleLoopEnabled, setSampleLoopEnabled] = useState(false)
  const [etaNowMs, setEtaNowMs] = useState(() => Date.now())
  const wasImportAnalysisActiveRef = useRef(false)
  const importProgress = useImportProgress()
  const { data: authStatus } = useAuthStatus()
  const { data: reanalyzeStatus } = useQuery({
    queryKey: ['batch-reanalyze-status'],
    queryFn: getBatchReanalyzeStatus,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.isActive ? 1000 : 5000),
    refetchIntervalInBackground: true,
  })
  const { data: librarySampleCount } = useQuery({
    queryKey: ['slice-count'],
    queryFn: getSliceCount,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const { data: importAnalysisStatus } = useQuery({
    queryKey: ['import-analysis-status'],
    queryFn: getImportAnalysisStatus,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.isActive ? 1000 : 4000),
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    if (activeTab === 'settings') {
      setIsSettingsRendered(true)
      return
    }

    setIsSettingsVisible(false)
  }, [activeTab])

  useEffect(() => {
    ensureGlobalAudioTracking()
  }, [])

  useEffect(() => {
    if (activeTab !== 'settings' || !isSettingsRendered) return

    // Use two animation frames so the hidden state is committed and painted
    // before switching to visible; this guarantees the enter transition runs.
    let nextFrameId = 0
    const frameId = window.requestAnimationFrame(() => {
      nextFrameId = window.requestAnimationFrame(() => setIsSettingsVisible(true))
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (nextFrameId) window.cancelAnimationFrame(nextFrameId)
    }
  }, [activeTab, isSettingsRendered])

  useEffect(() => {
    if (activeTab === 'settings' || !isSettingsRendered) return

    const timeoutId = window.setTimeout(() => {
      setIsSettingsRendered(false)
    }, SETTINGS_TRANSITION_MS)

    return () => window.clearTimeout(timeoutId)
  }, [activeTab, isSettingsRendered])

  useEffect(() => {
    if (!isTourMenuOpen && !isSupportMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!tourMenuRef.current?.contains(target)) {
        setIsTourMenuOpen(false)
      }
      if (!supportMenuRef.current?.contains(target)) {
        setIsSupportMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTourMenuOpen(false)
        setIsSupportMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isTourMenuOpen, isSupportMenuOpen])

  useEffect(() => {
    if (!isFeedbackEmailModalOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFeedbackEmailModalOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFeedbackEmailModalOpen])

  useEffect(() => {
    return () => {
      if (feedbackCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(feedbackCopyResetTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!reanalyzeStatus?.isActive) return

    const timerId = window.setInterval(() => {
      setEtaNowMs(Date.now())
    }, 500)

    return () => window.clearInterval(timerId)
  }, [reanalyzeStatus?.isActive])

  useEffect(() => {
    if (!importAnalysisStatus?.isActive) return

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      void queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      void queryClient.invalidateQueries({ queryKey: ['tracks'] })
    }

    refresh()
    const timerId = window.setInterval(refresh, 1500)
    return () => window.clearInterval(timerId)
  }, [importAnalysisStatus?.isActive, queryClient])

  useEffect(() => {
    const isActive = Boolean(importAnalysisStatus?.isActive)
    if (wasImportAnalysisActiveRef.current && !isActive) {
      void queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      void queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      void queryClient.invalidateQueries({ queryKey: ['tracks'] })
      void queryClient.invalidateQueries({ queryKey: ['sourceTree'] })
    }
    wasImportAnalysisActiveRef.current = isActive
  }, [importAnalysisStatus?.isActive, queryClient])

  const handleLogout = async () => {
    await logout()
    window.location.reload()
  }

  const handleOpenStripeDonation = () => {
    if (!STRIPE_DONATION_URL) return
    setIsSupportMenuOpen(false)
    window.open(STRIPE_DONATION_URL, '_blank', 'noopener,noreferrer')
  }

  const handleOpenGithubRepository = () => {
    setIsSupportMenuOpen(false)
    window.open(PROJECT_GITHUB_URL, '_blank', 'noopener,noreferrer')
  }

  const handleOpenFeedbackEmailModal = () => {
    setIsSupportMenuOpen(false)
    setIsFeedbackEmailModalOpen(true)
  }

  const handleCloseFeedbackEmailModal = () => {
    setIsFeedbackEmailModalOpen(false)
    setIsFeedbackEmailCopied(false)
    if (feedbackCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(feedbackCopyResetTimeoutRef.current)
      feedbackCopyResetTimeoutRef.current = null
    }
  }

  const handleCopyFeedbackEmail = async () => {
    const copied = await copyTextToClipboard(FEEDBACK_EMAIL_ADDRESS)
    if (!copied) return

    setIsFeedbackEmailCopied(true)
    if (feedbackCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(feedbackCopyResetTimeoutRef.current)
    }
    feedbackCopyResetTimeoutRef.current = window.setTimeout(() => {
      setIsFeedbackEmailCopied(false)
      feedbackCopyResetTimeoutRef.current = null
    }, 2000)
  }

  const handleSendFeedbackEmail = () => {
    handleCloseFeedbackEmailModal()
    window.location.href = FEEDBACK_EMAIL_MAILTO
  }

  const handleOpenFeedbackGmail = () => {
    handleCloseFeedbackEmailModal()
    window.open(FEEDBACK_EMAIL_GMAIL_COMPOSE_URL, '_blank', 'noopener,noreferrer')
  }

  const handleCycleSamplePlayMode = () => {
    setSamplePlayMode((prev) => {
      if (prev === 'normal') return 'reproduce-while-clicking'
      return 'normal'
    })
  }

  const handleStartTour = (sectionKey: TourSectionKey) => {
    setIsTourMenuOpen(false)
    setIsSupportMenuOpen(false)
    const selectedSectionIndex = TOUR_SECTIONS.findIndex((section) => section.key === sectionKey)
    if (selectedSectionIndex < 0) return
    const selectedSection = TOUR_SECTIONS[selectedSectionIndex]
    const nextSection = TOUR_SECTIONS[selectedSectionIndex + 1] ?? null
    if (!selectedSection) return
    const sectionStartStepIndex = selectedSection.startStepIndex
    if (selectedSection.key !== 'settings') {
      setActiveTab('workspace')
    }

    appTourRef.current?.destroy()
    const sourcesSidebarToggle = document.querySelector<HTMLButtonElement>('[data-tour="sources-sidebar-toggle"]')
    const sidebarToggleLabel = sourcesSidebarToggle?.getAttribute('aria-label')?.toLowerCase() ?? ''
    if (sourcesSidebarToggle && (sidebarToggleLabel.includes('expand') || sidebarToggleLabel.includes('show'))) {
      sourcesSidebarToggle.click()
    }
    const openAddSourceMenu = () => {
      const menu = document.querySelector('[data-tour="add-source-menu"]')
      if (menu) return
      const trigger = document.querySelector<HTMLButtonElement>('[data-tour="add-source-button"]')
      trigger?.click()
    }
    const closeAddSourceMenu = () => {
      const menu = document.querySelector('[data-tour="add-source-menu"]')
      if (!menu) return
      const trigger = document.querySelector<HTMLButtonElement>('[data-tour="add-source-button"]')
      trigger?.click()
    }
    const closeImportDestinationPrompt = () => {
      const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="Close import destination prompt"]')
      closeButton?.click()
    }
    const closeImportModal = () => {
      const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="Close import modal"]')
      closeButton?.click()
    }
    const moveNextWhenMenuIsVisible = (opts: { driver: ReturnType<typeof driver> }) => {
      openAddSourceMenu()
      let attempts = 0
      const waitForMenu = () => {
        if (document.querySelector('[data-tour="add-source-menu"]')) {
          moveNextWithinSection(opts)
          return
        }
        attempts += 1
        if (attempts >= 20) {
          moveNextWithinSection(opts)
          return
        }
        window.setTimeout(waitForMenu, 50)
      }
      waitForMenu()
    }
    const moveToStepWhenMenuIsVisible = (
      opts: { driver: ReturnType<typeof driver> },
      stepIndex: number,
      fallbackStepIndex?: number,
    ) => {
      const moveToStep = (targetStepIndex: number) => {
        moveToWithinSection(opts, targetStepIndex)
      }

      const moveToStepWithFallback = () => {
        moveToStep(stepIndex)
        if (typeof fallbackStepIndex !== 'number') return

        window.setTimeout(() => {
          const targetLocalStepIndex = stepIndex - sectionStartStepIndex
          const activeIndex = opts.driver.getActiveIndex()
          if (activeIndex === targetLocalStepIndex) return
          moveToStep(fallbackStepIndex)
        }, 120)
      }

      openAddSourceMenu()
      let attempts = 0
      const waitForMenu = () => {
        if (document.querySelector('[data-tour="add-source-menu"]')) {
          moveToStepWithFallback()
          return
        }
        attempts += 1
        if (attempts >= 20) {
          moveToStepWithFallback()
          return
        }
        window.setTimeout(waitForMenu, 50)
      }
      waitForMenu()
    }
    const isImportDestinationPromptOpen = () =>
      Boolean(document.querySelector('[data-tour="import-destination-prompt"]'))
    const runPickerAwareImportStep = (
      opts: { driver: ReturnType<typeof driver> },
      buttonSelector: string,
      inputSelector: string,
      destinationPromptStepIndex: number,
      onNoPrompt: () => void,
      options?: {
        triggerPickerClick?: boolean
      },
    ) => {
      const shouldTriggerPickerClick = options?.triggerPickerClick ?? true
      const pickerButton = document.querySelector<HTMLButtonElement>(buttonSelector)
      const pickerInput = document.querySelector<HTMLInputElement>(inputSelector)
      let settled = false

      const cleanup = () => {
        if (pickerInput) pickerInput.removeEventListener('change', handleInputChange)
        window.removeEventListener('focus', handleWindowFocus)
      }

      const settleAfterPicker = () => {
        if (settled) return
        settled = true
        cleanup()

        let promptChecks = 0
        const resolveDestination = () => {
          if (isImportDestinationPromptOpen()) {
            moveToWithinSection(opts, destinationPromptStepIndex)
            return
          }
          promptChecks += 1
          if (promptChecks >= 16) {
            onNoPrompt()
            return
          }
          window.setTimeout(resolveDestination, 60)
        }

        resolveDestination()
      }

      const handleInputChange = () => {
        window.setTimeout(settleAfterPicker, 80)
      }

      const handleWindowFocus = () => {
        window.setTimeout(settleAfterPicker, 140)
      }

      if (pickerInput) pickerInput.addEventListener('change', handleInputChange)
      window.addEventListener('focus', handleWindowFocus)

      if (shouldTriggerPickerClick) pickerButton?.click()
      if (!pickerButton && shouldTriggerPickerClick) {
        settleAfterPicker()
        return
      }

      window.setTimeout(settleAfterPicker, shouldTriggerPickerClick ? 7000 : 9000)
    }
    const closeAdvancedCategoryManagement = () => {
      const closeButton = document.querySelector<HTMLButtonElement>('[data-tour="advanced-category-close"]')
      closeButton?.click()
    }
    const openFilterDock = () => {
      const filterDockToggle = document.querySelector<HTMLButtonElement>('[data-tour="filters-dock-toggle"]')
      const filterDockLabel = filterDockToggle?.getAttribute('aria-label')?.toLowerCase() ?? ''
      if (filterDockToggle && filterDockLabel.includes('show')) {
        filterDockToggle.click()
      }
    }
    const openWorkspaceRightPanel = () => {
      if (document.querySelector('[data-tour="workspace-right-panel"]')) return
      const panelToggle = document.querySelector<HTMLButtonElement>('[data-tour="workspace-right-panel-toggle"]')
      const panelToggleLabel = panelToggle?.getAttribute('aria-label')?.toLowerCase() ?? ''
      if (panelToggle && (panelToggleLabel.includes('show') || panelToggleLabel.includes('open'))) {
        panelToggle.click()
      }
    }
    const openSettingsPanel = () => {
      setActiveTab('settings')
    }
    const openSupportMenu = () => {
      setIsTourMenuOpen(false)
      setIsSupportMenuOpen(true)
    }
    const closeSupportMenu = () => {
      setIsSupportMenuOpen(false)
    }
    const closeWorkspaceRightPanel = () => {
      const panelToggle = document.querySelector<HTMLButtonElement>('[data-tour="workspace-right-panel-toggle"]')
      const panelToggleLabel = panelToggle?.getAttribute('aria-label')?.toLowerCase() ?? ''
      if (panelToggle && (panelToggleLabel.includes('close') || panelToggleLabel.includes('hide'))) {
        panelToggle.click()
      }
    }
    const closeSampleSpaceControlsPanel = () => {
      const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="Close controls panel"]')
      closeButton?.click()
    }
    const scrollTourElementIntoView = (
      selector: string,
      block: ScrollLogicalPosition = 'center',
    ) => {
      const target = document.querySelector<HTMLElement>(selector)
      if (!target) return false
      target.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' })
      return true
    }
    const openFilterTab = (selector: string) => {
      openFilterDock()
      clickTourElement(selector)
    }
    const clickTourElement = (selector: string) => {
      const target = document.querySelector<HTMLElement>(selector)
      if (!target) return false
      target.click()
      return true
    }
    const moveToWithinSection = (
      opts: { driver: ReturnType<typeof driver> },
      targetStepIndex: number,
    ) => {
      const localStepIndex = targetStepIndex - sectionStartStepIndex
      const stepCount = opts.driver.getConfig().steps?.length ?? 0
      if (localStepIndex < 0 || localStepIndex >= stepCount) {
        opts.driver.destroy()
        return
      }
      opts.driver.moveTo(localStepIndex)
    }
    const moveNextWithinSection = (opts: { driver: ReturnType<typeof driver> }) => {
      opts.driver.moveNext()
    }
    const moveNextAfterDelay = (opts: { driver: ReturnType<typeof driver> }, delayMs = 220) => {
      window.setTimeout(() => moveNextWithinSection(opts), delayMs)
    }
    const moveNextWhenElementIsVisible = (
      opts: { driver: ReturnType<typeof driver> },
      selector: string,
      fallback?: () => void,
    ) => {
      let attempts = 0
      const waitForElement = () => {
        if (document.querySelector(selector)) {
          moveNextWithinSection(opts)
          return
        }
        attempts += 1
        if (attempts >= 22) {
          fallback?.()
          return
        }
        window.setTimeout(waitForElement, 80)
      }
      waitForElement()
    }
    const moveToStepWhenElementIsVisible = (
      opts: { driver: ReturnType<typeof driver> },
      selector: string,
      targetStepIndex: number,
      fallback?: () => void,
    ) => {
      let attempts = 0
      const waitForElement = () => {
        if (document.querySelector(selector)) {
          moveToWithinSection(opts, targetStepIndex)
          return
        }
        attempts += 1
        if (attempts >= 22) {
          fallback?.()
          return
        }
        window.setTimeout(waitForElement, 80)
      }
      waitForElement()
    }
    const bindClickToAdvanceStep = (
      selector: string,
      onClickAdvance: (opts: { driver: ReturnType<typeof driver> }) => void,
    ) => {
      let cleanup: (() => void) | null = null

      return {
        onHighlighted: (_element: Element | undefined, _step: DriveStep, opts: { driver: ReturnType<typeof driver> }) => {
          cleanup?.()

          const target = document.querySelector<HTMLElement>(selector)
          if (!target) return

          const handleClick = (event: MouseEvent) => {
            handleTrustedTourAdvanceClick(
              event,
              () => onClickAdvance(opts),
              () => {
                cleanup?.()
                cleanup = null
              },
            )
          }

          target.addEventListener('click', handleClick)
          cleanup = () => {
            target.removeEventListener('click', handleClick)
          }
        },
        onDeselected: () => {
          cleanup?.()
          cleanup = null
        },
      } satisfies Pick<DriveStep, 'onHighlighted' | 'onDeselected'>
    }
    const advanceFromLinkImportStep = (
      opts: { driver: ReturnType<typeof driver> },
      triggerButtonClick = true,
    ) => {
      if (triggerButtonClick) clickTourElement('[data-tour="add-source-link"]')
      moveNextWhenElementIsVisible(
        opts,
        '[data-tour="link-import-textarea"]',
        () => moveNextWithinSection(opts),
      )
    }
    const advanceFromPlaylistImportStep = (
      opts: { driver: ReturnType<typeof driver> },
      triggerButtonClick = true,
    ) => {
      if (triggerButtonClick) clickTourElement('[data-tour="add-source-playlist"]')
      moveNextWhenElementIsVisible(
        opts,
        '[data-tour="playlist-import-modal"]',
        () => moveNextWithinSection(opts),
      )
    }
    const advanceFromImportAssignStep = (
      opts: { driver: ReturnType<typeof driver> },
      triggerButtonClick = true,
    ) => {
      if (triggerButtonClick) clickTourElement('[data-tour="import-assign-button"]')
      window.setTimeout(() => {
        closeImportDestinationPrompt()
        moveToStepWhenMenuIsVisible(opts, TOUR_LINK_IMPORT_STEP_INDEX)
      }, 120)
    }
    const advanceFromAdvancedCategoryManagementStep = (
      opts: { driver: ReturnType<typeof driver> },
      triggerButtonClick = true,
    ) => {
      if (triggerButtonClick) clickTourElement('[data-tour="advanced-category-management"]')
      moveNextWhenElementIsVisible(
        opts,
        '[data-tour="advanced-category-modal"]',
        () => moveNextWithinSection(opts),
      )
    }
    const allTourSteps: DriveStep[] = [
        {
          popover: {
            title: 'Sample Solution',
            description: 'Welcome to Sample Solution, a FOSS sample manager filled with advanced features.',
            onNextClick: (_element, _step, opts) => {
              openSupportMenu()
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="support-menu-donate-link"]',
                () => moveNextAfterDelay(opts, 220),
              )
            },
          },
        },
        {
          element: '[data-tour="support-menu-donate-link"]',
          popover: {
            title: 'Donate button',
            description: 'If you enjoy the project you can always donate (0.50 is the minimum limit).',
            onNextClick: (_element, _step, opts) => {
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="support-menu-github-link"]',
                () => moveNextAfterDelay(opts, 220),
              )
            },
          },
        },
        {
          element: '[data-tour="support-menu-github-link"]',
          popover: {
            title: 'Github button',
            description: 'If you want to take a look at the source code here\'s the Github link.',
            onNextClick: (_element, _step, opts) => {
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="support-menu-feedback-email-link"]',
                () => moveNextAfterDelay(opts, 220),
              )
            },
          },
        },
        {
          element: '[data-tour="support-menu-feedback-email-link"]',
          popover: {
            title: 'Email button',
            description: 'If you find any errors or want to report anything here\'s a link to the mail.',
            onNextClick: (_element, _step, opts) => {
              closeSupportMenu()
              window.setTimeout(() => {
                moveNextWhenElementIsVisible(
                  opts,
                  '[data-tour="tour-launch"]',
                  () => moveNextAfterDelay(opts, 220),
                )
              }, 80)
            },
          },
        },
        {
          element: '[data-tour="tour-launch"]',
          popover: {
            title: 'Help button',
            description: 'For moving around this tour click on the next/previous button or use your left/right arrow keys. Let\'s begin!',
            onNextClick: (_element, _step, opts) => {
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="sources-sidebar-toggle"]',
                () => moveNextAfterDelay(opts, 220),
              )
            },
          },
        },
        {
          element: '[data-tour="sources-sidebar-toggle"]',
          popover: {
            title: 'Add some samples first',
            description: 'Open the left side panel from here if it is hidden.',
          },
        },
        {
          element: '[data-tour="add-source-button"]',
          ...bindClickToAdvanceStep('[data-tour="add-source-button"]', (opts) => {
            moveNextWhenMenuIsVisible(opts)
          }),
          popover: {
            title: 'Import samples',
            description: 'Click here to open import options.',
            onNextClick: (_element, _step, opts) => {
              moveNextWhenMenuIsVisible(opts)
            },
          },
        },
        {
          element: '[data-tour="add-source-local-files"]',
          ...bindClickToAdvanceStep('[data-tour="add-source-local-files"]', (opts) => {
            runPickerAwareImportStep(
              opts,
              '[data-tour="add-source-local-files"]',
              '[data-tour="add-source-local-files-input"]',
              TOUR_IMPORT_DESTINATION_START_STEP_INDEX,
              () => moveNextWhenMenuIsVisible(opts),
              { triggerPickerClick: false },
            )
          }),
          popover: {
            title: 'Import a few local files',
            description: 'Choose "Local files" and import a small batch first. The app can analyze imports automatically, and analysis can take a while, so start low.',
            onNextClick: (_element, _step, opts) => {
              runPickerAwareImportStep(
                opts,
                '[data-tour="add-source-local-files"]',
                '[data-tour="add-source-local-files-input"]',
                TOUR_IMPORT_DESTINATION_START_STEP_INDEX,
                () => moveNextWhenMenuIsVisible(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="add-source-folder"]',
          ...bindClickToAdvanceStep('[data-tour="add-source-folder"]', (opts) => {
            runPickerAwareImportStep(
              opts,
              '[data-tour="add-source-folder"]',
              '[data-tour="add-source-folder-input"]',
              TOUR_IMPORT_DESTINATION_START_STEP_INDEX,
              () => moveNextWhenMenuIsVisible(opts),
              { triggerPickerClick: false },
            )
          }),
          popover: {
            title: 'Import a folder',
            description: 'Choose "Folder" to import a full folder when you want to bring entire packs at once.',
            onNextClick: (_element, _step, opts) => {
              runPickerAwareImportStep(
                opts,
                '[data-tour="add-source-folder"]',
                '[data-tour="add-source-folder-input"]',
                TOUR_IMPORT_DESTINATION_START_STEP_INDEX,
                () => moveNextWhenMenuIsVisible(opts),
              )
            },
          },
        },
        {
          popover: {
            title: 'Folder import flow',
            description: 'If your folder import opened "Choose Where and How to Import", click Next and we will guide those options. If not, click Next to skip.',
            onNextClick: (_element, _step, opts) => {
              closeAddSourceMenu()
              if (isImportDestinationPromptOpen()) {
                moveToWithinSection(opts, TOUR_IMPORT_DESTINATION_START_STEP_INDEX)
                return
              }
              moveToStepWhenMenuIsVisible(opts, TOUR_LINK_IMPORT_STEP_INDEX)
            },
          },
        },
        {
          element: '[data-tour="import-destination-prompt"]',
          popover: {
            title: 'Choose Where and How to Import',
            description: 'This window controls where imports go and how folder structure is handled.',
          },
        },
        {
          element: '[data-tour="import-method-analysis"]',
          popover: {
            title: 'Analysis mode (recommended)',
            description: 'Use Sample (auto-analyze) as the default. It analyzes your files after import, which is recommended, but can take extra time.',
          },
        },
        {
          element: '[data-tour="import-collection-strategy"]',
          popover: {
            title: 'Collection strategy',
            description: 'Collections are like superfolders, and folders live inside them. Choose whether to import into existing destinations, one new collection, or split by first subfolder.',
          },
        },
        {
          element: '[data-tour="import-destination-tree"]',
          popover: {
            title: 'Destination tree',
            description: 'Pick where imports should land. You can create collections or folders here to keep everything organized the way you want.',
          },
        },
        {
          element: '[data-tour="import-collection-mode-new"]',
          popover: {
            title: 'Create one new collection',
            description: 'Select "Create one new collection for this import". This makes one collection with a name you choose and keeps folder organization clean.',
          },
        },
        {
          element: '[data-tour="import-collection-mode-split"]',
          popover: {
            title: 'Create per first subfolder',
            description: 'This creates one collection per first source subfolder. Example: "Serum samples", "Vengeance samples", "Hardstyle samples", and "Hip hop samples" become separate categories.',
          },
        },
        {
          element: '[data-tour="import-folder-structure-handling"]',
          popover: {
            title: 'Folder structure handling',
            description: 'Preserve keeps subfolders, Flatten puts files directly in destination, and Bypass first folder level skips the selected parent folder layer.',
            onNextClick: (_element, _step, opts) => {
              moveToWithinSection(opts, TOUR_IMPORT_ASSIGN_HINT_STEP_INDEX)
            },
          },
        },
        {
          element: '[data-tour="import-assign-button"]',
          ...bindClickToAdvanceStep('[data-tour="import-assign-button"]', (opts) => {
            advanceFromImportAssignStep(opts, false)
          }),
          popover: {
            title: 'Import + Assign',
            description: 'Click "Import + Assign" to start the import using the destination and folder options you selected.',
            onNextClick: (_element, _step, opts) => {
              advanceFromImportAssignStep(opts, true)
            },
          },
        },
        {
          element: '[data-tour="add-source-link"]',
          ...bindClickToAdvanceStep('[data-tour="add-source-link"]', (opts) => {
            advanceFromLinkImportStep(opts, false)
          }),
          popover: {
            title: 'Import with links',
            description: 'Use this for links from sites you are authorized to use. Right now this flow supports only some services. Import only royalty-free music, or music you have permission to use.',
            onNextClick: (_element, _step, opts) => {
              advanceFromLinkImportStep(opts, true)
            },
          },
        },
        {
          element: '[data-tour="link-import-textarea"]',
          popover: {
            title: 'Paste links here',
            description: 'This is where you paste links, one per line. You can leave this empty and continue the tour.',
            onPrevClick: (_element, _step, opts) => {
              closeImportModal()
              moveToStepWhenMenuIsVisible(opts, TOUR_LINK_IMPORT_STEP_INDEX)
            },
            onNextClick: (_element, _step, opts) => {
              closeImportModal()
              moveToStepWhenMenuIsVisible(
                opts,
                TOUR_PLAYLIST_IMPORT_STEP_INDEX,
                TOUR_SOURCES_START_STEP_INDEX,
              )
            },
          },
        },
        {
          element: '[data-tour="add-source-playlist"]',
          ...bindClickToAdvanceStep('[data-tour="add-source-playlist"]', (opts) => {
            advanceFromPlaylistImportStep(opts, false)
          }),
          popover: {
            title: 'Import playlists',
            description: 'Same rule here: import only royalty-free music or music you have permission to use. For now, this tutorial only covers playlist links. Playlist import works, but it needs extra technical configuration that we are not covering in this tutorial.',
            onNextClick: (_element, _step, opts) => {
              advanceFromPlaylistImportStep(opts, true)
            },
          },
        },
        {
          element: '[data-tour="playlist-import-modal"]',
          popover: {
            title: 'Playlist import modal',
            description: 'This is where playlist import is configured and started.',
            onPrevClick: (_element, _step, opts) => {
              closeImportModal()
              moveToStepWhenMenuIsVisible(opts, TOUR_PLAYLIST_IMPORT_STEP_INDEX)
            },
            onNextClick: (_element, _step, opts) => {
              closeImportModal()
              closeAddSourceMenu()
              moveNextWithinSection(opts)
            },
          },
        },
        {
          element: '[data-tour="sources-tree-topbar"]',
          popover: {
            title: 'Sources top bar',
            description: 'At the top you can search sources by name. The heart button toggles favorites-only so you only see places where you already have favorite samples.',
          },
        },
        {
          element: '[data-tour="sources-show-all"]',
          ...bindClickToAdvanceStep('[data-tour="sources-show-all"]', (opts) => {
            moveNextAfterDelay(opts, 180)
          }),
          popover: {
            title: 'Show all samples',
            description: 'Click "Show all" any time to see everything. If you click any other source, folder, or section, that selection appears in the main panel.',
          },
        },
        {
          element: '[data-tour="collections-new-button"]',
          ...bindClickToAdvanceStep('[data-tour="collections-new-button"]', (opts) => {
            moveNextWithinSection(opts)
          }),
          popover: {
            title: 'Collections',
            description: 'Here you can see your collections and folders. Click the + button to create a new collection.',
          },
        },
        {
          element: '[data-tour="advanced-category-management"]',
          ...bindClickToAdvanceStep('[data-tour="advanced-category-management"]', (opts) => {
            advanceFromAdvancedCategoryManagementStep(opts, false)
          }),
          popover: {
            title: 'Advanced category management',
            description: 'This is the advanced category management button. Click on it.',
            onNextClick: (_element, _step, opts) => {
              advanceFromAdvancedCategoryManagementStep(opts, true)
            },
          },
        },
        {
          element: '[data-tour="advanced-category-modal"]',
          popover: {
            title: 'Advanced organizer',
            description: 'This view might seem intimidating, but it is a lot simpler than it seems. If your library gets messy, this is useful. Its purpose is to create new folders, collections, and instruments from others. For example, if you want all samples from your "Vengeance" collection but you do not want kicks, this is where you should go.',
            onPrevClick: (_element, _step, opts) => {
              closeAdvancedCategoryManagement()
              window.setTimeout(() => {
                moveToWithinSection(opts, TOUR_ADVANCED_CATEGORY_MANAGEMENT_STEP_INDEX)
              }, 140)
            },
            onNextClick: (_element, _step, opts) => {
              moveNextWithinSection(opts)
            },
          },
        },
        {
          element: '[data-tour="custom-order-source-pane"]',
          popover: {
            title: 'Source selection',
            description: 'For including a folder, use the left checkbox in this Sources panel. For excluding it, use the right checkbox. The "Browse samples" button is the small list icon that appears when you hover a folder, collection, or instrument row.',
          },
        },
        {
          element: '[data-tour="custom-order-show-all-samples"]',
          popover: {
            title: 'Source selection',
            description: 'Use "Show All Samples" at the top if you want broader selection and extra filtering options. Then choose a destination folder or instrument, click "Copy to (name)", and repeat as needed. When everything looks correct, use Review & Confirm.',
            onNextClick: (_element, _step, opts) => {
              closeAdvancedCategoryManagement()
              moveNextAfterDelay(opts, 320)
            },
          },
        },
        {
          element: '[data-tour="sources-collections-section"]',
          onHighlighted: () => {
            closeAdvancedCategoryManagement()
          },
          popover: {
            title: 'Collections tools',
            description: 'Back in Collections, you can drag and drop folders to reorganize them. You also have extra functions in the three-dots button, and they should be relatively intuitive.',
            onPrevClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="advanced-category-management"]')
              moveToStepWhenElementIsVisible(
                opts,
                '[data-tour="advanced-category-modal"]',
                TOUR_ADVANCED_CATEGORY_SOURCE_PANEL_STEP_INDEX,
                () => moveToWithinSection(opts, TOUR_ADVANCED_CATEGORY_SOURCE_PANEL_STEP_INDEX),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-main-controls"]',
          popover: {
            title: 'Center panel',
            description: 'This center panel is where you browse and organize samples. We will go through the key controls from left to right.',
          },
        },
        {
          element: '[data-tour="samples-select-all"]',
          popover: {
            title: 'Select all',
            description: 'Use this button when you want to select all visible samples at once.',
          },
        },
        {
          element: '[data-tour="samples-sort-button"]',
          popover: {
            title: 'Sort order',
            description: 'Use the order dropdown to change ordering. You can switch fields and direction from this menu.',
          },
        },
        {
          element: '[data-tour="samples-search-input"]',
          popover: {
            title: 'Search by name',
            description: 'Use this search box to find samples quickly by name or other metadata fields.',
          },
        },
        {
          element: '[data-tour="samples-search-fields-menu"]',
          popover: {
            title: 'Search fields',
            description: 'Open this menu to choose which fields are searched. You can keep all fields or customize the scope.',
          },
        },
        {
          element: '[data-tour="samples-view-card"]',
          popover: {
            title: 'Card view',
            description: 'Click Card view to use the simplest browsing mode.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-view-card"]')
              moveNextAfterDelay(opts)
            },
          },
        },
        {
          element: '[data-tour="samples-main-pane"]',
          popover: {
            title: 'Main pane',
            description: 'This is the card grid. Click sample cards to preview/select them and load their details.',
          },
        },
        {
          element: '[data-tour="sample-card"], [data-tour="samples-main-pane"]',
          popover: {
            title: 'Select a sample',
            description: 'Click a sample card now. Selecting a sample is important because it enables the details workflow on the right.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="sample-card"]')
              moveNextAfterDelay(opts, 260)
            },
          },
        },
        {
          element: '[data-tour="sample-card"], [data-tour="samples-main-pane"]',
          popover: {
            title: 'Card actions on hover',
            description: 'Hover a card to reveal quick actions: favorite, send to drum rack, and show extra card info. These quick actions do not work while the tutorial is running.',
          },
        },
        {
          element: '[data-tour="workspace-right-panel-toggle"], [data-tour="samples-main-pane"]',
          popover: {
            title: 'Right sidebar notification',
            description: 'After selecting a sample, this arrow should flash and you should also see a top-right message. Click either to open details.',
            onNextClick: (_element, _step, opts) => {
              const panelToggle = document.querySelector<HTMLButtonElement>('[data-tour="workspace-right-panel-toggle"]')
              const panelToggleLabel = panelToggle?.getAttribute('aria-label')?.toLowerCase() ?? ''
              if (panelToggle && (panelToggleLabel.includes('show') || panelToggleLabel.includes('open'))) {
                panelToggle.click()
              }
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="sample-details-panel"], [data-tour="workspace-right-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="workspace-right-panel"], [data-tour="sample-details-panel"]',
          popover: {
            title: 'Sample details',
            description: 'This right panel opens to Sample Details. You can expand or collapse it with the side toggle button, and like other components it can be resized.',
          },
        },
        {
          element: '[data-tour="sample-details-edit-fields"], [data-tour="sample-details-panel"]',
          popover: {
            title: 'Editable fields',
            description: 'Many fields here are editable, including note, sample type, envelope, and instrument tags.',
          },
        },
        {
          element: '[data-tour="sample-details-download"], [data-tour="sample-details-reanalyze"], [data-tour="sample-details-top-actions"]',
          popover: {
            title: 'Top actions',
            description: 'At the top you have familiar quick actions including download and re-analyze.',
          },
        },
        {
          element: '[data-tour="sample-details-tune-all"], [data-tour="sample-details-note-section"], [data-tour="sample-details-panel"]',
          popover: {
            title: 'Tune all to this note',
            description: 'Use the "Tune all to {note}" button to tune all previews to the detected note.',
          },
        },
        {
          element: '[data-tour="sample-details-show-all-similar-container"], [data-tour="sample-details-similar-label"], [data-tour="sample-details-similar-section"], [data-tour="sample-details-panel"]',
          popover: {
            title: 'Similar samples',
            description: 'Near the bottom of this panel, look for the part labeled "Similar samples". If it exists, hovering previews audio and clicking opens that sample.',
          },
        },
        {
          element: '[data-tour="sample-details-show-all-similar"], [data-tour="sample-details-similar-label"], [data-tour="sample-details-similar-section"], [data-tour="sample-details-panel"]',
          popover: {
            title: 'Open similarity list',
            description: 'Use "Show all similar samples" to enter similarity mode and browse related samples in list view. If that button does not exist, the app probably could not find similar samples for this item.',
            onNextClick: (_element, _step, opts) => {
              const openedSimilarityView = clickTourElement('[data-tour="sample-details-show-all-similar"]')
              if (!openedSimilarityView) {
                moveToWithinSection(opts, TOUR_VIEW_TOGGLE_STEP_INDEX)
                return
              }
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-list-similarity-sort"]',
                () => moveToWithinSection(opts, TOUR_VIEW_TOGGLE_STEP_INDEX),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-list-similarity-sort"]',
          popover: {
            title: 'Similarity sorting',
            description: 'In this view, click "Similar" to order by similarity if needed.',
          },
        },
        {
          element: '[data-tour="samples-similarity-exit"]',
          popover: {
            title: 'Exit similarity view',
            description: 'Click Exit to leave similarity mode and return to normal browsing.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-similarity-exit"]')
              moveNextAfterDelay(opts)
            },
          },
        },
        {
          element: '[data-tour="samples-view-toggle"]',
          popover: {
            title: 'View modes',
            description: 'Use these three buttons to switch between Card, List, and Space views.',
          },
        },
        {
          element: '[data-tour="samples-view-list"]',
          popover: {
            title: 'List view',
            description: 'Switch to List view for a denser and more compact browsing layout.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-view-list"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-list-name-sort"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-list-name-sort"]',
          popover: {
            title: 'Sort by name',
            description: 'Click "Name" once to sort ascending.',
          },
        },
        {
          element: '[data-tour="samples-list-name-sort"]',
          popover: {
            title: 'Reverse sort',
            description: 'Click "Name" again to reverse the order.',
          },
        },
        {
          element: '[data-tour="samples-list-name-resize"]',
          popover: {
            title: 'Resize rows/columns',
            description: 'Drag this handle to make list columns narrower or wider. Double-click resets width.',
          },
        },
        {
          element: '[data-tour="samples-list-columns-button"]',
          popover: {
            title: 'Column visibility',
            description: 'Open Columns to customize which list fields are visible.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-list-columns-button"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-list-save-current"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-list-save-current"]',
          popover: {
            title: 'Save current preset',
            description: 'If you like this column setup, click "Save current" to store it as a reusable preset.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-list-columns-button"]')
              moveNextAfterDelay(opts)
            },
          },
        },
        {
          element: '[data-tour="samples-view-space"]',
          popover: {
            title: 'Space view',
            description: 'Switch to Space view to explore samples visually by similarity.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-view-space"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-space-view"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-space-view"], [data-tour="samples-main-pane"]',
          popover: {
            title: 'Space interaction',
            description: 'In Space view, hover points to preview audio and click points to select samples.',
            onNextClick: (_element, _step, opts) => {
              closeSampleSpaceControlsPanel()
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-space-gear"]',
                () => moveNextWithinSection(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-space-gear"]',
          popover: {
            title: 'Space controls',
            description: 'Click here to open the settings',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-space-gear"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-space-controls-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-space-controls-panel"], [data-tour="samples-space-view"]',
          popover: {
            title: 'Control panel',
            description: 'These controls let you tune projection/clustering behavior. The defaults are sensible, but feel free to experiment.',
          },
        },
        {
          element: '[data-tour="navbar"]',
          popover: {
            title: 'Navbar',
            description: 'This is the navbar, some important features live here.',
          },
        },
        {
          element: '[data-tour="global-tune-control"]',
          popover: {
            title: 'Tune section',
            description: `If you want to tune all of the samples to one note by default you can do it here, if you want to deactivate it just set it to "off". It uses tape mode which is very light on resources but will accelerate/slow down your samples when you are previewing them, outside of previews we have better pitch-shifting models that don't alter the velocity.`,
          },
        },
        {
          element: '[data-tour="sample-play-mode-controls"]',
          popover: {
            title: 'Play buttons',
            description: 'These buttons alter how the samples are played, by default when you click on play they will reproduce until manually stopped, on click you can change it to "sample mode", on this mode the sample only plays while you are clicking on it.',
          },
        },
        {
          element: '[data-tour="panic-volume-controls"]',
          popover: {
            title: 'Panic and volume',
            description: 'At the left is the panic button, if audio doesn\'t stop for some reason click here. At the right you have the volume control.',
          },
        },
        {
          element: '[data-tour="filters-dock-toggle"]',
          popover: {
            title: 'Filters dock',
            description: 'At the bottom you have the filters. Click this bar if filters are hidden.',
            onNextClick: (_element, _step, opts) => {
              openFilterDock()
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-tab-strip"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-tab-instruments"]',
          popover: {
            title: 'Instruments and tags',
            description: 'On the main page you have your tags. These are auto-analyzed by Sample Solution.',
            onNextClick: (_element, _step, opts) => {
              openFilterTab('[data-tour="filters-tab-instruments"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-tag-grid"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-tag-grid"]',
          popover: {
            title: 'Rename or delete tags',
            description: 'If a tag is not accurate, you can rename it or delete it.',
          },
        },
        {
          element: '[data-tour="filters-tag-grid"]',
          popover: {
            title: 'Merge tags by drag and drop',
            description: 'If you have tags like "perc" and "percussion", drag one into the other to merge. You can then choose whether to preserve or delete the original source tag.',
          },
        },
        {
          element: '[data-tour="filters-type-one-shot"], [data-tour="filters-type-loop"], [data-tour="filters-instruments-panel"]',
          popover: {
            title: 'One-shot and loop',
            description: 'You can also filter by sample type here: one-shot or loop.',
          },
        },
        {
          element: '[data-tour="filters-tab-dimensions"]',
          popover: {
            title: 'Dimensions',
            description: 'Open Dimensions to filter samples with dedicated sliders.',
            onNextClick: (_element, _step, opts) => {
              openFilterTab('[data-tour="filters-tab-dimensions"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-dimensions-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-dimensions-category-spectral"]',
          popover: {
            title: 'Spectral',
            description: 'Brightness is how much high-frequency content a sample has. Noisiness is how noisy the sound is.',
          },
        },
        {
          element: '[data-tour="filters-dimensions-category-energy"]',
          popover: {
            title: 'Energy',
            description: 'Switch to Energy to access transient and loudness-focused controls.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="filters-dimensions-category-energy"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-dimensions-loudness"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-dimensions-loudness"], [data-tour="filters-dimensions-panel"]',
          popover: {
            title: 'Loudness and shape',
            description: 'The top-right loudness control is a common filter. You can also tune attack, dynamics, and saturation to shape how punchy or dynamic a sound feels.',
          },
        },
        {
          element: '[data-tour="filters-dimensions-category-texture"]',
          popover: {
            title: 'Texture',
            description: 'Texture is more abstract but useful for discovery.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="filters-dimensions-category-texture"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-dimension-rhythmic"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-dimension-rhythmic"], [data-tour="filters-dimensions-panel"]',
          popover: {
            title: 'Rhythmic texture',
            description: 'Rhythmic should be self-explanatory. Texture also includes surface and density controls.',
          },
        },
        {
          element: '[data-tour="filters-dimensions-category-space"]',
          popover: {
            title: 'Space',
            description: 'Switch to Space for spatial filtering.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="filters-dimensions-category-space"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-dimensions-stereo-mode"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-dimensions-stereo-mode"], [data-tour="filters-dimensions-panel"]',
          popover: {
            title: 'Stereo, ambience, depth',
            description: 'Here you can choose mono or stereo, then refine with stereo width, ambience, and depth sliders.',
          },
        },
        {
          element: '[data-tour="filters-tab-features"]',
          popover: {
            title: 'Features',
            description: 'Open Features for duration, BPM, pitch, envelope, and date filtering.',
            onNextClick: (_element, _step, opts) => {
              openFilterTab('[data-tour="filters-tab-features"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-features-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-features-panel"]',
          popover: {
            title: 'Standard feature filters',
            description: 'Use this panel for duration/BPM/envelope and other standard sample filters.',
          },
        },
        {
          element: '[data-tour="filters-features-pitch-mode"]',
          popover: {
            title: 'Note and scale mode',
            description: 'In Note mode, selecting a note shows matching samples. Related Notes adds musically related notes. Switching to Scale mode gives the same workflow for keys/scales and related scales.',
          },
        },
        {
          element: '[data-tour="filters-features-envelope"], [data-tour="filters-features-panel"]',
          popover: {
            title: 'Envelope',
            description: 'Envelope shape filters are available here as quick categorical selectors.',
          },
        },
        {
          element: '[data-tour="filters-features-date"], [data-tour="filters-features-date-field"]',
          popover: {
            title: 'Date filters',
            description: 'At the bottom you can filter by date. Switch between Date added, Date updated, and File created. In most cases, preset buttons are faster than manual date inputs.',
          },
        },
        {
          element: '[data-tour="filters-tab-advanced"]',
          popover: {
            title: 'Advanced',
            description: 'Moving to Advanced enters technical territory with SQL-like rule logic.',
            onNextClick: (_element, _step, opts) => {
              openFilterTab('[data-tour="filters-tab-advanced"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-advanced-rule-builder"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-advanced-rule-builder"]',
          popover: {
            title: 'Rule builder',
            description: 'Add conditions like: kick samples with low brightness OR high attack, and exclude unwanted artists. Combine rules with AND/OR.',
          },
        },
        {
          element: '[data-tour="filters-tab-bulk-actions"]',
          popover: {
            title: 'Bulk Actions',
            description: 'Bulk Actions includes bulk rename and format conversion tools.',
            onNextClick: (_element, _step, opts) => {
              openFilterTab('[data-tour="filters-tab-bulk-actions"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-bulk-actions-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-bulk-actions-panel"]',
          popover: {
            title: 'Bulk rename workflow',
            description: 'You can target selected samples and/or matched names, then apply rename actions in one pass.',
          },
        },
        {
          element: '[data-tour="filters-bulk-find-text"], [data-tour="filters-bulk-replace"], [data-tour="filters-bulk-prefix-suffix"]',
          popover: {
            title: 'Rename controls',
            description: 'Use text match or JS regex, replace matched text, run case conversion (including snake_case/UPPERCASE), and add optional prefix/suffix.',
          },
        },
        {
          element: '[data-tour="filters-bulk-tab-format"]',
          popover: {
            title: 'Format / quality',
            description: 'Open this tab to convert samples to a target format and quality settings.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="filters-bulk-tab-format"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-bulk-format-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-bulk-format-panel"]',
          popover: {
            title: 'Conversion options',
            description: 'Set target format, sample rate, and bit depth. Use this carefully and keep backups when needed.',
          },
        },
        {
          element: '[data-tour="filters-tab-duplicates"]',
          popover: {
            title: 'Duplicates',
            description: 'Open Duplicates to run duplicate detection.',
            onNextClick: (_element, _step, opts) => {
              openFilterTab('[data-tour="filters-tab-duplicates"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="filters-duplicates-panel"]',
                () => moveNextAfterDelay(opts),
              )
            },
          },
        },
        {
          element: '[data-tour="filters-duplicates-panel"]',
          popover: {
            title: 'Duplicate engine',
            description: 'The defaults are generally good and tend to keep the highest-quality candidate in each pair.',
          },
        },
        {
          element: '[data-tour="filters-duplicates-find-button"]',
          popover: {
            title: 'Find duplicates',
            description: 'Click "Find duplicates" to scan your library and open duplicate management UI when matches are found.',
          },
        },
        {
          element: '[data-tour="filters-duplicates-panel"]',
          popover: {
            title: 'Other duplicate controls',
            description: 'There are several controls for handling duplicates, but it is usually better to keep the default values. These controls are not covered in this tutorial.',
          },
        },
        {
          element: '[data-tour="filters-clear-all"], [data-tour="filters-enabled-list-toggle"]',
          popover: {
            title: 'Clear active filters',
            description: 'Use the Filters button to inspect active filters. When filters are enabled, "Clear all" appears here to remove them quickly.',
          },
        },
        {
          element: '[data-tour="workspace-tab-rack"], [data-tour="workspace-right-panel-toggle"], [data-tour="workspace-main"]',
          popover: {
            title: 'Make some music',
            description: 'At the top of the right panel you have Sample Details, Drum Rack, and Lab. Let\'s go to Drum Rack.',
            onNextClick: (_element, _step, opts) => {
              openWorkspaceRightPanel()
              clickTourElement('[data-tour="workspace-tab-rack"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="drum-rack-view"]',
                () => moveNextAfterDelay(opts, 280),
              )
            },
          },
        },
        {
          element: '[data-tour="drum-rack-pad-grid"], [data-tour="drum-rack-main-pane"], [data-tour="drum-rack-view"]',
          popover: {
            title: 'Drum rack pads',
            description: 'Drag and drop samples onto pads, or click an empty pad to browse available samples. Every loaded pad has its own effects chain.',
          },
        },
        {
          element: '[data-tour="drum-rack-pad-mode-one-shot"], [data-tour="drum-rack-pad-mode-hold"]',
          popover: {
            title: 'Pad behavior controls',
            description: 'These top buttons change how pads behave when reproducing a sample. Right now this section is intentionally simple.',
          },
        },
        {
          element: '[data-tour="drum-rack-tab-sequencer"], [data-tour="drum-rack-tabs"]',
          popover: {
            title: 'Open sequencer',
            description: 'Click Sequencer.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="drum-rack-tab-sequencer"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="drum-rack-sequencer-pane"]',
                () => moveNextAfterDelay(opts, 260),
              )
            },
          },
        },
        {
          element: '[data-tour="drum-rack-sequencer-pane"], [data-tour="drum-rack-view"]',
          popover: {
            title: 'Simple sequencer',
            description: 'Some patterns are already loaded. You will not hear or see much unless samples are loaded onto Durm Rack pads.',
          },
        },
        {
          element: '[data-tour="samples-main-pane"], [data-tour="samples-view-toggle"]',
          popover: {
            title: 'Send from main pane',
            description: 'From the main pane you can send samples directly to Drum Rack and choose where they land. Switch to Card view first.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-view-card"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="sample-card-hover-actions"], [data-tour="samples-main-pane"]',
                () => moveNextAfterDelay(opts, 240),
              )
            },
          },
        },
        {
          element: '[data-tour="sample-card-drumrack"], [data-tour="sample-card-hover-actions"], [data-tour="samples-main-pane"]',
          popover: {
            title: 'Send to drum rack',
            description: 'This button appears when you hover a sample card. You cannot interact with it during this tutorial.',
            onNextClick: (_element, _step, opts) => {
              clickTourElement('[data-tour="samples-view-list"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="samples-list-view"] [data-tour="samples-list-row-actions-button"]',
                () => moveNextAfterDelay(opts, 240),
              )
            },
          },
        },
        {
          element: '[data-tour="samples-list-view"] [data-tour="samples-list-row-actions-button"]',
          popover: {
            title: 'List view send action',
            description: 'In List view, use the three-dots button on a row to find "Send to Drum Rack".',
          },
        },
        {
          element: '[data-tour="drum-rack-tab-effects"], [data-tour="drum-rack-tabs"]',
          popover: {
            title: 'Open global effects',
            description: 'Now click Effects on the Drum Rack tabs.',
            onNextClick: (_element, _step, opts) => {
              openWorkspaceRightPanel()
              clickTourElement('[data-tour="workspace-tab-rack"]')
              window.setTimeout(() => {
                clickTourElement('[data-tour="drum-rack-tab-effects"]')
                moveNextWhenElementIsVisible(
                  opts,
                  '[data-tour="drum-rack-global-effects"], [data-tour="drum-rack-effects-pane"]',
                  () => moveNextAfterDelay(opts, 280),
                )
              }, 100)
            },
          },
        },
        {
          element: '[data-tour="drum-rack-global-effects"], [data-tour="drum-rack-effects-pane"]',
          popover: {
            title: 'Drum rack global FX',
            description: 'These are global effects for the Drum Rack, applied across all pads.',
          },
        },
        {
          element: '[data-tour="workspace-tab-lab"], [data-tour="workspace-right-panel"]',
          popover: {
            title: 'Open Lab',
            description: 'Now let\'s look at Lab.',
            onNextClick: (_element, _step, opts) => {
              openWorkspaceRightPanel()
              clickTourElement('[data-tour="workspace-tab-lab"]')
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="lab-view"]',
                () => moveNextAfterDelay(opts, 280),
              )
            },
          },
        },
        {
          element: '[data-tour="lab-transport"], [data-tour="lab-view"]',
          popover: {
            title: 'Lab render actions',
            description: 'In Lab you can tweak effects, then download a copy with "Copy" or replace the original with "Overwrite".',
          },
        },
        {
          element: '[data-tour="lab-fx-drag-handle"], [data-tour="lab-fx-rack"], [data-tour="lab-view"]',
          popover: {
            title: 'Reorder Lab effects',
            description: 'Drag the grip icons to reorder the effect chain.',
          },
        },
        {
          element: '[data-tour="settings-button"]',
          popover: {
            title: 'Open settings',
            description: 'Use this button to open app settings.',
            onNextClick: (_element, _step, opts) => {
              openSettingsPanel()
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="settings-panel"]',
                () => moveNextAfterDelay(opts, 320),
              )
            },
          },
        },
        {
          element: '[data-tour="settings-panel"]',
          popover: {
            title: 'Settings overview',
            description: 'Settings includes accessibility, analysis, system, backups, and roadmap info. Backup is currently being tested, so do not rely on it as your only backup.',
            onNextClick: (_element, _step, opts) => {
              scrollTourElementIntoView('[data-tour="settings-accessibility-section"]', 'start')
              moveNextAfterDelay(opts, 380)
            },
          },
        },
        {
          element: '[data-tour="settings-accessibility-section"]',
          popover: {
            title: 'Accessibility panel',
            description: 'This is the accessibility panel, here you can change the theme, the font (to openDyslexic) and the font size.',
            onNextClick: (_element, _step, opts) => {
              scrollTourElementIntoView('[data-tour="settings-audio-analysis-section"]', 'start')
              moveNextAfterDelay(opts, 380)
            },
          },
        },
        {
          element: '[data-tour="settings-audio-analysis-section"]',
          popover: {
            title: 'Audio Analysis',
            description: 'This is the Audio Analysis part, use this if you want to re-analyze your library. Choose an amount of processes that your computer can handle.',
            onNextClick: (_element, _step, opts) => {
              scrollTourElementIntoView('[data-tour="settings-backup-section"]', 'start')
              moveNextAfterDelay(opts, 380)
            },
          },
        },
        {
          element: '[data-tour="settings-backup-section"]',
          popover: {
            title: 'Backup section',
            description: 'This is the backup section, it\'s currently experimental and not guaranteed to work, improvements coming for the next version.',
            onNextClick: (_element, _step, opts) => {
              scrollTourElementIntoView('[data-tour="settings-future-features"]', 'start')
              moveNextAfterDelay(opts, 420)
            },
          },
        },
        {
          element: '[data-tour="settings-future-features"]',
          popover: {
            title: 'Future Features',
            description: 'This section tracks planned roadmap items for upcoming versions.',
            onNextClick: (_element, _step, opts) => {
              setActiveTab('workspace')
              window.setTimeout(() => {
                scrollTourElementIntoView('[data-tour="donate-button"]', 'nearest')
                openSupportMenu()
                moveNextWhenElementIsVisible(
                  opts,
                  '[data-tour="support-menu-donate-link"]',
                  () => moveNextAfterDelay(opts, 260),
                )
              }, SETTINGS_TRANSITION_MS + 40)
            },
          },
        },
        {
          element: '[data-tour="support-menu-donate-link"]',
          popover: {
            title: 'Donate button',
            description: 'If you enjoy the project you can always donate (0.50 is the minimum limit).',
            onNextClick: (_element, _step, opts) => {
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="support-menu-github-link"]',
                () => moveNextAfterDelay(opts, 220),
              )
            },
          },
        },
        {
          element: '[data-tour="support-menu-github-link"]',
          popover: {
            title: 'Github button',
            description: 'If you want to take a look at the source code here\'s the Github link.',
            onNextClick: (_element, _step, opts) => {
              moveNextWhenElementIsVisible(
                opts,
                '[data-tour="support-menu-feedback-email-link"]',
                () => moveNextAfterDelay(opts, 220),
              )
            },
          },
        },
        {
          element: '[data-tour="support-menu-feedback-email-link"]',
          onDeselected: () => {
            closeSupportMenu()
          },
          popover: {
            title: 'Email button',
            description: 'If you find any errors or want to report anything here\'s a link to the mail. And that\'s all of the tutorials! Time to make some sick tracks!!',
          },
        },
    ]

    const sectionStepsByKey: Record<TourSectionKey, typeof allTourSteps> = {
      introduction: allTourSteps.slice(TOUR_INTRO_START_STEP_INDEX, TOUR_IMPORTS_START_STEP_INDEX),
      importSources: allTourSteps.slice(TOUR_IMPORTS_START_STEP_INDEX, TOUR_CENTER_PANEL_START_STEP_INDEX),
      navbar: allTourSteps.slice(TOUR_NAVBAR_START_STEP_INDEX, TOUR_FILTERS_START_STEP_INDEX),
      mainPanel: allTourSteps.slice(TOUR_CENTER_PANEL_START_STEP_INDEX, TOUR_NAVBAR_START_STEP_INDEX),
      filters: allTourSteps.slice(TOUR_FILTERS_START_STEP_INDEX, TOUR_MUSIC_START_STEP_INDEX),
      rightPanel: allTourSteps.slice(TOUR_MUSIC_START_STEP_INDEX, TOUR_SETTINGS_START_STEP_INDEX),
      settings: allTourSteps.slice(TOUR_SETTINGS_START_STEP_INDEX),
    }
    const baseTourSteps = sectionStepsByKey[selectedSection.key]
    if (!baseTourSteps || baseTourSteps.length === 0) return

    const selectedTourSteps: DriveStep[] = nextSection
      ? [
          ...baseTourSteps,
          {
            popover: {
              title: `${selectedSection.label} complete`,
              description: `Start "${nextSection.label}" next, or close this tour here.`,
              doneBtnText: `Start ${nextSection.label}`,
              onNextClick: () => {
                appTourRef.current?.destroy()
                window.setTimeout(() => {
                  handleStartTour(nextSection.key)
                }, 0)
              },
            },
          },
        ]
      : baseTourSteps

    const startStepIndex = 0
    const startGlobalStepIndex = sectionStartStepIndex + startStepIndex

    if (startGlobalStepIndex >= TOUR_SOURCES_START_STEP_INDEX) {
      closeImportDestinationPrompt()
      closeImportModal()
      closeAddSourceMenu()
      closeAdvancedCategoryManagement()
    }

    const requiresAddSourceMenu =
      startGlobalStepIndex === TOUR_LOCAL_FILES_STEP_INDEX
      || startGlobalStepIndex === TOUR_FOLDER_STEP_INDEX
      || startGlobalStepIndex === TOUR_LINK_IMPORT_STEP_INDEX
      || startGlobalStepIndex === TOUR_PLAYLIST_IMPORT_STEP_INDEX
    if (requiresAddSourceMenu) {
      openAddSourceMenu()
    }

    if (
      startGlobalStepIndex >= TOUR_CENTER_PANEL_START_STEP_INDEX &&
      startGlobalStepIndex < TOUR_NAVBAR_START_STEP_INDEX
    ) {
      clickTourElement('[data-tour="samples-similarity-exit"]')
      clickTourElement('[data-tour="samples-view-card"]')
      closeWorkspaceRightPanel()
    }

    if (
      startGlobalStepIndex >= TOUR_FILTERS_START_STEP_INDEX &&
      startGlobalStepIndex < TOUR_MUSIC_START_STEP_INDEX
    ) {
      clickTourElement('[data-tour="samples-view-card"]')
      closeWorkspaceRightPanel()
    }

    const tour = driver({
      showProgress: true,
      overlayColor: '#0f1216',
      overlayOpacity: 0.74,
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'app-tour-popover',
      onNextClick: (_element, _step, opts) => {
        moveNextWithinSection(opts)
      },
      steps: selectedTourSteps,
    })
    appTourRef.current = tour
    tour.drive(startStepIndex)
  }

  const handleCloseSettings = () => {
    setActiveTab('workspace')
  }

  const navbarReanalyzeIndicator = useMemo<NavbarReanalyzeIndicator | null>(() => {
    if (!reanalyzeStatus) return null
    if (reanalyzeStatus.total <= 0) return null

    const isWholeLibraryBatch =
      typeof librarySampleCount === 'number' &&
      librarySampleCount > 0 &&
      reanalyzeStatus.total >= librarySampleCount
    const isLargeBatch = reanalyzeStatus.total >= LARGE_REANALYZE_SAMPLE_THRESHOLD
    if (!isWholeLibraryBatch && !isLargeBatch) return null

    const progressPercent = Math.max(0, Math.min(100, reanalyzeStatus.progressPercent))
    const finishedAtMs = reanalyzeStatus.finishedAt
      ? new Date(reanalyzeStatus.finishedAt).getTime()
      : Number.NaN
    const isCompletedRecently =
      Number.isFinite(finishedAtMs) &&
      Date.now() - finishedAtMs <= NAVBAR_REANALYZE_SUCCESS_MS
    const hasReachedCompletion =
      !reanalyzeStatus.isStopping &&
      reanalyzeStatus.status !== 'failed' &&
      reanalyzeStatus.status !== 'canceled' &&
      progressPercent >= 100 &&
      (reanalyzeStatus.isActive || isCompletedRecently)

    if (hasReachedCompletion) {
      return { kind: 'success' }
    }

    if (!reanalyzeStatus.isActive) return null

    const etaLabel = formatReanalyzeEtaLabel({
      isStopping: reanalyzeStatus.isStopping,
      startedAt: reanalyzeStatus.startedAt,
      updatedAt: reanalyzeStatus.updatedAt,
      processed: reanalyzeStatus.processed,
      total: reanalyzeStatus.total,
      nowMs: etaNowMs,
    })

    return {
      kind: 'progress',
      total: reanalyzeStatus.total,
      processed: reanalyzeStatus.processed,
      progressPercent,
      isStopping: reanalyzeStatus.isStopping,
      etaLabel,
    }
  }, [reanalyzeStatus, librarySampleCount, etaNowMs])

  const navbarImportIndicator = useMemo<NavbarImportIndicator | null>(() => {
    const activeImport = importProgress.active
    if (activeImport) {
      const sourceLabel = activeImport.sourceKind === 'folder' ? 'folder' : 'files'
      const modeLabel = activeImport.importType === 'sample' ? 'sample mode' : 'track mode'
      const fileCountLabel = typeof activeImport.totalFiles === 'number'
        ? `${activeImport.totalFiles} ${activeImport.totalFiles === 1 ? 'file' : 'files'}`
        : 'unknown file count'
      const byteProgressLabel = activeImport.totalBytes && activeImport.totalBytes > 0
        ? `${formatBytes(activeImport.uploadedBytes)} / ${formatBytes(activeImport.totalBytes)}`
        : null
      const detailParts = [fileCountLabel, modeLabel]
      if (byteProgressLabel) detailParts.push(byteProgressLabel)
      if (importProgress.activeCount > 1) {
        detailParts.push(`${importProgress.activeCount} active imports`)
      }
      return {
        kind: 'progress',
        title: activeImport.phase === 'processing'
          ? `Processing imported ${sourceLabel}`
          : `Importing ${sourceLabel}`,
        detail: detailParts.join(' • '),
        progressPercent: Math.max(0, Math.min(100, activeImport.progressPercent)),
        isProcessing: activeImport.phase === 'processing',
      }
    }

    const latestImport = importProgress.latest
    if (!latestImport) return null

    if (latestImport.phase === 'success') {
      const successful = latestImport.successful ?? 0
      const total = latestImport.totalFiles ?? successful
      const failed = latestImport.failed ?? 0
      const failedMessage = failed > 0 ? `, ${failed} failed` : ''
      return {
        kind: 'success',
        message: `Imported ${successful}/${total} files${failedMessage}.`,
      }
    }

    if (latestImport.phase === 'error') {
      return {
        kind: 'error',
        message: latestImport.message || 'Import failed.',
      }
    }

    return null
  }, [importProgress])

  const hasNavbarIndicators = Boolean(navbarImportIndicator || navbarReanalyzeIndicator)

  useEffect(() => () => {
    appTourRef.current?.destroy()
    appTourRef.current = null
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-surface-base flex flex-col">
      {/* ── Header ─────────────────────────── */}
      <header className="bg-surface-raised border-b border-surface-border shrink-0">
        <div className="px-3 py-1.5 sm:px-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-tour="navbar">
          {/* Left zone: Tune control */}
          <div
            className="flex items-center min-w-0 shrink-0"
            data-tour="global-tune-control"
          >
            <GlobalTuneControl
              tuneTargetNote={tuneTargetNote}
              onTuneTargetNoteChange={setTuneTargetNote}
            />
          </div>

          {hasNavbarIndicators && (
            <div className="order-3 basis-full min-w-0 flex flex-col gap-1 md:order-none md:flex-1 md:basis-auto md:items-center">
              {navbarImportIndicator?.kind === 'progress' ? (
                <div
                  className="w-full md:max-w-md rounded-md border border-emerald-400/30 bg-surface-overlay px-2 py-1"
                  title={`${navbarImportIndicator.title} — ${navbarImportIndicator.detail}`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide">
                    <span className={navbarImportIndicator.isProcessing ? 'text-amber-300' : 'text-emerald-300'}>
                      {navbarImportIndicator.title}
                    </span>
                    <span className="font-mono text-slate-200">{navbarImportIndicator.progressPercent}%</span>
                  </div>
                  <div className="mb-1 text-[10px] text-slate-300 truncate">
                    {navbarImportIndicator.detail}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-border">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        navbarImportIndicator.isProcessing
                          ? 'bg-gradient-to-r from-amber-400 to-orange-300 animate-pulse'
                          : 'bg-gradient-to-r from-emerald-400 to-cyan-300'
                      }`}
                      style={{ width: `${navbarImportIndicator.progressPercent}%` }}
                    />
                  </div>
                </div>
              ) : navbarImportIndicator?.kind === 'success' ? (
                <div className="w-full md:max-w-md rounded-md border border-green-400/25 bg-green-500/10 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-green-300">
                  {navbarImportIndicator.message}
                </div>
              ) : navbarImportIndicator?.kind === 'error' ? (
                <div className="w-full md:max-w-md rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-red-300 truncate">
                  {navbarImportIndicator.message}
                </div>
              ) : null}

              {navbarReanalyzeIndicator?.kind === 'progress' ? (
                <div
                  className="w-full md:max-w-md rounded-md border border-accent-primary/25 bg-surface-overlay px-2 py-1"
                  title={`Re-analyzing ${navbarReanalyzeIndicator.processed}/${navbarReanalyzeIndicator.total} samples`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide">
                    <span className={navbarReanalyzeIndicator.isStopping ? 'text-amber-300' : 'text-accent-primary'}>
                      {navbarReanalyzeIndicator.isStopping ? 'Stopping re-analysis...' : 'Re-analyzing samples'}
                    </span>
                    <span className="font-mono text-slate-200">
                      {navbarReanalyzeIndicator.progressPercent}%
                      {navbarReanalyzeIndicator.etaLabel ? ` ETA ${navbarReanalyzeIndicator.etaLabel}` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-border">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        navbarReanalyzeIndicator.isStopping
                          ? 'bg-gradient-to-r from-amber-400 to-amber-300'
                          : 'bg-gradient-to-r from-accent-primary to-cyan-400'
                      }`}
                      style={{ width: `${navbarReanalyzeIndicator.progressPercent}%` }}
                    />
                  </div>
                </div>
              ) : navbarReanalyzeIndicator?.kind === 'success' ? (
                <div className="w-full md:max-w-md rounded-md border border-green-400/25 bg-green-500/10 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-green-300">
                  Library successfully analyzed
                </div>
              ) : null}
            </div>
          )}

          {/* Right zone: Playback + Volume + Auth */}
          <div
            className="ml-auto flex items-center gap-1.5 shrink-0"
            data-tour="header-controls"
          >
            <div data-tour="sample-play-mode-controls">
              <SamplePlayModeControl
                playMode={samplePlayMode}
                loopEnabled={sampleLoopEnabled}
                onCyclePlayMode={handleCycleSamplePlayMode}
                onToggleLoop={() => setSampleLoopEnabled((prev) => !prev)}
              />
            </div>
            <div data-tour="panic-volume-controls" className="flex items-center">
              <div className="flex items-center pl-2.5 border-l border-surface-border">
                <button
                  type="button"
                  onClick={panicStopAllAudio}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 ${
                    theme === 'light'
                      ? 'border-red-500/65 bg-red-100 text-red-800 hover:bg-red-200'
                      : 'border-red-400/55 bg-red-500/22 text-red-100 hover:bg-red-500/32'
                  }`}
                  title="Panic stop all audio"
                  aria-label="Panic stop all audio"
                >
                  <Square
                    size={12}
                    className={`fill-current ${
                      theme === 'light' ? 'text-red-800' : 'text-red-100'
                    }`}
                  />
                  <span className="hidden xl:inline">Panic</span>
                </button>
              </div>
              <MasterVolumeControl />
            </div>
            <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
              <button
                type="button"
                onClick={() =>
                  setActiveTab((prev) => (prev === 'settings' ? 'workspace' : 'settings'))
                }
                data-tour="settings-button"
                className={`p-1.5 rounded-lg border transition-colors ${
                  activeTab === 'settings'
                    ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                    : 'border-surface-border bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-surface-raised'
                }`}
                title={activeTab === 'settings' ? 'Close settings' : 'Open settings'}
                aria-label={activeTab === 'settings' ? 'Close settings' : 'Open settings'}
              >
                <Settings size={14} />
              </button>
              <div ref={supportMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsTourMenuOpen(false)
                    setIsSupportMenuOpen((prev) => !prev)
                  }}
                  data-tour="donate-button"
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                    isSupportMenuOpen
                      ? 'border-accent-primary/45 bg-accent-primary/15 text-accent-primary'
                      : 'border-surface-border bg-surface-overlay text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                  }`}
                  title="Open support menu"
                  aria-label="Open support menu"
                  aria-haspopup="menu"
                  aria-expanded={isSupportMenuOpen}
                >
                  <Heart size={13} className={theme === 'light' ? 'text-emerald-700' : 'text-emerald-300/85'} />
                  <ChevronDown size={12} className={isSupportMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {isSupportMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-lg border border-surface-border bg-surface-raised shadow-lg"
                    role="menu"
                    aria-label="Support links"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-tour="support-menu-donate-link"
                      onClick={handleOpenStripeDonation}
                      disabled={!STRIPE_DONATION_URL}
                      className={`block w-full px-3 py-2 text-left text-xs transition-colors ${
                        STRIPE_DONATION_URL
                          ? 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                          : 'cursor-not-allowed text-text-muted opacity-70'
                      }`}
                    >
                      Donate
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-tour="support-menu-github-link"
                      onClick={handleOpenGithubRepository}
                      className="block w-full px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
                    >
                      Github
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-tour="support-menu-feedback-email-link"
                      onClick={handleOpenFeedbackEmailModal}
                      className="block w-full px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
                    >
                      Feedback/email
                    </button>
                    <div className="border-t border-surface-border px-3 py-2 text-[11px] text-text-muted">
                      <div>Version {APP_VERSION} ({APP_RELEASE_STAGE})</div>
                      <div>Codename: {APP_CODENAME}</div>
                    </div>
                  </div>
                )}
              </div>
              <div ref={tourMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsSupportMenuOpen(false)
                    setIsTourMenuOpen((prev) => !prev)
                  }}
                  data-tour="tour-launch"
                  className="p-1.5 rounded-lg border border-surface-border bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                  title="Open guided tours"
                  aria-label="Open guided tours"
                  aria-haspopup="menu"
                  aria-expanded={isTourMenuOpen}
                >
                  <HelpCircle size={14} />
                </button>
                {isTourMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1.5 w-48 overflow-hidden rounded-lg border border-surface-border bg-surface-raised shadow-lg"
                    role="menu"
                    aria-label="Guided tour sections"
                  >
                    {TOUR_SECTIONS.map((section) => (
                      <button
                        key={section.key}
                        type="button"
                        role="menuitem"
                        onClick={() => handleStartTour(section.key)}
                        className="block w-full px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {authStatus?.authenticated && (
              <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
                {authStatus.user?.picture && (
                  <img
                    src={authStatus.user.picture}
                    alt={authStatus.user?.name}
                    className="w-5 h-5 rounded-full ring-1 ring-surface-border"
                  />
                )}
                <span className="text-xs text-text-muted hidden lg:block truncate max-w-[120px]">
                  {authStatus.user?.name}
                </span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 px-1.5 py-1 text-xs text-text-muted hover:text-text-primary rounded-md hover:bg-surface-overlay transition-colors"
                  title="Logout"
                >
                  <LogOut size={13} />
                  <span className="hidden lg:inline">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────── */}
      <main
        className="relative flex-1 min-h-0 overflow-hidden"
        data-tour="workspace-main"
      >
        <WorkspaceLayout
          mode="workspace"
          tuneTargetNote={tuneTargetNote}
          onTuneToNote={setTuneTargetNote}
          samplePlayMode={samplePlayMode}
          sampleLoopEnabled={sampleLoopEnabled}
        />
        {isSettingsRendered && (
          <section
            className={`fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5 transition-opacity duration-[220ms] ease-in-out ${
              isSettingsVisible
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <div className="absolute inset-0 bg-surface-base/70" />
            <div className="relative z-10 flex h-[94vh] w-fit max-w-full flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-2xl sm:h-[90vh]">
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <h2 className="text-base font-semibold text-text-primary">Settings</h2>
                <button
                  type="button"
                  onClick={handleCloseSettings}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                  aria-label="Close settings"
                  title="Close settings"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-fit max-w-full px-4 py-5">
                  <SourcesSettings />
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
      {isFeedbackEmailModalOpen && (
        <section
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="Feedback email"
          onMouseDown={handleCloseFeedbackEmailModal}
        >
          <div className="absolute inset-0 bg-surface-base/70" />
          <div
            className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
              <h2 className="text-base font-semibold text-text-primary">Feedback Email</h2>
              <button
                type="button"
                onClick={handleCloseFeedbackEmailModal}
                className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                aria-label="Close feedback email modal"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-4 py-4">
              <p className="text-xs text-text-muted">Send feedback or bug reports to this address:</p>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface-overlay px-3 py-2">
                <code className="min-w-0 break-all text-sm text-text-primary">{FEEDBACK_EMAIL_ADDRESS}</code>
                <button
                  type="button"
                  onClick={handleCopyFeedbackEmail}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-surface-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                >
                  <Copy size={12} />
                  {isFeedbackEmailCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSendFeedbackEmail}
                  className="inline-flex items-center gap-1 rounded-md border border-accent-primary/60 bg-accent-primary/15 px-3 py-1.5 text-xs text-accent-primary transition-colors hover:bg-accent-primary/25"
                >
                  <Mail size={12} />
                  Send email
                </button>
                <button
                  type="button"
                  onClick={handleOpenFeedbackGmail}
                  className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-overlay px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                >
                  <ExternalLink size={12} />
                  Open Gmail
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
