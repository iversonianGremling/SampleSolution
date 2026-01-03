import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'
import { LinkImport } from './LinkImport'
import { server } from '../test/setup'
import { http, HttpResponse } from 'msw'

describe('LinkImport', () => {
  const mockOnTracksAdded = vi.fn()

  beforeEach(() => {
    mockOnTracksAdded.mockClear()
  })

  it('renders textarea and buttons', () => {
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  })

  it('shows placeholder with format examples', () => {
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('placeholder')
    expect(textarea.getAttribute('placeholder')).toContain('YouTube URLs')
  })

  it('shows line count', async () => {
    const user = userEvent.setup()
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    expect(screen.getByText('0 lines')).toBeInTheDocument()

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'line1\nline2\nline3')

    expect(screen.getByText('3 lines')).toBeInTheDocument()
  })

  it('clears textarea when Clear button clicked', async () => {
    const user = userEvent.setup()
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'some text')

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(textarea).toHaveValue('')
  })

  it('disables Import button when textarea is empty', () => {
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const importButton = screen.getByRole('button', { name: 'Import' })
    expect(importButton).toBeDisabled()
  })

  it('enables Import button when textarea has content', async () => {
    const user = userEvent.setup()
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'https://www.youtube.com/watch?v=abc123')

    const importButton = screen.getByRole('button', { name: 'Import' })
    expect(importButton).not.toBeDisabled()
  })

  it('imports URLs and shows success message', async () => {
    const user = userEvent.setup()
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'https://www.youtube.com/watch?v=abc123\nhttps://www.youtube.com/watch?v=def456')

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(screen.getByText('2 imported successfully')).toBeInTheDocument()
    })
    expect(mockOnTracksAdded).toHaveBeenCalled()
  })

  it('shows failed imports', async () => {
    server.use(
      http.post('/api/youtube/import', () => {
        return HttpResponse.json({
          success: ['abc123'],
          failed: [{ url: 'invalid-url', error: 'Invalid URL' }],
        })
      })
    )

    const user = userEvent.setup()
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'abc123\ninvalid-url')

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(screen.getByText('1 imported successfully')).toBeInTheDocument()
    })
    expect(screen.getByText('1 failed to import')).toBeInTheDocument()
  })

  it('does not call onTracksAdded when all imports fail', async () => {
    server.use(
      http.post('/api/youtube/import', () => {
        return HttpResponse.json({
          success: [],
          failed: [{ url: 'invalid', error: 'Invalid' }],
        })
      })
    )

    const user = userEvent.setup()
    render(<LinkImport onTracksAdded={mockOnTracksAdded} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'invalid')

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(screen.getByText('1 failed to import')).toBeInTheDocument()
    })
    expect(mockOnTracksAdded).not.toHaveBeenCalled()
  })
})
