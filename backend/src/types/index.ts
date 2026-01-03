export interface Track {
  id: number
  youtubeId: string
  title: string
  description: string
  thumbnailUrl: string
  duration: number
  audioPath: string | null
  peaksPath: string | null
  status: 'pending' | 'downloading' | 'ready' | 'error'
  createdAt: string
}

export interface Slice {
  id: number
  trackId: number
  name: string
  startTime: number
  endTime: number
  filePath: string | null
  createdAt: string
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface YouTubeVideoInfo {
  videoId: string
  title: string
  description: string
  thumbnailUrl: string
  channelTitle: string
  duration: number
}

export interface YouTubeSearchResult {
  videoId: string
  title: string
  description: string
  thumbnailUrl: string
  channelTitle: string
  publishedAt: string
}

export interface YouTubePlaylist {
  id: string
  title: string
  description: string
  thumbnailUrl: string
  itemCount: number
}

declare module 'express-session' {
  interface SessionData {
    tokens?: {
      access_token: string
      refresh_token?: string
      expiry_date?: number
    }
    user?: {
      name: string
      email: string
      picture: string
    }
  }
}
