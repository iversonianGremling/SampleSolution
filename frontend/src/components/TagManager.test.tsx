import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '../test/utils'
import userEvent from '@testing-library/user-event'
import { TagManager } from './TagManager'
import { server } from '../test/setup'
import { http, HttpResponse } from 'msw'

describe('TagManager', () => {
  it('renders create tag form', () => {
    render(<TagManager />)

    expect(screen.getByPlaceholderText('Instrument name...')).toBeInTheDocument()
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('renders existing tags after loading', async () => {
    render(<TagManager />)

    await waitFor(() => {
      expect(screen.getByText('jazz')).toBeInTheDocument()
    })
    expect(screen.getByText('piano')).toBeInTheDocument()
    expect(screen.getByText('chill')).toBeInTheDocument()
  })

  it('shows tag count in header', async () => {
    render(<TagManager />)

    await waitFor(() => {
      expect(screen.getByText('All Instruments (3)')).toBeInTheDocument()
    })
  })

  it('shows empty state when no tags', async () => {
    server.use(
      http.get('/api/tags', () => {
        return HttpResponse.json([])
      })
    )

    render(<TagManager />)

    await waitFor(() => {
      expect(screen.getByText('No instruments yet. Create one above.')).toBeInTheDocument()
    })
  })

  it('creates a new tag', async () => {
    const user = userEvent.setup()
    render(<TagManager />)

    const input = screen.getByPlaceholderText('Instrument name...')
    await user.type(input, 'newtag')

    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('disables create button when input is empty', () => {
    render(<TagManager />)

    const createButton = screen.getByRole('button', { name: 'Create' })
    expect(createButton).toBeDisabled()
  })

  it('enables create button when input has text', async () => {
    const user = userEvent.setup()
    render(<TagManager />)

    const input = screen.getByPlaceholderText('Instrument name...')
    await user.type(input, 'test')

    const createButton = screen.getByRole('button', { name: 'Create' })
    expect(createButton).not.toBeDisabled()
  })

  it('shows tag preview', async () => {
    const user = userEvent.setup()
    render(<TagManager />)

    expect(screen.getByText('Preview:')).toBeInTheDocument()
    expect(screen.getByText('Instrument name')).toBeInTheDocument() // Default preview

    const input = screen.getByPlaceholderText('Instrument name...')
    await user.type(input, 'preview-tag')

    expect(screen.getByText('preview-tag')).toBeInTheDocument()
  })

  it('renders color picker with preset colors', async () => {
    render(<TagManager />)

    await waitFor(() => {
      // Should have 16 color buttons
      const colorButtons = screen.getAllByRole('button').filter(
        (btn) => btn.className.includes('rounded-full') && btn.className.includes('w-8')
      )
      expect(colorButtons.length).toBe(16)
    })
  })

  it('selects a color', async () => {
    const user = userEvent.setup()
    render(<TagManager />)

    await waitFor(() => {
      expect(screen.getByText('Color')).toBeInTheDocument()
    })

    // Find color buttons (rounded-full buttons)
    const colorButtons = screen.getAllByRole('button').filter(
      (btn) => btn.className.includes('rounded-full') && btn.className.includes('w-8')
    )

    // Click second color
    await user.click(colorButtons[1])

    // The clicked button should have the ring class
    expect(colorButtons[1]).toHaveClass('ring-2')
  })

  it('shows info section about tags', () => {
    render(<TagManager />)

    expect(screen.getByText('About Instruments')).toBeInTheDocument()
    expect(screen.getByText(/Instruments can be added to tracks/)).toBeInTheDocument()
  })
})
