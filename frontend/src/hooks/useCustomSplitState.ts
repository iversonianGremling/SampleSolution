import { useReducer } from 'react'

export interface SplitSourceSelection {
  selectedCollectionIds: Set<number>
  selectedFolderIds: Set<number>
  selectedTagIds: Set<number>
  individuallySelectedIds: Set<number>
  excludedSampleIds: Set<number>
}

export interface SplitCategory {
  tempId: string
  name: string
  color: string
  destinationType: 'folder' | 'tag'
  destinationCollectionId: number | null
  parentFolderId: number | null
  destinationTagId: number | null
  parentTempId: string | null
  isVirtualParent: boolean
  sourceSelection: SplitSourceSelection
}

export interface CustomSplitState {
  categories: SplitCategory[]
  activeCategoryId: string | null
  sourceSearchQuery: string
  expandedSourceCollections: Set<number>
  expandedSourceFolders: Set<number>
}

function createEmptySelection(): SplitSourceSelection {
  return {
    selectedCollectionIds: new Set(),
    selectedFolderIds: new Set(),
    selectedTagIds: new Set(),
    individuallySelectedIds: new Set(),
    excludedSampleIds: new Set(),
  }
}

let tempIdCounter = 0
function generateTempId(): string {
  return `split-${++tempIdCounter}-${Date.now()}`
}

export type CustomSplitAction =
  | { type: 'ADD_CATEGORY' }
  | { type: 'BULK_ADD_CATEGORIES'; categories: Array<{
      tempId?: string
      name: string
      color?: string
      destinationType?: 'folder' | 'tag'
      destinationCollectionId?: number | null
      parentFolderId?: number | null
      destinationTagId?: number | null
      parentTempId?: string | null
      isVirtualParent?: boolean
      selectedCollectionIds?: number[]
      selectedFolderIds?: number[]
      selectedTagIds?: number[]
      selectedSampleIds?: number[]
      excludedSampleIds?: number[]
    }> }
  | { type: 'REMOVE_CATEGORY'; tempId: string }
  | { type: 'MERGE_CATEGORIES'; sourceId: string; targetId: string }
  | { type: 'RENAME_CATEGORY'; tempId: string; name: string }
  | { type: 'SET_CATEGORY_COLOR'; tempId: string; color: string }
  | { type: 'SET_ACTIVE_CATEGORY'; tempId: string }
  | { type: 'SET_DESTINATION_TYPE'; tempId: string; destinationType: 'folder' | 'tag' }
  | { type: 'SET_DESTINATION_COLLECTION'; tempId: string; collectionId: number | null }
  | { type: 'SET_DESTINATION_PARENT'; tempId: string; parentFolderId: number | null }
  | { type: 'SET_DESTINATION_TAG'; tempId: string; tagId: number | null }
  | { type: 'TOGGLE_SOURCE_COLLECTION'; collectionId: number }
  | { type: 'TOGGLE_SOURCE_FOLDER'; folderId: number }
  | { type: 'TOGGLE_SOURCE_TAG'; tagId: number }
  | { type: 'TOGGLE_INDIVIDUAL_SAMPLE'; sampleId: number }
  | { type: 'EXCLUDE_SAMPLE'; sampleId: number }
  | { type: 'INCLUDE_SAMPLE'; sampleId: number }
  | { type: 'SET_SOURCE_SEARCH'; query: string }
  | { type: 'TOGGLE_EXPAND_FOLDER'; folderId: number }
  | { type: 'TOGGLE_EXPAND_COLLECTION'; collectionId: number }
  | { type: 'CLEAR_SELECTED_COLLECTIONS' }
  | { type: 'CLEAR_SELECTED_FOLDERS' }
  | { type: 'CLEAR_SELECTED_TAGS' }
  | { type: 'CLEAR_SELECTED_SAMPLES' }
  | { type: 'CLEAR_EXCLUDED_SAMPLES' }
  | { type: 'COLLAPSE_ALL_FOLDERS' }
  | { type: 'RESET' }

function toggleInSet<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return next
}

function updateActiveCategory(
  state: CustomSplitState,
  updater: (sel: SplitSourceSelection) => SplitSourceSelection
): CustomSplitState {
  if (!state.activeCategoryId) return state
  return {
    ...state,
    categories: state.categories.map(category =>
      category.tempId === state.activeCategoryId
        ? { ...category, sourceSelection: updater(category.sourceSelection) }
        : category
    ),
  }
}

