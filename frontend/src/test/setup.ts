import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Setup MSW server
export const server = setupServer(...handlers)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})

// Mock matchMedia for components that use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock ResizeObserver for wavesurfer
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverMock

// Mock AudioContext for wavesurfer
class AudioContextMock {
  createGain() {
    return { connect: () => {}, gain: { value: 1 } }
  }
  createAnalyser() {
    return { connect: () => {}, fftSize: 0 }
  }
  createMediaElementSource() {
    return { connect: () => {} }
  }
  decodeAudioData() {
    return Promise.resolve({})
  }
}
window.AudioContext = AudioContextMock as any
