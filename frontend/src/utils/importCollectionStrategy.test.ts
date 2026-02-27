import { describe, expect, it } from 'vitest'
import type { SuccessfulLocalImport } from './importStructure'
import {
  buildCollectionSubdivisionGroups,
  getDefaultCollectionNameForFolderImport,
} from './importCollectionStrategy'

function makeFile(name: string, webkitRelativePath: string): File {
  const file = new File(['audio'], name, { type: 'audio/wav' })
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    configurable: true,
  })
  return file
}

describe('importCollectionStrategy', () => {
  it('uses the imported root folder as the default collection name', () => {
    const files = [
      makeFile('kick.wav', 'Drum Pack/Kicks/kick.wav'),
      makeFile('snare.wav', 'Drum Pack/Snares/snare.wav'),
    ]

    expect(getDefaultCollectionNameForFolderImport(files)).toBe('Drum Pack')
  })

  it('groups imports by first-level subfolder and rewrites preserve paths', () => {
    const successfulImports: SuccessfulLocalImport[] = [
      { sliceId: 1, file: makeFile('tight.wav', 'Drum Pack/Kicks/tight.wav') },
      { sliceId: 2, file: makeFile('deep.wav', 'Drum Pack/Kicks/808/deep.wav') },
      { sliceId: 3, file: makeFile('snap.wav', 'Drum Pack/Snares/snap.wav') },
      { sliceId: 4, file: makeFile('preview.wav', 'Drum Pack/preview.wav') },
    ]

    const groups = buildCollectionSubdivisionGroups(successfulImports)

    expect(groups.map((group) => group.collectionName)).toEqual([
      'Drum Pack',
      'Kicks',
      'Snares',
    ])

    const kicksGroup = groups.find((group) => group.collectionName === 'Kicks')
    expect(kicksGroup?.originalImports.map((entry) => entry.sliceId)).toEqual([1, 2])
    expect(
      kicksGroup?.preserveReadyImports.map((entry) => (entry.file as File & { webkitRelativePath?: string }).webkitRelativePath),
    ).toEqual([
      '__import_root__/tight.wav',
      '__import_root__/808/deep.wav',
    ])

    const rootGroup = groups.find((group) => group.collectionName === 'Drum Pack')
    expect(
      rootGroup?.preserveReadyImports.map((entry) => (entry.file as File & { webkitRelativePath?: string }).webkitRelativePath),
    ).toEqual([
      '__import_root__/preview.wav',
    ])
  })
})
