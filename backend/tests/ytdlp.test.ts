import { describe, it, expect } from 'vitest'
import { extractVideoId, extractPlaylistId } from '../src/services/ytdlp.js'

describe('URL Parsing', () => {
  describe('extractVideoId', () => {
    it('extracts ID from standard YouTube URL', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
        .toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from YouTube URL with extra params', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest'))
        .toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from youtu.be short URL', () => {
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ'))
        .toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from embed URL', () => {
      expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'))
        .toBe('dQw4w9WgXcQ')
    })

    it('extracts ID from /v/ URL', () => {
      expect(extractVideoId('https://www.youtube.com/v/dQw4w9WgXcQ'))
        .toBe('dQw4w9WgXcQ')
    })

    it('accepts plain 11-character video ID', () => {
      expect(extractVideoId('dQw4w9WgXcQ'))
        .toBe('dQw4w9WgXcQ')
    })

    it('returns null for invalid input', () => {
      expect(extractVideoId('not-a-video-id')).toBeNull()
      expect(extractVideoId('https://example.com')).toBeNull()
      expect(extractVideoId('')).toBeNull()
    })

    it('handles IDs with underscores and hyphens', () => {
      expect(extractVideoId('abc_def-123'))
        .toBe('abc_def-123')
    })
  })

  describe('extractPlaylistId', () => {
    it('extracts playlist ID from playlist URL', () => {
      expect(extractPlaylistId('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'))
        .toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')
    })

    it('extracts playlist ID from watch URL with list param', () => {
      expect(extractPlaylistId('https://www.youtube.com/watch?v=abc123&list=PLtest123'))
        .toBe('PLtest123')
    })

    it('returns null when no playlist ID', () => {
      expect(extractPlaylistId('https://www.youtube.com/watch?v=abc123')).toBeNull()
      expect(extractPlaylistId('https://example.com')).toBeNull()
    })
  })
})
