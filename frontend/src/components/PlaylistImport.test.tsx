import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'
import { PlaylistImport } from './PlaylistImport'
import { server } from '../test/setup'
import { http, HttpResponse } from 'msw'

describe('PlaylistImport', () => {
  const mockOnTracksAdded = vi.fn()

  beforeEach(() => {
    mockOnTracksAdded.mockClear()
  })

  describe('when not authenticated', () => {
    it('shows login prompt', () => {
      render(
        <PlaylistImport
          isAuthenticated={false}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      expect(screen.getByText('Import Your Playlists')).toBeInTheDocument()
      expect(
        screen.getByText(/Sign in with Google to access your YouTube playlists/)
      ).toBeInTheDocument()
    })

    it('shows sign in button', () => {
      render(
        <PlaylistImport
          isAuthenticated={false}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      expect(
        screen.getByRole('link', { name: /Sign in with Google/i })
      ).toBeInTheDocument()
    })

    it('sign in link points to auth endpoint', () => {
      render(
        <PlaylistImport
          isAuthenticated={false}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      const link = screen.getByRole('link', { name: /Sign in with Google/i })
      expect(link).toHaveAttribute('href', '/api/auth/google')
    })
  })

  describe('when authenticated', () => {
    it('shows playlists after loading', async () => {
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })
      expect(screen.getByText('5 videos')).toBeInTheDocument()
    })

    it('shows Your Playlists header', async () => {
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      expect(screen.getByText('Your Playlists')).toBeInTheDocument()
    })

    it('shows playlist items when playlist is selected', async () => {
      const user = userEvent.setup()
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })

      await user.click(screen.getByText('My Playlist'))

      await waitFor(() => {
        expect(screen.getByText('Search Result 1')).toBeInTheDocument()
      })
    })

    it('shows back button when viewing playlist items', async () => {
      const user = userEvent.setup()
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })

      await user.click(screen.getByText('My Playlist'))

      await waitFor(() => {
        expect(screen.getByText('← Back')).toBeInTheDocument()
      })
    })

    it('goes back to playlist list when back clicked', async () => {
      const user = userEvent.setup()
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })

      await user.click(screen.getByText('My Playlist'))

      await waitFor(() => {
        expect(screen.getByText('← Back')).toBeInTheDocument()
      })

      await user.click(screen.getByText('← Back'))

      await waitFor(() => {
        expect(screen.getByText('Your Playlists')).toBeInTheDocument()
      })
    })

    it('shows Select All button when viewing items', async () => {
      const user = userEvent.setup()
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })

      await user.click(screen.getByText('My Playlist'))

      await waitFor(() => {
        expect(screen.getByText('Select All')).toBeInTheDocument()
      })
    })

    it('selects videos with checkboxes', async () => {
      const user = userEvent.setup()
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })

      await user.click(screen.getByText('My Playlist'))

      await waitFor(() => {
        expect(screen.getByText('Search Result 1')).toBeInTheDocument()
      })

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[0])

      expect(checkboxes[0]).toBeChecked()
    })

    it('shows import button with count', async () => {
      const user = userEvent.setup()
      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument()
      })

      await user.click(screen.getByText('My Playlist'))

      await waitFor(() => {
        expect(screen.getByText('Import (0)')).toBeInTheDocument()
      })

      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[0])

      expect(screen.getByText('Import (1)')).toBeInTheDocument()
    })

    it('shows no playlists message when empty', async () => {
      server.use(
        http.get('/api/youtube/playlists', () => {
          return HttpResponse.json([])
        })
      )

      render(
        <PlaylistImport
          isAuthenticated={true}
          onTracksAdded={mockOnTracksAdded}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('No playlists found')).toBeInTheDocument()
      })
    })
  })
})
