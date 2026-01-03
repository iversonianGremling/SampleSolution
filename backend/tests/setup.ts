import { beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Test data directory - unique per test run
export const TEST_DATA_DIR = '/tmp/sample-extractor-test-' + process.pid

// Set environment variables before any imports
process.env.DATA_DIR = TEST_DATA_DIR
process.env.YOUTUBE_API_KEY = 'test-api-key'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

beforeAll(() => {
  // Create test directories
  const dirs = ['audio', 'slices', 'peaks']
  for (const dir of dirs) {
    fs.mkdirSync(path.join(TEST_DATA_DIR, dir), { recursive: true })
  }
})

afterAll(() => {
  // Clean up test directories
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
  } catch (e) {
    // Ignore cleanup errors
  }
})

// Helper to reset database between tests
export async function resetDatabase() {
  const dbPath = path.join(TEST_DATA_DIR, 'database.sqlite')

  // Import and reset db connection
  const { resetDbConnection } = await import('../src/db/index.js')
  resetDbConnection()

  // Delete existing database files
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
    if (fs.existsSync(dbPath + '-wal')) {
      fs.unlinkSync(dbPath + '-wal')
    }
    if (fs.existsSync(dbPath + '-shm')) {
      fs.unlinkSync(dbPath + '-shm')
    }
  } catch (e) {
    // Ignore errors
  }
}

// Get the app's database connection
export async function getAppDb() {
  const { getRawDb } = await import('../src/db/index.js')
  return getRawDb()
}
