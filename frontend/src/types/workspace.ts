import type { Folder, SliceWithTrackExtended, Tag } from './index'
import type { UpdateSlicePayload } from '../api/client'

export type WorkspaceTab = 'details' | 'rack' | 'lab'

export interface WorkspaceState {
  selectedSample: SliceWithTrackExtended | null
  allTags: Tag[]
  folders: Folder[]
  pitchSemitones?: number
  tuneTargetNote: string | null
  onToggleFavorite: (sliceId: number) => void
  onAddTag: (sliceId: number, tagId: number) => void
  onRemoveTag: (sliceId: number, tagId: number) => void
  onAddToFolder: (folderId: number, sliceId: number) => void
  onRemoveFromFolder: (folderId: number, sliceId: number) => void
  onUpdateName: (sliceId: number, name: string) => void
  onUpdateSample: (sliceId: number, data: UpdateSlicePayload) => void
  onTagClick: (tagId: number) => void
  onSelectSample: (sampleId: number) => void
  onFilterBySimilarity: (sampleId: number, sampleName: string) => void
  onSampleDeleted: (sampleId: number) => void
  onTuneToNote: (note: string | null) => void
}

export interface CollectionOverviewTag {
  id: number
  name: string
  color: string
  count: number
}

export interface CollectionOverviewMetric {
  name: string
  count: number
}

export interface CollectionOverview {
  scopeLabel: string
  totalSamples: number
  totalTracks: number
  totalFolders: number
  totalTags: number
  favoriteSamples: number
  modifiedSamples: number
  totalDurationSec: number
  averageDurationSec: number
  averageBpm: number | null
  topTags: CollectionOverviewTag[]
  topInstruments: CollectionOverviewMetric[]
  topKeys: CollectionOverviewMetric[]
}
