import { Router } from 'express'
import {
  createOAuth2Client,
  getAuthUrl,
  getUserInfo,
} from '../services/youtube-api.js'

const router = Router()
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// Start OAuth flow
router.get('/google', (req, res) => {
  const oauth2Client = createOAuth2Client()
  const authUrl = getAuthUrl(oauth2Client)
  res.redirect(authUrl)
})

// OAuth callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string

  if (!code) {
    return res.redirect(`${FRONTEND_URL}?error=no_code`)
  }

  try {
    const oauth2Client = createOAuth2Client()
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get user info
    const userInfo = await getUserInfo(oauth2Client)

    // Store in session
    req.session.tokens = {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token || undefined,
      expiry_date: tokens.expiry_date || undefined,
    }
    req.session.user = userInfo

    res.redirect(FRONTEND_URL)
  } catch (error) {
    console.error('OAuth callback error:', error)
    res.redirect(`${FRONTEND_URL}?error=auth_failed`)
  }
})

// Get auth status
router.get('/status', (req, res) => {
  if (req.session.tokens && req.session.user) {
    res.json({
      authenticated: true,
      user: req.session.user,
    })
  } else {
    res.json({ authenticated: false })
  }
})

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err)
    }
    res.json({ success: true })
  })
})

export default router
