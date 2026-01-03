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
  tags: Tag[]
}

export interface Slice {
  id: number
  trackId: number
  name: string
  startTime: number
  endTime: number
  filePath: string | null
  createdAt: string
  tags: Tag[]
}

export interface Tag {
  id: number
  name: string
  color: string
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

export interface AuthStatus {
  authenticated: boolean
  user?: {
    name: string
    email: string
    picture: string
  }
}

export interface ImportResult {
  success: string[]
  failed: { url: string; error: string }[]
}
