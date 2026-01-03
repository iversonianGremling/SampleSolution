import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../test/utils'
import userEvent from '@testing-library/user-event'
import { SliceList } from './SliceList'
import type { Slice } from '../types'

const mockSlices: Slice[] = [
  {
    id: 1,
    trackId: 1,
    name: 'Intro Section',
    startTime: 0,
    endTime: 15.5,
    filePath: '/data/slices/slice1.mp3',
    createdAt: '2024-01-01T00:00:00Z',
    tags: [{ id: 1, name: 'intro', color: '#3b82f6' }],
  },
  {
    id: 2,
    trackId: 1,
    name: 'Main Loop',
    startTime: 30,
    endTime: 45.75,
    filePath: null,
    createdAt: '2024-01-01T00:00:00Z',
    tags: [],
  },
]

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

describe('SliceList', () => {
  const mockOnPlay = vi.fn()
  const mockOnDelete = vi.fn()

  beforeEach(() => {
    mockOnPlay.mockClear()
    mockOnDelete.mockClear()
  })

  it('shows empty state when no slices', () => {
    render(
      <SliceList
        slices={[]}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    expect(
      screen.getByText('No slices yet. Drag on the waveform to create one.')
    ).toBeInTheDocument()
  })

  it('renders slices with names', () => {
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    expect(screen.getByText('Intro Section')).toBeInTheDocument()
    expect(screen.getByText('Main Loop')).toBeInTheDocument()
  })

  it('shows slice count in header', () => {
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    expect(screen.getByText('Slices (2)')).toBeInTheDocument()
  })

  it('displays time ranges', () => {
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    // First slice: 0:00.00 - 0:15.50
    expect(screen.getByText('0:00.00 - 0:15.50')).toBeInTheDocument()
    // Second slice: 0:30.00 - 0:45.75
    expect(screen.getByText('0:30.00 - 0:45.75')).toBeInTheDocument()
  })

  it('displays slice tags', () => {
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    expect(screen.getByText('intro')).toBeInTheDocument()
  })

  it('calls onPlay when play button clicked', async () => {
    const user = userEvent.setup()
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    const playButtons = screen.getAllByTitle('Play slice')
    await user.click(playButtons[0])

    expect(mockOnPlay).toHaveBeenCalledWith(mockSlices[0])
  })

  it('calls onDelete when delete button clicked', async () => {
    const user = userEvent.setup()
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    const deleteButtons = screen.getAllByTitle('Delete slice')
    await user.click(deleteButtons[0])

    expect(mockOnDelete).toHaveBeenCalledWith(mockSlices[0])
  })

  it('shows download button only for slices with files', () => {
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    const downloadButtons = screen.getAllByTitle('Download slice')
    // Only the first slice has a filePath
    expect(downloadButtons).toHaveLength(1)
  })

  it('download link has correct href', () => {
    render(
      <SliceList
        slices={mockSlices}
        onPlay={mockOnPlay}
        onDelete={mockOnDelete}
        formatTime={formatTime}
      />
    )

    const downloadLink = screen.getByTitle('Download slice')
    expect(downloadLink).toHaveAttribute('href', '/api/slices/1/download')
  })
})
