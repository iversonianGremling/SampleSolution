import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { YouTubeSearchResult, YouTubePlaylist } from '../types/index.js'

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/auth/google/callback'

export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl(oauth2Client: OAuth2Client): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent',
  })
}

export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  if (!YOUTUBE_API_KEY) {
    throw new Error('YouTube API key not configured')
  }

  const youtube = google.youtube({ version: 'v3', auth: YOUTUBE_API_KEY })

  const response = await youtube.search.list({
    part: ['snippet'],
    q: query,
    type: ['video'],
    maxResults: 20,
    videoCategoryId: '10', // Music category
  })

  return (response.data.items || []).map((item) => ({
    videoId: item.id?.videoId || '',
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || '',
    channelTitle: item.snippet?.channelTitle || '',
    publishedAt: item.snippet?.publishedAt || '',
  }))
}

export async function getUserPlaylists(
  oauth2Client: OAuth2Client
): Promise<YouTubePlaylist[]> {
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client })

  const response = await youtube.playlists.list({
    part: ['snippet', 'contentDetails'],
    mine: true,
    maxResults: 50,
  })

  return (response.data.items || []).map((item) => ({
    id: item.id || '',
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || '',
    itemCount: item.contentDetails?.itemCount || 0,
  }))
}

export async function getPlaylistItems(
  playlistId: string,
  oauth2Client?: OAuth2Client
): Promise<YouTubeSearchResult[]> {
  const auth = oauth2Client || YOUTUBE_API_KEY
  if (!auth) {
    throw new Error('No authentication available')
  }

  const youtube = google.youtube({ version: 'v3', auth })

  const items: YouTubeSearchResult[] = []
  let pageToken: string | undefined

  do {
    const response = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId,
      maxResults: 50,
      pageToken,
    })

    for (const item of response.data.items || []) {
      if (item.snippet?.resourceId?.videoId) {
        items.push({
          videoId: item.snippet.resourceId.videoId,
          title: item.snippet.title || '',
          description: item.snippet.description || '',
          thumbnailUrl: item.snippet.thumbnails?.medium?.url || '',
          channelTitle: item.snippet.videoOwnerChannelTitle || '',
          publishedAt: item.snippet.publishedAt || '',
        })
      }
    }

    pageToken = response.data.nextPageToken || undefined
  } while (pageToken && items.length < 200) // Limit to 200 items

  return items
}

export async function getUserInfo(oauth2Client: OAuth2Client) {
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const response = await oauth2.userinfo.get()
  return {
    name: response.data.name || '',
    email: response.data.email || '',
    picture: response.data.picture || '',
  }
}
