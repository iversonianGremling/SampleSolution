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

export function createApp(options: { dataDir?: string; frontendUrl?: string; sessionSecret?: string } = {}) {
  const app = express()
  const DATA_DIR = options.dataDir || process.env.DATA_DIR || './data'
  const FRONTEND_URL = options.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'
  const SESSION_SECRET = options.sessionSecret || process.env.SESSION_SECRET || 'dev-secret-change-me'

  // Ensure data directories exist
  const dirs = ['audio', 'slices', 'peaks']
  for (const dir of dirs) {
    const dirPath = path.join(DATA_DIR, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }

  // Middleware
  app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
  }))
  app.use(express.json())
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

  // Routes
  app.use('/api/tracks', tracksRouter)
  app.use('/api', slicesRouter)
  app.use('/api/youtube', youtubeRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/tags', tagsRouter)
  app.use('/api', tagsRouter)

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
