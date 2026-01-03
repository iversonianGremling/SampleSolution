import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'
import { TrackList } from './TrackList'
import { server } from '../test/setup'
import { http, HttpResponse } from 'msw'

describe('TrackList', () => {
  const mockOnSelectTrack = vi.fn()

  beforeEach(() => {
    mockOnSelectTrack.mockClear()
  })

  it('renders loading state initially', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    expect(screen.getByText('Loading tracks...')).toBeInTheDocument()
  })

  it('renders tracks after loading', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(screen.getByText('Test Track 1')).toBeInTheDocument()
    })
    expect(screen.getByText('Test Track 2')).toBeInTheDocument()
  })

  it('renders empty state when no tracks', async () => {
    server.use(
      http.get('/api/tracks', () => {
        return HttpResponse.json([])
      })
    )

    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(
        screen.getByText('No tracks yet. Add one using the search or import features.')
      ).toBeInTheDocument()
    })
  })

  it('renders track count in header', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(screen.getByText('Tracks (2)')).toBeInTheDocument()
    })
  })

  it('calls onSelectTrack when clicking a track', async () => {
    const user = userEvent.setup()
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(screen.getByText('Test Track 1')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Test Track 1'))

    expect(mockOnSelectTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, title: 'Test Track 1' })
    )
  })

  it('highlights selected track', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} selectedTrackId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Test Track 1')).toBeInTheDocument()
    })

    // The selected track should have the selected class
    const trackElement = screen.getByText('Test Track 1').closest('div[class*="cursor-pointer"]')
    expect(trackElement).toHaveClass('bg-indigo-900/30')
  })

  it('shows quick add input', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste YouTube URL to add...')).toBeInTheDocument()
    })
  })

  it('submits URL via quick add', async () => {
    const user = userEvent.setup()
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste YouTube URL to add...')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('Paste YouTube URL to add...')
    await user.type(input, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    // Input should be cleared after submission
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('displays track tags', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      expect(screen.getByText('jazz')).toBeInTheDocument()
    })
  })

  it('shows status icons for tracks', async () => {
    render(<TrackList onSelectTrack={mockOnSelectTrack} />)

    await waitFor(() => {
      // Track 1 is ready (should show check icon)
      // Track 2 is downloading (should show loader icon)
      expect(screen.getByText('Test Track 1')).toBeInTheDocument()
      expect(screen.getByText('Test Track 2')).toBeInTheDocument()
    })
  })
})
