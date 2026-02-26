import { describe, expect, it, vi } from 'vitest'
import type { Folder } from '../types'
import { assignImportsPreservingStructure } from './importStructure'

function makeFolder(
  id: number,
  name: string,
  parentId: number | null,
  collectionId: number | null,
): Folder {
  return {
    id,
    name,
    color: '#64748b',
    parentId,
    collectionId,
    sliceCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeFile(name: string, webkitRelativePath: string): File {
  const file = new File(['audio'], name, { type: 'audio/wav' })
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    configurable: true,
  })
  return file
}

describe('assignImportsPreservingStructure', () => {
  it('keeps the selected parent folder when bypassParentFolder is false', async () => {
    let nextFolderId = 100
    const destinationFolder = makeFolder(10, 'Destination', null, 1)
    const createCalls: Array<{ name: string; parentId?: number; collectionId?: number }> = []
    const assignCalls: Array<{ folderId: number; sliceIds: number[] }> = []

    const result = await assignImportsPreservingStructure({
      destinationFolder,
      successfulImports: [
        {
          sliceId: 501,
          file: makeFile('kick.wav', '420NONSCOPE_SAMPLES_2000k/LOOPS/kick.wav'),
        },
      ],
      existingFolders: [destinationFolder],
      createFolder: vi.fn(async ({ name, parentId, collectionId }) => {
        createCalls.push({ name, parentId, collectionId })
        const created = makeFolder(nextFolderId, name, parentId ?? null, collectionId ?? null)
        nextFolderId += 1
        return created
      }),
      assignSlicesToFolder: vi.fn(async (folderId, sliceIds) => {
        assignCalls.push({ folderId, sliceIds })
      }),
      bypassParentFolder: false,
    })

    expect(result).toEqual({
      assignedCount: 1,
      createdFolderCount: 2,
    })
    expect(createCalls).toEqual([
      { name: '420NONSCOPE_SAMPLES_2000k', parentId: 10, collectionId: 1 },
      { name: 'LOOPS', parentId: 100, collectionId: 1 },
    ])
    expect(assignCalls).toEqual([
      { folderId: 101, sliceIds: [501] },
    ])
  })

  it('skips the selected parent folder when bypassParentFolder is true', async () => {
    let nextFolderId = 100
    const destinationFolder = makeFolder(10, 'Destination', null, 1)
    const createCalls: Array<{ name: string; parentId?: number; collectionId?: number }> = []
    const assignCalls: Array<{ folderId: number; sliceIds: number[] }> = []

    const result = await assignImportsPreservingStructure({
      destinationFolder,
      successfulImports: [
        {
          sliceId: 777,
          file: makeFile('snare.wav', '420NONSCOPE_SAMPLES_2000k/LOOPS/snare.wav'),
        },
      ],
      existingFolders: [destinationFolder],
      createFolder: vi.fn(async ({ name, parentId, collectionId }) => {
        createCalls.push({ name, parentId, collectionId })
        const created = makeFolder(nextFolderId, name, parentId ?? null, collectionId ?? null)
        nextFolderId += 1
        return created
      }),
      assignSlicesToFolder: vi.fn(async (folderId, sliceIds) => {
        assignCalls.push({ folderId, sliceIds })
      }),
      bypassParentFolder: true,
    })

    expect(result).toEqual({
      assignedCount: 1,
      createdFolderCount: 1,
    })
    expect(createCalls).toEqual([
      { name: 'LOOPS', parentId: 10, collectionId: 1 },
    ])
    expect(assignCalls).toEqual([
      { folderId: 100, sliceIds: [777] },
    ])
  })

  it('can preserve directly under a collection root without creating a dated wrapper folder', async () => {
    let nextFolderId = 200
    const createCalls: Array<{ name: string; parentId?: number; collectionId?: number }> = []
    const assignCalls: Array<{ folderId: number; sliceIds: number[] }> = []

    const result = await assignImportsPreservingStructure({
      destinationCollectionId: 9,
      successfulImports: [
        {
          sliceId: 901,
          file: makeFile('loop.wav', '420NONSCOPE_SAMPLES_2000k/LOOPS/loop.wav'),
        },
      ],
      existingFolders: [],
      createFolder: vi.fn(async ({ name, parentId, collectionId }) => {
        createCalls.push({ name, parentId, collectionId })
        const created = makeFolder(nextFolderId, name, parentId ?? null, collectionId ?? null)
        nextFolderId += 1
        return created
      }),
      assignSlicesToFolder: vi.fn(async (folderId, sliceIds) => {
        assignCalls.push({ folderId, sliceIds })
      }),
      bypassParentFolder: true,
    })

    expect(result).toEqual({
      assignedCount: 1,
      createdFolderCount: 1,
    })
    expect(createCalls).toEqual([
      { name: 'LOOPS', parentId: undefined, collectionId: 9 },
    ])
    expect(assignCalls).toEqual([
      { folderId: 200, sliceIds: [901] },
    ])
  })
})
