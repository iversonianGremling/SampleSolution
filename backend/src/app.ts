import express from 'express'
import cors from 'cors'
import session from 'express-session'
import path from 'path'
import fs from 'fs'

import tracksRouter from './routes/tracks.js'
import slicesRouter from './routes/slices.js'
import youtubeRouter from './routes/youtube.js'
import authRouter from './routes/auth.js'
import tagsRouter from './routes/tags.js'
import foldersRouter from './routes/folders.js'
import collectionsRouter from './routes/collections.js'
import importRouter from './routes/import.js'
import libraryRouter from './routes/library.js'
import spotifyRouter from './routes/spotify.js'
import soundcloudRouter from './routes/soundcloud.js'
import toolsRouter from './routes/tools.js'
import backupRouter from './routes/backup.js'
import { startBackupScheduler } from './services/backup.js'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value || value.trim() === '') return fallback
  return TRUTHY.has(value.trim().toLowerCase())
}

export function createApp(options: { dataDir?: string; frontendUrl?: string; sessionSecret?: string } = {}) {
  const app = express()
  const DATA_DIR = options.dataDir || process.env.DATA_DIR || './data'
  const FRONTEND_URL = options.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'
  const SESSION_SECRET = options.sessionSecret || process.env.SESSION_SECRET || 'dev-secret-change-me'
  const SPOTIFY_IMPORT_ENABLED = parseBooleanEnv(process.env.ENABLE_SPOTIFY_IMPORT, true)
  const CORS_ALLOW_NULL_ORIGIN = parseBooleanEnv(process.env.CORS_ALLOW_NULL_ORIGIN, false)
  const CORS_ALLOW_NO_ORIGIN = parseBooleanEnv(process.env.CORS_ALLOW_NO_ORIGIN, false)
  const CORS_ALLOW_ALL_ORIGINS = parseBooleanEnv(process.env.CORS_ALLOW_ALL_ORIGINS, false)
  const CORS_EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const allowedOrigins = new Set([FRONTEND_URL, ...CORS_EXTRA_ORIGINS])

  // Ensure data directories exist
  const dirs = ['audio', 'slices', 'peaks', 'uploads']
  for (const dir of dirs) {
    const dirPath = path.join(DATA_DIR, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }

  // Middleware
  app.use(cors({
    origin: (origin, callback) => {
      if (CORS_ALLOW_ALL_ORIGINS) {
        callback(null, true)
        return
      }
      if (!origin) {
        callback(null, CORS_ALLOW_NO_ORIGIN)
        return
      }
      if (origin === 'null') {
        callback(null, CORS_ALLOW_NULL_ORIGIN)
        return
      }
      callback(null, allowedOrigins.has(origin))
    },
    credentials: true,
  }))
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to false for testing
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }))

  // Mount file upload routes BEFORE json middleware
  app.use('/api', importRouter)

  // JSON middleware (after file upload routes)
  app.use(express.json())

  // Routes
  app.use('/api/tracks', tracksRouter)
  app.use('/api', tracksRouter) // Also mount at /api for /sources/* routes
  app.use('/api', slicesRouter)
  app.use('/api/youtube', youtubeRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/tags', tagsRouter)
  app.use('/api', tagsRouter)
  app.use('/api', foldersRouter)
  app.use('/api', collectionsRouter)
  app.use('/api', libraryRouter)
  if (SPOTIFY_IMPORT_ENABLED) {
    app.use('/api/spotify', spotifyRouter)
  }
  app.use('/api/soundcloud', soundcloudRouter)
  app.use('/api/tools', toolsRouter)
  app.use('/api', backupRouter)

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  // Credentials check
  app.get('/api/credentials/status', (req, res) => {
    const hasYoutubeApiKey = !!(process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'your_youtube_api_key_here')
    const hasGoogleClientId = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your_client_id_here.apps.googleusercontent.com' && process.env.GOOGLE_CLIENT_ID !== 'your-client-id.apps.googleusercontent.com')
    const hasGoogleClientSecret = !!(process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_SECRET !== 'GOCSPX-your_client_secret_here' && process.env.GOOGLE_CLIENT_SECRET !== 'your-client-secret')
    const hasSessionSecret = !!(process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'your_random_session_secret_here' && process.env.SESSION_SECRET !== 'CHANGE-THIS-TO-A-LONG-RANDOM-STRING')

    res.json({
      configured: hasYoutubeApiKey && hasGoogleClientId && hasGoogleClientSecret && hasSessionSecret,
      details: {
        youtubeApiKey: hasYoutubeApiKey,
        googleOAuth: hasGoogleClientId && hasGoogleClientSecret,
        sessionSecret: hasSessionSecret,
      }
    })
  })

  // Start backup scheduler (checks every 5 min for due scheduled backups)
  startBackupScheduler()

  return app
}
