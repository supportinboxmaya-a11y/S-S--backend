export interface Env {
  // Bindings
  R2_BUCKET: R2Bucket
  KV_CACHE: KVNamespace
  KV_SESSIONS: KVNamespace
  KV_RATE_LIMIT: KVNamespace
  QUEUE_VIDEO_PROCESSING: Queue<VideoProcessingJob>
  QUEUE_NOTIFICATIONS: Queue<NotificationJob>
  QUEUE_EMAILS: Queue<EmailJob>
  QUEUE_FEED_MAINTENANCE: Queue<FeedMaintenanceJob>
  QUEUE_ANALYTICS: Queue<AnalyticsJob>
  DB: D1Database

  // Durable Objects
  DM_Room: DurableObjectNamespace<DmRoom>
  Presence: DurableObjectNamespace<PresenceManager>
  RealtimeCounter: DurableObjectNamespace<RealtimeCounter>

  // Secrets (set via wrangler secret put)
  APP_KEY: string
  JWT_SECRET: string
  MAIL_PASSWORD: string
  AWS_ACCESS_KEY_ID: string
  AWS_SECRET_ACCESS_KEY: string
  REVERB_APP_ID: string
  REVERB_APP_KEY: string
  REVERB_APP_SECRET: string
  APPLE_TEAM_ID: string
  APPLE_KEY_ID: string
  APPLE_PRIVATE_KEY: string
  OAUTH_CLIENT_SECRET: string
  OAUTH_CLIENT_ID: string

  // Config (from vars)
  APP_NAME: string
  APP_ENV: string
  LOG_LEVEL: string
  CORS_ALLOWED_ORIGIN: string
  MUSIC_PROVIDER: string
  AUDIUS_API_URL: string
  AUDIUS_DISCOVERY_PROVIDER: string
  REVERB_SCHEME: string
}

export interface VideoProcessingJob {
  type: 'video-processing'
  videoId: string
  userId: string
  sourcePath: string
  options: {
    generateHls: boolean
    generateThumbnails: boolean
    generatePreview: boolean
    hlsRenditions?: string[]
    soundId?: string
    providerTrackId?: string
    musicProvider?: string
  }
  priority: 'high' | 'normal' | 'low'
  createdAt: number
  retries: number
}

export interface NotificationJob {
  type: 'notification'
  userId: string
  notificationId: string
  type: 'like' | 'comment' | 'follow' | 'mention' | 'system' | 'dm'
  data: Record<string, unknown>
  priority: 'high' | 'normal'
  createdAt: number
}

export interface EmailJob {
  type: 'email'
  to: string
  template: string
  data: Record<string, unknown>
  priority: 'high' | 'normal'
  createdAt: number
}

export interface FeedMaintenanceJob {
  type: 'feed-maintenance'
  action: 'rebuild' | 'cleanup' | 'recommend'
  userId?: string
  createdAt: number
}

export interface AnalyticsJob {
  type: 'analytics'
  event: string
  userId?: string
  videoId?: string
  data: Record<string, unknown>
  createdAt: number
}

// Durable Object types
export interface DmRoom {
  fetch(request: Request): Promise<Response>
  broadcast(message: unknown, exclude?: string): Promise<void>
  addParticipant(userId: string, socket: WebSocket): Promise<void>
  removeParticipant(userId: string): Promise<void>
  getState(): Promise<DmRoomState>
}

export interface PresenceManager {
  fetch(request: Request): Promise<Response>
  setPresence(userId: string, status: PresenceStatus): Promise<void>
  getPresence(userId: string): Promise<PresenceStatus | null>
  subscribe(userId: string, callback: (status: PresenceStatus) => void): Promise<() => void>
  getOnlineUsers(userIds: string[]): Promise<Map<string, PresenceStatus>>
}

export interface RealtimeCounter {
  fetch(request: Request): Promise<Response>
  increment(key: string, amount?: number): Promise<number>
  decrement(key: string, amount?: number): Promise<number>
  get(key: string): Promise<number>
  reset(key: string): Promise<void>
}

export interface DmRoomState {
  participants: Map<string, { userId: string; joinedAt: number; socket: WebSocket }>
  messages: DmMessage[]
  lastMessageId: string
}

export interface PresenceStatus {
  userId: string
  status: 'online' | 'away' | 'busy' | 'offline'
  lastSeen: number
  device?: string
}

export interface DmMessage {
  id: string
  conversationId: string
  senderId: string
  content: string
  media?: DmMedia[]
  createdAt: number
  readBy: Set<string>
}

export interface DmMedia {
  id: string
  type: 'image' | 'video' | 'audio' | 'file'
  url: string
  mimeType: string
  size: number
  width?: number
  height?: number
  duration?: number
  thumbnailUrl?: string
}