function createCategory(): SplitCategory {
  return {
    tempId: generateTempId(),
    name: '',
    color: '#6366f1',
    destinationType: 'folder',
    destinationCollectionId: null,
    parentFolderId: null,
    destinationTagId: null,
    parentTempId: null,
    isVirtualParent: false,
    sourceSelection: createEmptySelection(),
  }
}

function reducer(state: CustomSplitState, action: CustomSplitAction): CustomSplitState {
  switch (action.type) {
    case 'ADD_CATEGORY': {
      const newCategory = createCategory()
      return {
        ...state,
        categories: [...state.categories, newCategory],
        activeCategoryId: newCategory.tempId,
      }
    }

    case 'BULK_ADD_CATEGORIES': {
      const newCategories: SplitCategory[] = action.categories.map(cat => ({
        tempId: cat.tempId || generateTempId(),
        name: cat.name,
        color: cat.color || '#6366f1',
        destinationType: cat.destinationType || 'folder',
        destinationCollectionId: cat.destinationCollectionId ?? null,
        parentFolderId: cat.parentFolderId ?? null,
        destinationTagId: cat.destinationTagId ?? null,
        parentTempId: cat.parentTempId ?? null,
        isVirtualParent: cat.isVirtualParent ?? false,
        sourceSelection: {
          selectedCollectionIds: new Set(cat.selectedCollectionIds || []),
          selectedFolderIds: new Set(cat.selectedFolderIds || []),
          selectedTagIds: new Set(cat.selectedTagIds || []),
          individuallySelectedIds: new Set(cat.selectedSampleIds || []),
          excludedSampleIds: new Set(cat.excludedSampleIds || []),
        },
      }))

      const lastId = newCategories.length > 0 ? newCategories[newCategories.length - 1].tempId : state.activeCategoryId

      return {
        ...state,
        categories: [...state.categories, ...newCategories],
        activeCategoryId: lastId ?? state.activeCategoryId,
      }
    }

    case 'REMOVE_CATEGORY': {
      const remaining = state.categories.filter(cat => cat.tempId !== action.tempId)
      return {
        ...state,
        categories: remaining,
        activeCategoryId:
          state.activeCategoryId === action.tempId
            ? (remaining.length > 0 ? remaining[remaining.length - 1].tempId : null)
            : state.activeCategoryId,
      }
    }

    case 'MERGE_CATEGORIES': {
      if (action.sourceId === action.targetId) return state
      const source = state.categories.find(cat => cat.tempId === action.sourceId)
      const target = state.categories.find(cat => cat.tempId === action.targetId)
      if (!source || !target) return state

      const mergedSelection: SplitSourceSelection = {
        selectedCollectionIds: new Set([
          ...target.sourceSelection.selectedCollectionIds,
          ...source.sourceSelection.selectedCollectionIds,
        ]),
        selectedFolderIds: new Set([
          ...target.sourceSelection.selectedFolderIds,
          ...source.sourceSelection.selectedFolderIds,
        ]),
        selectedTagIds: new Set([
          ...target.sourceSelection.selectedTagIds,
          ...source.sourceSelection.selectedTagIds,
        ]),
        individuallySelectedIds: new Set([
          ...target.sourceSelection.individuallySelectedIds,
          ...source.sourceSelection.individuallySelectedIds,
        ]),
        excludedSampleIds: new Set([
          ...target.sourceSelection.excludedSampleIds,
          ...source.sourceSelection.excludedSampleIds,
        ]),
      }

      return {
        ...state,
        categories: state.categories
          .filter(cat => cat.tempId !== action.sourceId)
          .map(cat =>
            cat.tempId === action.targetId ? { ...cat, sourceSelection: mergedSelection } : cat
          ),
        activeCategoryId: action.targetId,
      }
    }

    case 'RENAME_CATEGORY':
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.tempId === action.tempId ? { ...cat, name: action.name } : cat
        ),
      }

    case 'SET_CATEGORY_COLOR':
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.tempId === action.tempId ? { ...cat, color: action.color } : cat
        ),
      }

    case 'SET_ACTIVE_CATEGORY':
      return { ...state, activeCategoryId: action.tempId }

    case 'SET_DESTINATION_TYPE':
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.tempId === action.tempId
            ? {
                ...cat,
                destinationType: action.destinationType,
                destinationCollectionId: action.destinationType === 'folder' ? cat.destinationCollectionId : null,
                parentFolderId: action.destinationType === 'folder' ? cat.parentFolderId : null,
                destinationTagId: action.destinationType === 'tag' ? cat.destinationTagId : null,
              }
            : cat
        ),
      }

    case 'SET_DESTINATION_COLLECTION':
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.tempId === action.tempId
            ? { ...cat, destinationCollectionId: action.collectionId, parentFolderId: null }
            : cat
        ),
      }

    case 'SET_DESTINATION_PARENT':
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.tempId === action.tempId ? { ...cat, parentFolderId: action.parentFolderId } : cat
        ),
      }

    case 'SET_DESTINATION_TAG':
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.tempId === action.tempId ? { ...cat, destinationTagId: action.tagId } : cat
        ),
      }

    case 'TOGGLE_SOURCE_COLLECTION':
      return updateActiveCategory(state, sel => ({
        ...sel,
        selectedCollectionIds: toggleInSet(sel.selectedCollectionIds, action.collectionId),
      }))

    case 'TOGGLE_SOURCE_FOLDER':
      return updateActiveCategory(state, sel => ({
        ...sel,
        selectedFolderIds: toggleInSet(sel.selectedFolderIds, action.folderId),
      }))

    case 'TOGGLE_SOURCE_TAG':
      return updateActiveCategory(state, sel => ({
        ...sel,
        selectedTagIds: toggleInSet(sel.selectedTagIds, action.tagId),
      }))

    case 'TOGGLE_INDIVIDUAL_SAMPLE':
      return updateActiveCategory(state, sel => ({
        ...sel,
        individuallySelectedIds: toggleInSet(sel.individuallySelectedIds, action.sampleId),
      }))

    case 'EXCLUDE_SAMPLE':
      return updateActiveCategory(state, sel => ({
        ...sel,
        excludedSampleIds: toggleInSet(sel.excludedSampleIds, action.sampleId),
      }))

    case 'INCLUDE_SAMPLE':
      return updateActiveCategory(state, sel => ({
        ...sel,
        excludedSampleIds: (() => {
          const next = new Set(sel.excludedSampleIds)
          next.delete(action.sampleId)
          return next
        })(),
      }))

    case 'SET_SOURCE_SEARCH':
      return { ...state, sourceSearchQuery: action.query }

    case 'TOGGLE_EXPAND_FOLDER':
      return { ...state, expandedSourceFolders: toggleInSet(state.expandedSourceFolders, action.folderId) }

    case 'TOGGLE_EXPAND_COLLECTION':
      return { ...state, expandedSourceCollections: toggleInSet(state.expandedSourceCollections, action.collectionId) }

    case 'CLEAR_SELECTED_COLLECTIONS':
      return updateActiveCategory(state, sel => ({ ...sel, selectedCollectionIds: new Set() }))

    case 'CLEAR_SELECTED_FOLDERS':
      return updateActiveCategory(state, sel => ({ ...sel, selectedFolderIds: new Set() }))

    case 'CLEAR_SELECTED_TAGS':
      return updateActiveCategory(state, sel => ({ ...sel, selectedTagIds: new Set() }))

    case 'CLEAR_SELECTED_SAMPLES':
      return updateActiveCategory(state, sel => ({ ...sel, individuallySelectedIds: new Set() }))

    case 'CLEAR_EXCLUDED_SAMPLES':
      return updateActiveCategory(state, sel => ({ ...sel, excludedSampleIds: new Set() }))

    case 'COLLAPSE_ALL_FOLDERS':
      return { ...state, expandedSourceCollections: new Set(), expandedSourceFolders: new Set() }

    case 'RESET':
      return createInitialState()

    default:
      return state
  }
}

function createInitialState(): CustomSplitState {
  return {
    categories: [],
    activeCategoryId: null,
    sourceSearchQuery: '',
    expandedSourceCollections: new Set(),
    expandedSourceFolders: new Set(),
  }
}

export function useCustomSplitState() {
  return useReducer(reducer, undefined, createInitialState)
}
