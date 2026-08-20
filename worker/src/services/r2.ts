import { R2Bucket, R2Object, R2PutOptions } from '@cloudflare/workers-types'
import { Env } from '../types/env'

export interface R2Client {
  bucket: R2Bucket
  put: (key: string, data: ReadableStream | ArrayBuffer | string, options?: R2PutOptions) Promise<R2Object | null>
  get: (key: string) => Promise<R2Object | null>
  head: (key: string) => Promise<R2Object | null>
  delete: (key: string) => Promise<void>
  list: (options?: { prefix?: string; limit?: number; cursor?: string }) => Promise<R2ObjectsList>
  signedUrl: (key: string, options?: { expiration?: number; method?: 'GET' | 'PUT' }) => Promise<string>
}

export interface R2ObjectsList {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
}

export function createR2Client(env: Env): R2Client {
  const bucket = env.R2_BUCKET

  return {
    bucket,
    async put(key: string, data: ReadableStream | ArrayBuffer | string, options?: R2PutOptions) {
      return await bucket.put(key, data, options)
    },
    async get(key: string) {
      return await bucket.get(key)
    },
    async head(key: string) {
      return await bucket.head(key)
    },
    async delete(key: string) {
      await bucket.delete(key)
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      return await bucket.list(options)
    },
    async signedUrl(key: string, options?: { expiration?: number; method?: 'GET' | 'PUT' }) {
      const expiration = options?.expiration ?? 3600
      const method = options?.method ?? 'GET'
      return await bucket.createSignedUrl(key, { expiration, method })
    },
  }
}

export const VIDEO_PATHS = {
  source: (userId: string, videoId: string) => `videos/${userId}/${videoId}/source`,
  hlsMaster: (userId: string, videoId: string) => `videos/${userId}/${videoId}/hls/master.m3u8`,
  hlsRendition: (userId: string, videoId: string, rendition: string, segment?: string) =>
    segment
      ? `videos/${userId}/${videoId}/hls/${rendition}/${segment}`
      : `videos/${userId}/${videoId}/hls/${rendition}/`,
  thumbnail: (userId: string, videoId: string, variant?: string) =>
    `videos/${userId}/${videoId}/thumbnail${variant ? `_${variant}` : ''}.jpg`,
  preview: (userId: string, videoId: string) => `videos/${userId}/${videoId}/preview.mp4`,
  audio: (userId: string, videoId: string) => `videos/${userId}/${videoId}/audio.m4a`,
}

export const AVATAR_PATH = (userId: string, variant?: string) =>
  `avatars/${userId}${variant ? `_${variant}` : ''}.jpg`

export const PROFILE_IMAGE_PATH = (userId: string, variant?: string) =>
  `profiles/${userId}${variant ? `_${variant}` : ''}.jpg`

export const SOUND_PATH = (soundId: string) => `sounds/${soundId}.m4a`

export const EXPORT_PATH = (userId: string, exportId: string) => `exports/${userId}/${exportId}.zip`

export const TEMP_UPLOAD_PATH = (uploadId: string) => `temp/uploads/${uploadId}`

export function getContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = {
    mp4: 'video/mp4',
    m3u8: 'application/vnd.apple.mpegurl',
    ts: 'video/mp2t',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    zip: 'application/zip',
    json: 'application/json',
  }
  return ext ? types[ext] ?? 'application/octet-stream' : 'application/octet-stream'
}

export function getCacheControl(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase()
  // Immutable content (hashed filenames) - cache for 1 year
  if (key.includes('/hls/') && key.match(/[a-f0-9]{32,}/)) {
    return 'public, max-age=31536000, immutable'
  }
  // Video segments - cache for 1 month
  if (ext === 'ts') {
    return 'public, max-age=2592000'
  }
  // Thumbnails, artwork - cache for 1 month
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext ?? '')) {
    return 'public, max-age=2592000'
  }
  // Master playlist - cache for 1 hour
  if (ext === 'm3u8') {
    return 'public, max-age=3600'
  }
  // Source videos - cache for 1 week
  if (key.includes('/source') || ext === 'mp4') {
    return 'public, max-age=604800'
  }
  return 'public, max-age=3600'
}