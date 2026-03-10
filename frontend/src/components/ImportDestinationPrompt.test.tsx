import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen } from '../test/utils'
import { ImportDestinationPrompt } from './ImportDestinationPrompt'
import type { Collection, Folder } from '../types'

function makeFolderFile(name: string, webkitRelativePath: string): File {
  const file = new File(['audio'], name, { type: 'audio/wav' })
  Object.defineProperty(file, 'webkitRelativePath', {
    value: webkitRelativePath,
    configurable: true,
  })
  return file
}

const collections: Collection[] = [
  {
    id: 1,
    name: 'Existing Collection',
    color: '#000000',
    sortOrder: 0,
    folderCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

const folders: Folder[] = [
  {
    id: 10,
    name: 'Existing Folder',
    color: '#111111',
    parentId: null,
    collectionId: 1,
    sliceCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

const sourceFiles = [
  makeFolderFile('kick.wav', 'Drum Pack/Kicks/kick.wav'),
  makeFolderFile('snare.wav', 'Drum Pack/Snares/snare.wav'),
]

function buildProps(overrides: Partial<ComponentProps<typeof ImportDestinationPrompt>> = {}) {
  return {
    isOpen: true,
    sourceKind: 'folder' as const,
    importCount: sourceFiles.length,
    sourceFiles,
    folders,
    collections,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  }
}

describe('ImportDestinationPrompt', () => {
  it('shows the new collection option first and selected by default for folder imports', () => {
    const { container } = render(<ImportDestinationPrompt {...buildProps()} />)

    const collectionModeRadios = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="importDestinationCollectionMode"]'),
    )

    expect(collectionModeRadios.map((radio) => radio.parentElement?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Create one new collection for this import',
      'Create a collection for each first source subfolder',
      'Assign into an existing collection or folder',
    ])
    expect(screen.getByRole('radio', { name: 'Create one new collection for this import' })).toBeChecked()
    expect(screen.getByDisplayValue('Drum Pack')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import + Assign' })).toBeEnabled()
  })

  it('resets back to the new collection default when the prompt is reopened', async () => {
    const user = userEvent.setup()
    const firstRender = render(<ImportDestinationPrompt {...buildProps()} />)

    await act(async () => {
      await user.click(screen.getByRole('radio', { name: 'Assign into an existing collection or folder' }))
    })
    expect(screen.getByRole('radio', { name: 'Assign into an existing collection or folder' })).toBeChecked()

    firstRender.unmount()
    render(<ImportDestinationPrompt {...buildProps()} />)

    expect(screen.getByRole('radio', { name: 'Create one new collection for this import' })).toBeChecked()
    expect(screen.getByDisplayValue('Drum Pack')).toBeInTheDocument()
  })

  it('shows analysis parallelism only when support is provided and includes it in import confirmation', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { rerender } = render(
      <ImportDestinationPrompt
        {...buildProps({
          sourceKind: 'files',
          importCount: 1,
          sourceFiles: [sourceFiles[0]],
          onConfirm,
        })}
      />,
    )

    expect(screen.queryByText('Analysis parallelism')).not.toBeInTheDocument()

    rerender(
      <ImportDestinationPrompt
        {...buildProps({
          sourceKind: 'files',
          importCount: 1,
          sourceFiles: [sourceFiles[0]],
          analysisParallelismSupport: {
            defaultConcurrency: 2,
            maxConcurrency: 6,
            initialConcurrency: 3,
          },
          onConfirm,
        })}
      />,
    )

    expect(screen.getByText('Analysis parallelism')).toBeInTheDocument()

    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '5' } })
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Import Only' }))
    })

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        importType: 'sample',
        analysisConcurrency: 5,
        folderId: null,
        collectionId: null,
      }),
    )
  })
})
