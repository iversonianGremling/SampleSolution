import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'
import { YouTubeSearch } from './YouTubeSearch'
import { server } from '../test/setup'
import { http, HttpResponse } from 'msw'

describe('YouTubeSearch', () => {
  const mockOnTrackAdded = vi.fn()

  beforeEach(() => {
    mockOnTrackAdded.mockClear()
  })

  it('renders search input and button', () => {
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    expect(screen.getByPlaceholderText('Search YouTube...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('shows empty state before searching', () => {
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    expect(
      screen.getByText('Enter a search term to find YouTube videos')
    ).toBeInTheDocument()
  })

  it('shows results after searching', async () => {
    const user = userEvent.setup()
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const input = screen.getByPlaceholderText('Search YouTube...')
    await user.type(input, 'jazz samples')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('Search Result 1')).toBeInTheDocument()
    })
    expect(screen.getByText('Search Result 2')).toBeInTheDocument()
  })

  it('shows results header with search term', async () => {
    const user = userEvent.setup()
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const input = screen.getByPlaceholderText('Search YouTube...')
    await user.type(input, 'jazz samples')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('Results for "jazz samples"')).toBeInTheDocument()
    })
  })

  it('shows no results message', async () => {
    server.use(
      http.get('/api/youtube/search', () => {
        return HttpResponse.json([])
      })
    )

    const user = userEvent.setup()
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const input = screen.getByPlaceholderText('Search YouTube...')
    await user.type(input, 'asdfghjklqwerty')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(
        screen.getByText('No results found for "asdfghjklqwerty"')
      ).toBeInTheDocument()
    })
  })

  it('shows error message on API failure', async () => {
    server.use(
      http.get('/api/youtube/search', () => {
        return HttpResponse.json({ error: 'API Error' }, { status: 500 })
      })
    )

    const user = userEvent.setup()
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const input = screen.getByPlaceholderText('Search YouTube...')
    await user.type(input, 'test')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(
        screen.getByText('Error searching YouTube. Please check your API key.')
      ).toBeInTheDocument()
    })
  })

  it('adds track and calls onTrackAdded', async () => {
    const user = userEvent.setup()
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const input = screen.getByPlaceholderText('Search YouTube...')
    await user.type(input, 'jazz')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('Search Result 1')).toBeInTheDocument()
    })

    // Click the add button (Plus icon)
    const addButtons = screen.getAllByTitle('Add to tracks')
    await user.click(addButtons[0])

    await waitFor(() => {
      expect(mockOnTrackAdded).toHaveBeenCalled()
    })
  })

  it('disables search button when input is empty', () => {
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const button = screen.getByRole('button', { name: 'Search' })
    expect(button).toBeDisabled()
  })

  it('enables search button when input has text', async () => {
    const user = userEvent.setup()
    render(<YouTubeSearch onTrackAdded={mockOnTrackAdded} />)

    const input = screen.getByPlaceholderText('Search YouTube...')
    await user.type(input, 'test')

    const button = screen.getByRole('button', { name: 'Search' })
    expect(button).not.toBeDisabled()
  })
})
